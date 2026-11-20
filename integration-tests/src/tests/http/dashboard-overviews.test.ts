import type { EventOrigin } from '@app/module';
import { assetEvidence, assetEvidenceHistory, cve } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeAll, describe, expect, it } from 'vitest';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';

/**
 * The wire contract of the overviews and the remediation pace. All are computed by database
 * aggregates and the top lists arrive as an aggregated JSON document, so this is where the shape is
 * checked to survive the output schema rather than to merely leave the service.
 */
describe('Dashboard overviews payload (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;
  let anonymous: ReturnType<typeof createTrpcTestClient>;

  let tenantId: string;
  let origin: EventOrigin;
  let coreDbId: string;

  beforeAll(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    client = createTrpcTestClient(server);
    anonymous = createTrpcTestClient(server);

    const adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });

    tenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: tenantId, name: 'Overview Tenant' }, adminId);
    origin = { type: 'client', userId: adminId, tenantId };

    const createAsset = async (name: string, criticality: 'low' | 'high', exposure: 'internal' | 'internet_facing') => {
      const id = uuidv7();
      await services.withOrigin(origin).supportingAssets.createSupportingAsset({
        id, name, description: null, ownerId: null, exposure, categoryId: 'host', criticality,
      });
      return id;
    };
    const createCve = async (cveId: string, values: { cvss?: number, epss?: number, kev?: boolean }) => {
      const id = uuidv7();
      await db.insert(cve).values([{
        id, tenantId, cveId, cvss: values.cvss ?? null, epss: values.epss ?? null, kev: values.kev ?? null,
        kevUpdatedAt: values.kev ? new Date() : null,
      }]);
      return id;
    };
    const attach = async (supportingAssetId: string, cveId: string) => {
      const id = uuidv7();
      await db.insert(assetEvidence).values([{ id, supportingAssetId, tenantId, cveId, userId: adminId }]);
      return id;
    };

    coreDbId = await createAsset('Core DB', 'high', 'internal');
    const edgeId = await createAsset('Edge App', 'low', 'internet_facing');

    const kevCritical = await createCve('CVE-2026-0001', { cvss: 9.5, epss: 0.7, kev: true });
    const high = await createCve('CVE-2026-0002', { cvss: 7.2 });
    const unscored = await createCve('CVE-2026-0003', {});

    await attach(coreDbId, kevCritical);
    await attach(coreDbId, unscored);
    await attach(edgeId, high);

    const dismissed = await attach(edgeId, kevCritical);
    await db.insert(assetEvidenceHistory).values([{
      id: uuidv7(), tenantId, assetEvidenceId: dismissed, state: 'dismissed', stateChangedAt: new Date(), origin: 'user',
    }]);
  }, 600_000);

  it('carries the findings counters, the severity histogram and the top lists', async () => {
    const res = await client.query('dashboard.getFindingsOverview', {}, { tenantId });

    expect(res.status).toBe(200);
    const overview = res.json.result.data;
    expect(overview.summary).toEqual({
      activeCount: 3,
      criticalCount: 1,
      highCount: 1,
      kevCount: 1,
      impactedAssetCount: 2,
      severityDistribution: { critical: 1, high: 1, medium: 0, low: 0, none: 0, unscored: 1 },
    });
    expect(overview.topFindings).toEqual([
      expect.objectContaining({ cveId: 'CVE-2026-0001', cvss: 9.5, epss: 0.7, kev: true, assetName: 'Core DB' }),
      expect.objectContaining({ cveId: 'CVE-2026-0002', cvss: 7.2, epss: null, kev: false }),
      expect.objectContaining({ cveId: 'CVE-2026-0003', cvss: null, epss: null, kev: false }),
    ]);
    expect(overview.topCves.map((entry: { cveId: string }) => entry.cveId)).toEqual(['CVE-2026-0001', 'CVE-2026-0002', 'CVE-2026-0003']);
  });

  it('carries the at-risk assets and both distributions', async () => {
    const res = await client.query('dashboard.getAssetsOverview', {}, { tenantId });

    expect(res.status).toBe(200);
    const overview = res.json.result.data;
    expect(overview.topAssets).toEqual([
      expect.objectContaining({ id: coreDbId, name: 'Core DB', criticality: 'high', score: 63, applicableCount: 2, criticalOrHighCount: 1 }),
      expect.objectContaining({ name: 'Edge App', criticality: 'low', score: 5, applicableCount: 1, criticalOrHighCount: 1 }),
    ]);
    expect(overview.byCategory).toEqual([{ categoryId: 'host', assetCount: 2, impactedAssetCount: 2 }]);
    expect(overview.byExposure).toEqual([
      { exposure: 'internal', assetCount: 1, impactedAssetCount: 1 },
      { exposure: 'internet_facing', assetCount: 1, impactedAssetCount: 1 },
    ]);
  });

  describe('dashboard.getRemediationPace', () => {
    it('carries the figures, the four bands and twelve months', async () => {
      const res = await client.query('dashboard.getRemediationPace', { windowDays: 30 }, { tenantId });

      expect(res.status).toBe(200);
      const pace = res.json.result.data;
      expect(pace).toMatchObject({ windowDays: 30, measurable: false, measurableFrom: expect.any(String) });
      expect(pace.total).toMatchObject({ newInWindow: 4, closedInWindow: 1, openCount: 3 });
      expect(pace.total.months).toHaveLength(12);
      expect(pace.bands.map((band: { band: string }) => band.band)).toEqual(['critical', 'high', 'medium', 'low']);
    });

    it.each([0, 60])('should refuse a window of %i days', async (windowDays) => {
      const res = await client.query('dashboard.getRemediationPace', { windowDays }, { tenantId });

      expect(res.json.error.data.code).toBe('BAD_REQUEST');
    });

    it('should refuse an unauthenticated caller', async () => {
      const res = await anonymous.query('dashboard.getRemediationPace', { windowDays: 90 }, { tenantId });

      expect(res.json.error.data.code).toBe('UNAUTHORIZED');
    });
  });
});
