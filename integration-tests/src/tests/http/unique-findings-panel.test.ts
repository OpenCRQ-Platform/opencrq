import { cve, uniqueFindingScoreHistory, uniqueFindingScores } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';

describe('Unique findings panel counts (HTTP/tRPC)', () => {
  let client: ReturnType<typeof createTrpcTestClient>;
  let tenantId: string;
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
    const cveRowId = uuidv7();
    await db.insert(cve).values([{ id: cveRowId, tenantId, cveId: 'CVE-2024-3400', epss: 0.9, kev: null }]);
    await db.insert(uniqueFindingScores).values([{
      id: uuidv7(), tenantId, organizationId: null, cveId: cveRowId, score: 66.4, band: 'medium', worstScore: 66.4, affectedAssetCount: 1, firstSeenAt: new Date(),
    }]);
    await db.insert(uniqueFindingScoreHistory).values([{
      id: uuidv7(), tenantId, organizationId: null, cveId: cveRowId, score: 66.4, band: 'medium', worstScore: 66.4, affectedAssetCount: 1, changedAt: new Date(Date.now() - 20 * 86_400_000),
    }]);
  });

  it('should serve the counts and the baselines of the tenant estate', async () => {
    const res = await client.query('findingScore.getUniqueFindingsPanelCounts', { organizationId: null }, { tenantId });

    expect(res.status).toBe(200);
    expect(res.json.result.data).toEqual({
      windowStart: expect.any(String),
      uniqueFindings: 1,
      techniqueGroups: 0,
      newInWindow: 0,
      bands: [
        { band: 'critical', total: 0, newInWindow: 0 },
        { band: 'high', total: 0, newInWindow: 0 },
        { band: 'medium', total: 1, newInWindow: 0 },
        { band: 'low', total: 0, newInWindow: 0 },
      ],
      baselines: {
        cveGroupsBefore: 1,
        bandsBefore: [
          { band: 'critical', total: 0 },
          { band: 'high', total: 0 },
          { band: 'medium', total: 1 },
          { band: 'low', total: 0 },
        ],
        newInPreviousWindow: 0,
      },
    });
  });

  it('should reject a malformed organization id', async () => {
    const res = await client.query('findingScore.getUniqueFindingsPanelCounts', { organizationId: 'not-a-uuid' }, { tenantId });

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should answer not found for an organization the tenant does not have', async () => {
    const res = await client.query('findingScore.getUniqueFindingsPanelCounts', { organizationId: uuidv7() }, { tenantId });

    expect(res.json.error.data.code).toBe('NOT_FOUND');
  });

  it('should reject an unauthenticated read', async () => {
    client.clearCookies();

    const res = await client.query('findingScore.getUniqueFindingsPanelCounts', { organizationId: null }, { tenantId });

    expect(res.json.error.data.code).toBe('UNAUTHORIZED');
  });
});
