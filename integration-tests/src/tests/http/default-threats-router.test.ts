import type { EventOrigin } from '@app/module';
import { Capability_ManageSecurity } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createUser, grantCapability } from '../../helpers/factories';
import { signInAs, signInAsFirstAdmin } from '../../helpers/sign-in';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';

const ADMIN_EMAIL = 'admin@test.com';

describe('default threats connector (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;
  let tenantId: string;
  let adminOrigin: EventOrigin;

  const loginAs = async (user: { userId: string }) => {
    client.clearCookies();
    await signInAs(client, user.userId);
  };

  const enabled = async () => (await client.query('defaultThreats.getOverview', undefined, { tenantId })).json.result.data.enabled;

  beforeEach(async () => {
    await truncateAllTables(db);
    client = createTrpcTestClient(await getTestServer());

    const adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });

    tenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: tenantId, name: 'Tenant' }, adminId);
    adminOrigin = { type: 'client', userId: adminId, tenantId };
  });

  it('should refuse setEnabled to a tenant member without MANAGE_SECURITY and change nothing', async () => {
    const member = await createUser(db);
    await services.withOrigin(adminOrigin).tenants.addTenantUser(tenantId, member.userId);
    await loginAs(member);

    const res = await client.mutation('defaultThreats.setEnabled', { enabled: false }, { tenantId });

    expect(res.json.error.data.code).toBe('FORBIDDEN');
    expect(await enabled()).toBe(true);
  });

  it('should let a member holding MANAGE_SECURITY switch the connector off', async () => {
    const securityManager = await createUser(db);
    await services.withOrigin(adminOrigin).tenants.addTenantUser(tenantId, securityManager.userId);
    await grantCapability(services, adminOrigin, securityManager.userId, Capability_ManageSecurity);
    await loginAs(securityManager);

    const res = await client.mutation('defaultThreats.setEnabled', { enabled: false }, { tenantId });

    expect(res.status).toBe(200);
    expect(res.json.result.data).toEqual({ retracted: 0 });
    expect(await enabled()).toBe(false);
  });
});
