import { controlProvenPostureHistory } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('Proven posture history (HTTP/tRPC)', () => {
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
    capabilityId = capabilities.json.result.data.find((capability: { externalId: string }) => capability.externalId === 'EDR').id;
    await db.insert(controlProvenPostureHistory).values({
      id: uuidv7(),
      tenantId,
      capabilityId,
      organizationId: null,
      function: 'detect',
      credited: 12,
      tested: 5,
      held: 4,
      changedAt: new Date(),
    });
  });

  it('should serve every count with its date as an ISO string', async () => {
    const res = await client.query('controlValidation.getProvenPostureHistory', { capabilityId }, { tenantId });

    expect(res.status).toBe(200);
    const [line] = res.json.result.data;
    expect(line.at).toMatch(ISO_DATE);
    expect(line).toEqual({ function: 'detect', at: line.at, credited: 12, tested: 5, held: 4 });
  });

  it('should answer an unknown risk scope as not found', async () => {
    const res = await client.query('controlValidation.getProvenPostureHistory', { capabilityId, organizationId: uuidv7() }, { tenantId });

    expect(res.status).toBe(404);
  });
});
