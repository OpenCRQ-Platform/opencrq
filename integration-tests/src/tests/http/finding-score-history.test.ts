import { assetEvidence, cve, findingScoreHistory, uniqueFindingScoreHistory } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';

describe('Finding score history (HTTP/tRPC)', () => {
  let client: ReturnType<typeof createTrpcTestClient>;
  let tenantId: string;
  let evidenceId: string;
  let cveRowId: string;
  const services = createTestServices(db);

  beforeEach(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    client = createTrpcTestClient(server);

    const adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });
    tenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: tenantId, name: 'Tenant' }, adminId);
    const supportingAssetId = uuidv7();
    await services.withOrigin({ type: 'client', userId: adminId, tenantId }).supportingAssets.createSupportingAsset({
      id: supportingAssetId,
      name: 'Core banking',
      description: null,
      ownerId: null,
      exposure: 'internet_facing',
      categoryId: 'host',
      criticality: 'high',
    });
    cveRowId = uuidv7();
    await db.insert(cve).values([{ id: cveRowId, tenantId, cveId: 'CVE-2024-3400', epss: 0.9, kev: null }]);
    evidenceId = uuidv7();
    await db.insert(assetEvidence).values([{ id: evidenceId, supportingAssetId, tenantId, cveId: cveRowId }]);
  });

  it('should serve the lines oldest first with their instant as an ISO string and their band', async () => {
    const firstAt = new Date(Date.now() - 20 * 86_400_000);
    const movedAt = new Date(Date.now() - 5 * 86_400_000);
    await db.insert(findingScoreHistory).values([
      { id: uuidv7(), assetEvidenceId: evidenceId, tenantId, score: 66.4, band: 'medium', changedAt: firstAt },
      { id: uuidv7(), assetEvidenceId: evidenceId, tenantId, score: 71.9, band: 'high', changedAt: movedAt },
    ]);

    const res = await client.query('findingScore.getFindingScoreHistory', { evidenceId }, { tenantId });

    expect(res.status).toBe(200);
    expect(res.json.result.data).toEqual([
      { at: firstAt.toISOString(), score: 66, band: 'medium' },
      { at: movedAt.toISOString(), score: 71, band: 'high' },
    ]);
  });

  it('should reject a malformed finding id', async () => {
    const res = await client.query('findingScore.getFindingScoreHistory', { evidenceId: 'not-a-uuid' }, { tenantId });

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should reject an unauthenticated read', async () => {
    client.clearCookies();

    const res = await client.query('findingScore.getFindingScoreHistory', { evidenceId }, { tenantId });

    expect(res.json.error.data.code).toBe('UNAUTHORIZED');
  });

  describe('of a unique finding', () => {
    it('should serve the journal oldest first, each line with its kind and the line it moved from', async () => {
      const firstAt = new Date(Date.now() - 20 * 86_400_000);
      const movedAt = new Date(Date.now() - 5 * 86_400_000);
      await db.insert(uniqueFindingScoreHistory).values([
        { id: uuidv7(), tenantId, organizationId: null, cveId: cveRowId, score: 66.4, band: 'medium', worstScore: 65, affectedAssetCount: 1, changedAt: firstAt },
        { id: uuidv7(), tenantId, organizationId: null, cveId: cveRowId, score: 71.9, band: 'high', worstScore: 71, affectedAssetCount: 1, changedAt: movedAt },
      ]);

      const res = await client.query('findingScore.getUniqueFindingScoreHistory', { cveId: 'CVE-2024-3400', organizationId: null }, { tenantId });

      expect(res.status).toBe(200);
      expect(res.json.result.data).toMatchObject([
        { at: firstAt.toISOString(), kind: 'first', score: 66, band: 'medium', previous: null },
        { at: movedAt.toISOString(), kind: 'rise', score: 71, band: 'high', previous: { score: 66 } },
      ]);
    });

    it('should reject a malformed CVE id', async () => {
      const res = await client.query('findingScore.getUniqueFindingScoreHistory', { cveId: 'not-a-cve', organizationId: null }, { tenantId });

      expect(res.json.error.data.code).toBe('BAD_REQUEST');
    });

    it('should reject an unauthenticated read', async () => {
      client.clearCookies();

      const res = await client.query('findingScore.getUniqueFindingScoreHistory', { cveId: 'CVE-2024-3400', organizationId: null }, { tenantId });

      expect(res.json.error.data.code).toBe('UNAUTHORIZED');
    });
  });
});
