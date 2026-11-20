import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('Control effectiveness history (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;
  let tenantId: string;
  let capabilityId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    client = createTrpcTestClient(await getTestServer());
    const adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });
    tenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId }).tenants.createTenant({ id: tenantId, name: 'Tenant' }, adminId);
    const capabilities = await client.query('controlCapabilities.getControlCapabilities', undefined, { tenantId });
    capabilityId = capabilities.json.result.data.find((capability: { externalId: string }) => capability.externalId === 'IDP').id;
    await client.mutation('controlCapabilities.upsertAssessment', {
      capabilityId, strengthRung: 'L2', coverageBucket: 'L2', comment: null,
    }, { tenantId });
  });

  it('should serve every line with its dates as ISO strings', async () => {
    const res = await client.query('controlCapabilities.getEffectivenessHistory', { capabilityId }, { tenantId });

    expect(res.status).toBe(200);
    const [line] = res.json.result.data;
    expect(line.at).toMatch(ISO_DATE);
    expect(line.posture).toEqual({
      strengthRung: 'L2',
      coverageBucket: 'L2',
      strengthSource: 'tenant',
      coverageSource: 'tenant',
    });
    expect(line.event.createdAt).toMatch(ISO_DATE);
    expect(Object.keys(line.event).toSorted()).toEqual([
      'capabilityId', 'comment', 'connector', 'coverageMode', 'createdAt', 'id', 'newCoverage', 'newStrength',
      'oldCoverage', 'oldStrength', 'organizationId', 'sources', 'strengthMode', 'tenantId',
      'type', 'userId', 'userName',
    ]);
    expect(line.event.sources).toEqual([]);
  });
});
