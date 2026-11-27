import type { ThreatEntityType } from '@app/module';
import { threatAnalyses, threatAnalysisCves } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeAll, describe, expect, it } from 'vitest';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';
const DAY_MS = 86_400_000;
const DORMANT_AGE_MS = 400 * DAY_MS;

describe('threats.getCatalogVolumes (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;
  let anonymous: ReturnType<typeof createTrpcTestClient>;
  let tenantId: string;
  let otherTenantId: string;
  let observed89DaysAgoTenantId: string;
  let observed91DaysAgoTenantId: string;
  let neverObservedTenantId: string;

  const insertThreat = async (
    tenant: string,
    entityType: ThreatEntityType,
    options: { active?: boolean, observedDaysAgo?: number | null, cveIds?: Array<string> } = {},
  ): Promise<void> => {
    const id = uuidv7();
    const observedAgeMs = options.observedDaysAgo === undefined
      ? (options.active ? 0 : DORMANT_AGE_MS)
      : options.observedDaysAgo === null ? null : options.observedDaysAgo * DAY_MS;
    await db.insert(threatAnalyses).values([{
      id,
      tenantId: tenant,
      stixId: `${entityType}--${id}`,
      entityType,
      kind: 'connector',
      name: `Threat ${id}`,
      markingRefs: [],
      lastObservedAt: observedAgeMs === null ? null : new Date(Date.now() - observedAgeMs),
    }]);
    if (options.cveIds?.length) {
      await db.insert(threatAnalysisCves).values(options.cveIds.map((cveId) => ({
        id: uuidv7(),
        analysisId: id,
        stixId: `vulnerability--${cveId}`,
        stixRelationId: `relationship--${uuidv7()}`,
        cveId,
      })));
    }
  };

  beforeAll(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    client = createTrpcTestClient(server);
    anonymous = createTrpcTestClient(server);

    const adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });

    tenantId = uuidv7();
    otherTenantId = uuidv7();
    observed89DaysAgoTenantId = uuidv7();
    observed91DaysAgoTenantId = uuidv7();
    neverObservedTenantId = uuidv7();
    const platform = services.withOrigin({ type: 'platform', userId: adminId });
    await platform.tenants.createTenant({ id: tenantId, name: 'Catalog Tenant' }, adminId);
    await platform.tenants.createTenant({ id: otherTenantId, name: 'Other Tenant' }, adminId);
    await platform.tenants.createTenant({ id: observed89DaysAgoTenantId, name: 'Observed 89 Days Ago Tenant' }, adminId);
    await platform.tenants.createTenant({ id: observed91DaysAgoTenantId, name: 'Observed 91 Days Ago Tenant' }, adminId);
    await platform.tenants.createTenant({ id: neverObservedTenantId, name: 'Never Observed Tenant' }, adminId);

    await insertThreat(tenantId, 'threat-actor', { active: true });
    await insertThreat(tenantId, 'intrusion-set', { active: true, cveIds: ['CVE-2026-0601', 'CVE-2026-0602'] });
    await insertThreat(tenantId, 'intrusion-set', { cveIds: ['CVE-2026-0602'] });
    await insertThreat(tenantId, 'campaign');
    await insertThreat(otherTenantId, 'intrusion-set', { active: true, cveIds: ['CVE-2026-0603'] });
    // A day either side of the 90-day edge, so no assertion depends on when the suite runs.
    await insertThreat(observed89DaysAgoTenantId, 'threat-actor', { observedDaysAgo: 89 });
    await insertThreat(observed91DaysAgoTenantId, 'threat-actor', { observedDaysAgo: 91 });
    await insertThreat(neverObservedTenantId, 'threat-actor', { observedDaysAgo: null });
  }, 600_000);

  it('should count the tenant catalog by type, its active threats and the distinct CVEs they target', async () => {
    const res = await client.query('threats.getCatalogVolumes', undefined, { tenantId });

    expect(res.status).toBe(200);
    expect(res.json.result.data).toEqual({ threatActors: 1, intrusionSets: 2, campaigns: 1, active: 2, citedCves: 2 });
  });

  it('should count only the catalog of the tenant named', async () => {
    const res = await client.query('threats.getCatalogVolumes', undefined, { tenantId: otherTenantId });

    expect(res.json.result.data).toEqual({ threatActors: 0, intrusionSets: 1, campaigns: 0, active: 1, citedCves: 1 });
  });

  it('should count as active a threat last observed 89 days ago', async () => {
    const res = await client.query('threats.getCatalogVolumes', undefined, { tenantId: observed89DaysAgoTenantId });

    expect(res.json.result.data).toMatchObject({ threatActors: 1, active: 1 });
  });

  it('should not count as active a threat last observed 91 days ago', async () => {
    const res = await client.query('threats.getCatalogVolumes', undefined, { tenantId: observed91DaysAgoTenantId });

    expect(res.json.result.data).toMatchObject({ threatActors: 1, active: 0 });
  });

  it('should not count as active a threat that was never dated', async () => {
    const res = await client.query('threats.getCatalogVolumes', undefined, { tenantId: neverObservedTenantId });

    expect(res.json.result.data).toMatchObject({ threatActors: 1, active: 0 });
  });

  it('should refuse an unauthenticated caller', async () => {
    const res = await anonymous.query('threats.getCatalogVolumes', undefined, { tenantId });

    expect(res.json.error.data.code).toBe('UNAUTHORIZED');
  });

  it('should refuse a call that names no tenant', async () => {
    const res = await client.query('threats.getCatalogVolumes');

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });
});
