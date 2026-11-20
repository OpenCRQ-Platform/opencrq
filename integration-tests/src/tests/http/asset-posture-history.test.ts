import { assetEvidence, assetPostureHistory, cve } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';

describe('Asset posture history (HTTP/tRPC)', () => {
  let client: ReturnType<typeof createTrpcTestClient>;
  let tenantId: string;
  let supportingAssetId: string;
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
    supportingAssetId = uuidv7();
    await services.withOrigin({ type: 'client', userId: adminId, tenantId }).supportingAssets.createSupportingAsset({
      id: supportingAssetId,
      name: 'Core banking',
      description: null,
      ownerId: null,
      exposure: 'internet_facing',
      categoryId: 'host',
      criticality: 'high',
    });
  });

  it('should serve the lines with their instant as an ISO string and a lost posture as null', async () => {
    const scoredAt = new Date(Date.now() - 20 * 86_400_000);
    const lostAt = new Date(Date.now() - 5 * 86_400_000);
    await db.insert(assetPostureHistory).values([
      { id: uuidv7(), supportingAssetId, tenantId, score: 64, changedAt: scoredAt },
      { id: uuidv7(), supportingAssetId, tenantId, score: null, changedAt: lostAt },
    ]);

    const res = await client.query('findingScore.getAssetPostureHistory', { supportingAssetId }, { tenantId });

    expect(res.status).toBe(200);
    expect(res.json.result.data).toEqual([
      { at: scoredAt.toISOString(), score: 64, cause: null },
      { at: lostAt.toISOString(), score: null, cause: null },
    ]);
  });

  it('should serve each line with its cause and the worst finding named', async () => {
    const cveRowId = uuidv7();
    await db.insert(cve).values([{ id: cveRowId, tenantId, cveId: 'CVE-2024-3400', epss: 0.9, kev: null }]);
    const evidenceId = uuidv7();
    await db.insert(assetEvidence).values([{ id: evidenceId, supportingAssetId, tenantId, cveId: cveRowId }]);
    const cause = { worstAssetEvidenceId: evidenceId, criticalCount: 0, highCount: 0, mediumCount: 1, lowCount: 0 };
    await db.insert(assetPostureHistory).values([
      { id: uuidv7(), supportingAssetId, tenantId, score: 55, changedAt: new Date(Date.now() - 20 * 86_400_000), worstExploitability: 45, ...cause },
      { id: uuidv7(), supportingAssetId, tenantId, score: 54, changedAt: new Date(Date.now() - 5 * 86_400_000), worstExploitability: 46, ...cause },
    ]);

    const res = await client.query('findingScore.getAssetPostureHistory', { supportingAssetId }, { tenantId });

    expect(res.status).toBe(200);
    expect(res.json.result.data[1].cause).toEqual({
      worstFinding: { evidenceId, name: 'CVE-2024-3400' },
      worstExploitability: 46,
      countsByBand: { critical: 0, high: 0, medium: 1, low: 0 },
      change: { kind: 'exploitability', from: 45 },
    });
  });

  it('should reject a malformed asset id', async () => {
    const res = await client.query('findingScore.getAssetPostureHistory', { supportingAssetId: 'not-a-uuid' }, { tenantId });

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should reject an unauthenticated read', async () => {
    client.clearCookies();

    const res = await client.query('findingScore.getAssetPostureHistory', { supportingAssetId }, { tenantId });

    expect(res.json.error.data.code).toBe('UNAUTHORIZED');
  });
});
