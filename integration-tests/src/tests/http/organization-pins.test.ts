import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';

describe('Risk scope pins (HTTP/tRPC)', () => {
  let client: ReturnType<typeof createTrpcTestClient>;
  let tenantId: string;
  let organizationId: string;
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
    organizationId = uuidv7();
    await services.withOrigin({ type: 'client', userId: adminId, tenantId })
      .organizations.createOrganizations([{ id: organizationId, name: 'Acme Bank Asia Pacific' }]);
  });

  const setPinned = (input: unknown, options = { tenantId }) => client.mutation('organizations.setOrganizationPinned', input, options);

  it('should serve the scopes the caller unpinned', async () => {
    const res = await setPinned({ id: organizationId, pinned: false });
    expect(res.status).toBe(200);

    const read = await client.query('organizations.getUnpinnedOrganizationIds', undefined, { tenantId });
    expect(read.json.result.data).toEqual([organizationId]);
  });

  it('should surface NOT_FOUND for a scope the tenant does not hold', async () => {
    const res = await setPinned({ id: uuidv7(), pinned: false });

    expect(res.json.error.data.code).toBe('NOT_FOUND');
  });

  it('should reject a malformed scope id', async () => {
    const res = await setPinned({ id: 'not-a-uuid', pinned: false });

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should reject a missing pin state', async () => {
    const res = await setPinned({ id: organizationId });

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should reject an unauthenticated pin', async () => {
    client.clearCookies();

    const res = await setPinned({ id: organizationId, pinned: false });

    expect(res.json.error.data.code).toBe('UNAUTHORIZED');
  });

  it('should reject an authenticated pin without tenant context', async () => {
    const res = await client.mutation('organizations.setOrganizationPinned', { id: organizationId, pinned: false });

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });
});
