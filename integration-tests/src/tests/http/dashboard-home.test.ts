import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createUser } from '../../helpers/factories';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAs, signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';

describe('Home dashboard (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;
  let adminId: string;
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    client = createTrpcTestClient(server);

    adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });

    tenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: tenantId, name: 'Tenant' }, adminId);
  });

  const loginAsMember = async () => {
    const member = await createUser(db);
    await services.withOrigin({ type: 'client', userId: adminId, tenantId })
      .tenants.addTenantUser(tenantId, member.userId);
    client.clearCookies();
    await signInAs(client, member.userId);
  };

  it('should let a security manager set the tenant home dashboard', async () => {
    const res = await client.mutation('dashboard.setTenantHomeDashboard', { dashboardId: 'risk-sankey' }, { tenantId });
    expect(res.status).toBe(200);

    const read = await client.query('dashboard.getTenantHomeDashboard', undefined, { tenantId });
    expect(read.json.result.data).toBe('risk-sankey');
  });

  it('should refuse the tenant home dashboard to a member who cannot manage security', async () => {
    await loginAsMember();

    const res = await client.mutation('dashboard.setTenantHomeDashboard', { dashboardId: 'risk-sankey' }, { tenantId });
    expect(res.json.error.data.code).toBe('FORBIDDEN');

    const read = await client.query('dashboard.getTenantHomeDashboard', undefined, { tenantId });
    expect(read.json.result.data).toBeNull();
  });

  it('should reject a malformed dashboard id with BAD_REQUEST', async () => {
    const res = await client.mutation('dashboard.setTenantHomeDashboard', { dashboardId: 'Risk Sankey' }, { tenantId });
    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should keep a member\'s own home dashboard on their user', async () => {
    await loginAsMember();

    const update = await client.mutation('users.updateUser', { homeDashboardId: 'findings-assets' }, { tenantId });
    expect(update.status).toBe(200);

    const read = await client.query('users.getUserHomeDashboard', undefined, { tenantId });
    expect(read.json.result.data).toBe('findings-assets');
  });

  it('should clear a member\'s own home dashboard back to the tenant default', async () => {
    await loginAsMember();
    await client.mutation('users.updateUser', { homeDashboardId: 'findings-assets' }, { tenantId });

    const clear = await client.mutation('users.updateUser', { homeDashboardId: null }, { tenantId });
    expect(clear.status).toBe(200);

    const read = await client.query('users.getUserHomeDashboard', undefined, { tenantId });
    expect(read.json.result.data).toBeNull();
  });
});
