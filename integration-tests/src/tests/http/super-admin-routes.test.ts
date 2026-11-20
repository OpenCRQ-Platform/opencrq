import { sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createUser } from '../../helpers/factories';
import { signInAs, signInAsFirstAdmin } from '../../helpers/sign-in';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';

/** The routers ask the tenants policy whether the caller reaches a tenant, so the super administrator passes them too. */
describe('Super administrator (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;
  let adminId: string;
  let tenantId: string;
  let superAdminId: string;
  let strangerId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    client = createTrpcTestClient(server);
    adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId });
    tenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId }).tenants.createTenant({ id: tenantId, name: 'Acme' }, adminId);
    superAdminId = (await createUser(db, 'xtm-admin@example.com')).userId;
    await db.execute(sql`UPDATE users SET is_super_admin = true WHERE id = ${superAdminId}`);
    strangerId = (await createUser(db, 'stranger@example.com')).userId;
  });

  it('should let the super administrator read the members of a tenant it is not a member of', async () => {
    await signInAs(client, superAdminId);

    const res = await client.query('tenants.getTenantUsers', { tenantId }, { tenantId });

    expect(res.status).toBe(200);
    expect(res.json.result.data.map((row: { userId: string }) => row.userId)).toEqual([adminId]);
  });

  it('should list the super administrator among a tenant\'s users, flagged, in no group', async () => {
    await signInAs(client, adminId);

    const res = await client.query('tenants.listTenantUsers', { tenantId }, { tenantId });

    expect(res.status).toBe(200);
    expect(res.json.result.data).toContainEqual(expect.objectContaining({ id: adminId, isSuperAdmin: false }));
    expect(res.json.result.data).toContainEqual({
      id: superAdminId, email: 'xtm-admin@example.com', name: null, title: null, isSuperAdmin: true, groups: [], roles: [], hasSignedIn: false,
    });
  });

  it('should show a tenant\'s members the super administrator\'s profile and name', async () => {
    await signInAs(client, adminId);

    const user = await client.query('users.getUser', { id: superAdminId }, { tenantId });
    const names = await client.query('tenants.getTenantUserNamesByIds', { tenantId, ids: [adminId, superAdminId] }, { tenantId });

    expect(user.json.result.data).toMatchObject({ id: superAdminId, email: 'xtm-admin@example.com', isSuperAdmin: true });
    expect(names.json.result.data.map(({ id }: { id: string }) => id).sort()).toEqual([adminId, superAdminId].sort());
  });

  it('should not show the super administrator to a user with no membership', async () => {
    await signInAs(client, strangerId);

    const res = await client.query('users.getUser', { id: superAdminId }, { tenantId });

    expect(res.json.result.data).toBeNull();
  });

  it('should let the super administrator change a member\'s tenant profile', async () => {
    await signInAs(client, superAdminId);

    const res = await client.mutation('tenants.updateTenantUserProfile', { tenantId, userId: adminId, name: 'Renamed' }, { tenantId });

    expect(res.status).toBe(200);
  });

  it('should show the super administrator his own profile in a tenant he is not a member of', async () => {
    await signInAs(client, superAdminId);

    const user = await client.query('users.getUser', { id: superAdminId }, { tenantId });
    const tenantProfile = await client.query('tenants.getTenantUserProfile', { tenantId, userId: superAdminId }, { tenantId });

    expect(user.status).toBe(200);
    expect(user.json.result.data).toMatchObject({ id: superAdminId, email: 'xtm-admin@example.com' });
    expect(tenantProfile.status).toBe(200);
    expect(tenantProfile.json.result.data).toBeNull();
  });

  it('should give the super administrator back the preferences he saves in a tenant he is not a member of', async () => {
    await signInAs(client, superAdminId);

    const saved = await client.mutation('users.updateUser', { locale: 'fr', theme: 'dark' }, { tenantId });
    const locale = await client.query('users.getUserLocale', undefined, { tenantId });
    const theme = await client.query('users.getUserTheme', undefined, { tenantId });

    expect(saved.status).toBe(200);
    expect(locale.json.result.data).toBe('fr');
    expect(theme.json.result.data).toBe('dark');
  });

  it('should refuse the super administrator a tenant profile in a tenant he is not a member of, as not found', async () => {
    await signInAs(client, superAdminId);

    const res = await client.mutation('tenants.updateTenantUserProfile', { tenantId, userId: superAdminId, name: 'Override' }, { tenantId });

    expect(res.status).toBe(404);
  });

  it('should offer the super administrator among a tenant\'s users', async () => {
    await signInAs(client, adminId);

    const res = await client.query('users.getUsers', undefined, { tenantId });

    expect(res.json.result.data.map((user: { id: string }) => user.id).sort()).toEqual([adminId, superAdminId].sort());
  });

  it('should refuse to put the super administrator in a group of a tenant without a membership, as not found', async () => {
    await signInAs(client, adminId);
    const groupId = uuidv7();
    await client.mutation('groups.createGroup', { id: groupId, name: 'Analysts' }, { tenantId });

    const res = await client.mutation('groups.addUserToGroup', { groupId, userId: superAdminId }, { tenantId });

    expect(res.status).toBe(404);
    const members = await client.query('groups.getGroupUsers', { groupId }, { tenantId });
    expect(members.json.result.data).toEqual([]);
  });

  it('should show a user with no membership no one but himself in that tenant', async () => {
    await signInAs(client, strangerId);

    const member = await client.query('users.getUser', { id: adminId }, { tenantId });
    const self = await client.query('users.getUser', { id: strangerId }, { tenantId });

    expect(member.json.result.data).toBeNull();
    expect(self.json.result.data).toMatchObject({ id: strangerId });
  });

  it('should still refuse a user with no membership', async () => {
    await signInAs(client, strangerId);

    const res = await client.query('tenants.listTenantUsers', { tenantId }, { tenantId });

    expect(res.status).toBe(403);
  });

  it('should refuse the former super administrator once XTM One stops saying so', async () => {
    await db.execute(sql`UPDATE users SET is_super_admin = false WHERE id = ${superAdminId}`);
    await signInAs(client, superAdminId);

    const res = await client.query('tenants.listTenantUsers', { tenantId }, { tenantId });

    expect(res.status).toBe(403);
  });
});
