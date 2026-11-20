import { getSessionCookieName } from '@app/back/src/trpc';
import { PlatformCapability_ManageUsers } from '@app/module';
import { sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTenant, createUser } from '../../helpers/factories';
import { createServiceAccountClient } from '../../helpers/service-account-client';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { DEFAULT_TENANT_ID, signInAs, signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';

describe('Authorization (HTTP/tRPC)', () => {
  let client: ReturnType<typeof createTrpcTestClient>;
  const services = createTestServices(db);

  beforeEach(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    client = createTrpcTestClient(server);
  });

  describe('protected routes without authentication', () => {
    it('should return UNAUTHORIZED for getMe without cookie', async () => {
      const res = await client.query('getMe');
      expect(res.json.error.data.code).toBe('UNAUTHORIZED');
    });

    it('should return UNAUTHORIZED for signOut without cookie', async () => {
      const res = await client.mutation('signOut');
      expect(res.json.error.data.code).toBe('UNAUTHORIZED');
    });

    it('should return UNAUTHORIZED for authenticated domain queries without cookie', async () => {
      const res = await client.query('organizations.getOrganizations', undefined, {
        tenantId: uuidv7(),
      });
      expect(res.json.error.data.code).toBe('UNAUTHORIZED');
    });
  });

  describe('invalid session cookie', () => {
    it('should reject requests with an expired/nonexistent session cookie', async () => {
      // Use a valid UUID format so it reaches the "session not found" path
      // rather than causing a DB type error on non-UUID input
      client.setCookies([`${getSessionCookieName()}=${uuidv7()}`]);
      const res = await client.query('getMe');
      // Session not found → context has null user → protectedProcedure throws UNAUTHORIZED
      expect(res.json.error.data.code).toBe('UNAUTHORIZED');
    });
  });

  describe('x-tenant-id header', () => {
    let adminId: string;
    let tenantAId: string;
    let tenantBId: string;

    beforeEach(async () => {
      // Create admin and login via HTTP
      adminId = uuidv7();
      await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });

      // Create two tenants via service (generate IDs first, createTenant does not return them)
      tenantAId = uuidv7();
      tenantBId = uuidv7();
      const adminOriginForTenantCreate = { type: 'platform' as const, userId: adminId };
      await services.withOrigin(adminOriginForTenantCreate)
        .tenants.createTenant({ id: tenantAId, name: 'Tenant A' }, adminId);
      await services.withOrigin(adminOriginForTenantCreate)
        .tenants.createTenant({ id: tenantBId, name: 'Tenant B' }, adminId);

      // Create an org in each tenant via service
      const originA = { type: 'client' as const, userId: adminId, tenantId: tenantAId };
      const originB = { type: 'client' as const, userId: adminId, tenantId: tenantBId };

      await services.withOrigin(originA).organizations.createOrganizations([
        { id: uuidv7(), name: 'Org in Tenant A' },
      ]);
      await services.withOrigin(originB).organizations.createOrganizations([
        { id: uuidv7(), name: 'Org in Tenant B' },
      ]);
    });

    it('should scope data to the tenant specified in x-tenant-id', async () => {
      // Query orgs for Tenant A
      const resA = await client.query('organizations.getOrganizations', undefined, {
        tenantId: tenantAId,
      });
      expect(resA.status).toBe(200);
      const orgsA = resA.json.result.data;
      expect(orgsA).toHaveLength(1);
      expect(orgsA[0].name).toBe('Org in Tenant A');

      // Query orgs for Tenant B
      const resB = await client.query('organizations.getOrganizations', undefined, {
        tenantId: tenantBId,
      });
      expect(resB.status).toBe(200);
      const orgsB = resB.json.result.data;
      expect(orgsB).toHaveLength(1);
      expect(orgsB[0].name).toBe('Org in Tenant B');
    });

    it('should return empty data when x-tenant-id is for a tenant user is not member of', async () => {
      // Create a separate user not in any tenant
      const user = await createUser(db, 'outsider@test.com');

      client.clearCookies();
      await signInAs(client, user.userId);

      // This user is not in Tenant A, so should see no orgs
      const res = await client.query('organizations.getOrganizations', undefined, {
        tenantId: tenantAId,
      });
      expect(res.status).toBe(200);
      expect(res.json.result.data).toHaveLength(0);
    });

    it('should reject a tenant-scoped query sent without the header', async () => {
      const res = await client.query('organizations.getOrganizations');

      expect(res.json.error.data.code).toBe('BAD_REQUEST');
    });

    it('should not let a tenant-less caller enumerate the platform users', async () => {
      const outsider = await createUser(db, 'outsider@test.com');
      client.clearCookies();
      await signInAs(client, outsider.userId);

      const res = await client.query('users.getUsers');

      expect(res.status).toBe(200);
      expect(res.json.result.data.map((user: { id: string }) => user.id)).toEqual([outsider.userId]);
    });

    it('should not let a member of one tenant read the users of another', async () => {
      const outsider = await createUser(db, 'outsider@test.com');
      await services.withOrigin({ type: 'client', userId: adminId, tenantId: tenantAId })
        .tenants.addTenantUser(tenantAId, outsider.userId);

      client.clearCookies();
      await signInAs(client, outsider.userId);

      const res = await client.query('users.getUsers', undefined, { tenantId: tenantBId });

      expect(res.status).toBe(200);
      expect(res.json.result.data).toHaveLength(0);
    });

    it('should still serve the tenant list without the header', async () => {
      const res = await client.query('tenants.getTenants');

      expect(res.status).toBe(200);
      // `signInAsFirstAdmin` gives the admin a tenant of its own as well.
      expect(res.json.result.data.map((tenant: { id: string }) => tenant.id).sort())
        .toEqual([DEFAULT_TENANT_ID, tenantAId, tenantBId].sort());
    });
  });

  describe('public routes', () => {
    it('should allow health check without authentication', async () => {
      const res = await client.query('health');
      expect(res.status).toBe(200);
      expect(res.json.result.data.status).toBe('ok');
    });

    it('should report the image version in the health check, 0.0.0-dev without one', async () => {
      try {
        vi.stubEnv('APP_VERSION', '0.261112.0-dev.0fed327');
        expect((await client.query('health')).json.result.data.version).toBe('0.261112.0-dev.0fed327');
        vi.stubEnv('APP_VERSION', undefined);
        expect((await client.query('health')).json.result.data.version).toBe('0.0.0-dev');
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it('should allow authStatus without authentication', async () => {
      const res = await client.query('authStatus');
      expect(res.status).toBe(200);
      expect(res.json.result.data).toHaveProperty('xtmSignIn');
      // The bootstrap payload carries the enabled feature flags to an unauthenticated client,
      // so the frontend can resolve a gate before anyone logs in.
      expect(Array.isArray(res.json.result.data.featureFlags)).toBe(true);
    });

    it('should allow isLoggedIn without authentication (returns null)', async () => {
      const res = await client.query('isLoggedIn');
      expect(res.status).toBe(200);
      expect(res.json.result.data).toBeNull();
    });

    it('should return user data from isLoggedIn when authenticated', async () => {
      await signInAsFirstAdmin(client, { id: uuidv7(), email: ADMIN_EMAIL });

      const res = await client.query('isLoggedIn');
      expect(res.status).toBe(200);
      expect(res.json.result.data.email).toBe(ADMIN_EMAIL);
    });
  });

  describe('deleteTenantsTransaction', () => {
    let adminId: string;
    let tenantId: string;

    beforeEach(async () => {
      adminId = uuidv7();
      await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });

      tenantId = uuidv7();
      await services.withOrigin({ type: 'platform', userId: adminId })
        .tenants.createTenant({ id: tenantId, name: 'Test Tenant' }, adminId);
    });

    it('should delete a tenant for a caller holding CREATE_TENANTS', async () => {
      const res = await client.mutation('tenants.deleteTenantsTransaction', [tenantId]);

      expect(res.status).toBe(200);
      const tenants = await services.withOrigin({ type: 'platform', userId: adminId }).tenants.getTenants();
      expect(tenants.map((tenant) => tenant.id)).not.toContain(tenantId);
    });

    it('should return FORBIDDEN for a member without CREATE_TENANTS', async () => {
      const regularUser = await createUser(db);
      await services.withOrigin({ type: 'client', userId: adminId, tenantId })
        .tenants.addTenantUser(tenantId, regularUser.userId);
      client.clearCookies();
      await signInAs(client, regularUser.userId);

      const res = await client.mutation('tenants.deleteTenantsTransaction', [tenantId]);

      expect(res.json.error.data.code).toBe('FORBIDDEN');
    });

    it('should return CONFLICT when a row still references the tenant', async () => {
      await db.execute(sql`CREATE TABLE tenant_delete_blocker (tenant_id uuid NOT NULL REFERENCES tenants(id))`);
      try {
        await db.execute(sql`INSERT INTO tenant_delete_blocker VALUES (${tenantId})`);

        const res = await client.mutation('tenants.deleteTenantsTransaction', [tenantId]);

        expect(res.json.error.data.code).toBe('CONFLICT');
      } finally {
        await db.execute(sql`DROP TABLE tenant_delete_blocker`);
      }
    });
  });

  describe('renameTenant', () => {
    let adminId: string;
    let tenantId: string;

    const nameOf = async (id: string) => (await services.withOrigin({ type: 'system' }).tenants.getTenant(id))?.name;

    beforeEach(async () => {
      adminId = uuidv7();
      await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });

      tenantId = uuidv7();
      await services.withOrigin({ type: 'platform', userId: adminId })
        .tenants.createTenant({ id: tenantId, name: 'Test Tenant' }, adminId);
    });

    it('should rename a tenant for a member holding CREATE_TENANTS', async () => {
      const res = await client.mutation('tenants.renameTenant', { id: tenantId, name: '  Renamed Tenant  ' });

      expect(res.status).toBe(200);
      expect(await nameOf(tenantId)).toBe('Renamed Tenant');
    });

    it('should return FORBIDDEN for a member without CREATE_TENANTS', async () => {
      const regularUser = await createUser(db);
      await services.withOrigin({ type: 'client', userId: adminId, tenantId })
        .tenants.addTenantUser(tenantId, regularUser.userId);
      client.clearCookies();
      await signInAs(client, regularUser.userId);

      const res = await client.mutation('tenants.renameTenant', { id: tenantId, name: 'Hijacked' });

      expect(res.json.error.data.code).toBe('FORBIDDEN');
      expect(await nameOf(tenantId)).toBe('Test Tenant');
    });

    it('should return BAD_REQUEST for a blank name', async () => {
      const res = await client.mutation('tenants.renameTenant', { id: tenantId, name: '   ' });

      expect(res.json.error.data.code).toBe('BAD_REQUEST');
      expect(await nameOf(tenantId)).toBe('Test Tenant');
    });

    it('should rename the tenant whichever tenant x-tenant-id names', async () => {
      const otherTenantId = uuidv7();
      await services.withOrigin({ type: 'platform', userId: adminId })
        .tenants.createTenant({ id: otherTenantId, name: 'Other Tenant' }, adminId);

      const res = await client.mutation('tenants.renameTenant', { id: tenantId, name: 'Renamed Tenant' }, { tenantId: otherTenantId });

      expect(res.status).toBe(200);
      expect(await nameOf(tenantId)).toBe('Renamed Tenant');
      expect(await nameOf(otherTenantId)).toBe('Other Tenant');
    });
  });

  describe('createTenantsTransaction', () => {
    it('should return BAD_REQUEST for a blank name', async () => {
      await signInAsFirstAdmin(client, { id: uuidv7(), email: ADMIN_EMAIL });

      const res = await client.mutation('tenants.createTenantsTransaction', { id: uuidv7(), name: '   ' });

      expect(res.json.error.data.code).toBe('BAD_REQUEST');
    });
  });

  describe('platform-security routers require MANAGE_USERS', () => {
    let adminId: string;

    beforeEach(async () => {
      adminId = uuidv7();
      await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });
    });

    it('should let the platform admin through both routers, reads and mutations', async () => {
      const rolesRead = await client.query('platformRoles.getPlatformRoles');
      expect(rolesRead.status).toBe(200);

      const groupsRead = await client.query('platformGroups.getPlatformGroups');
      expect(groupsRead.status).toBe(200);

      const roleCreate = await client.mutation('platformRoles.createPlatformRole', { id: uuidv7(), name: 'Auditor' });
      expect(roleCreate.status).toBe(200);
    });

    it('should return FORBIDDEN to an authenticated user with no platform capability, on a read and a mutation of both routers', async () => {
      const outsider = await createUser(db, 'outsider@test.com');
      client.clearCookies();
      await signInAs(client, outsider.userId);

      const rolesRead = await client.query('platformRoles.getPlatformRoles');
      expect(rolesRead.json.error.data.code).toBe('FORBIDDEN');

      const rolesCreate = await client.mutation('platformRoles.createPlatformRole', { id: uuidv7(), name: 'Escalation' });
      expect(rolesCreate.json.error.data.code).toBe('FORBIDDEN');

      const groupsRead = await client.query('platformGroups.getPlatformGroups');
      expect(groupsRead.json.error.data.code).toBe('FORBIDDEN');

      const groupsCreate = await client.mutation('platformGroups.createPlatformGroup', { id: uuidv7(), name: 'Escalation' });
      expect(groupsCreate.json.error.data.code).toBe('FORBIDDEN');
    });

    it('should serve the platform users list to the platform admin and refuse it to an uncapable caller', async () => {
      const adminRead = await client.query('users.listPlatformUsers');
      expect(adminRead.status).toBe(200);

      const outsider = await createUser(db, 'outsider@test.com');
      client.clearCookies();
      await signInAs(client, outsider.userId);

      const outsiderRead = await client.query('users.listPlatformUsers');
      expect(outsiderRead.json.error.data.code).toBe('FORBIDDEN');
    });

    it('should not narrow the platform users and group members to the tenant an x-tenant-id header names', async () => {
      const tenantId = await createTenant(services, adminId);
      const outsider = await createUser(db, 'outsider@test.com');
      const platformGroupId = uuidv7();
      await client.mutation('platformGroups.createPlatformGroup', { id: platformGroupId, name: 'Auditors' });
      await client.mutation('platformGroups.addUserToPlatformGroup', { platformGroupId, userId: outsider.userId });

      const users = await client.query('users.listPlatformUsers', undefined, { tenantId });
      expect(users.json.result.data.map((user: { id: string }) => user.id)).toEqual(expect.arrayContaining([adminId, outsider.userId]));

      const groups = await client.query('platformGroups.listPlatformGroups', undefined, { tenantId });
      expect(groups.json.result.data.find((group: { id: string }) => group.id === platformGroupId)?.memberCount).toBe(1);

      const members = await client.query('platformGroups.getPlatformGroupUsers', { platformGroupId }, { tenantId });
      expect(members.json.result.data.map((row: { user: { id: string } }) => row.user.id)).toEqual([outsider.userId]);
    });

    it('should return FORBIDDEN for the same caller sending the x-tenant-id header (client origin, the bypass a platform-only check would miss)', async () => {
      const outsider = await createUser(db, 'outsider@test.com');
      client.clearCookies();
      await signInAs(client, outsider.userId);

      const read = await client.query('platformRoles.getPlatformRoles', undefined, { tenantId: uuidv7() });
      expect(read.json.error.data.code).toBe('FORBIDDEN');

      const create = await client.mutation('platformRoles.createPlatformRole', { id: uuidv7(), name: 'Escalation' }, { tenantId: uuidv7() });
      expect(create.json.error.data.code).toBe('FORBIDDEN');
    });

    it('should serve a user\'s platform effective permissions to the platform admin and refuse them to an uncapable caller, with or without x-tenant-id', async () => {
      const adminRead = await client.query('platformCapabilities.getUserPlatformEffectivePermissions', { userId: adminId });
      expect(adminRead.status).toBe(200);
      expect(adminRead.json.result.data.map((row: { capabilityId: string }) => row.capabilityId)).toContain(PlatformCapability_ManageUsers);

      const outsider = await createUser(db, 'outsider@test.com');
      const tenantId = await createTenant(services, adminId);
      await services.withOrigin({ type: 'client', userId: adminId, tenantId }).tenants.addTenantUser(tenantId, outsider.userId);
      client.clearCookies();
      await signInAs(client, outsider.userId);

      const platformRead = await client.query('platformCapabilities.getUserPlatformEffectivePermissions', { userId: adminId });
      expect(platformRead.json.error?.data.code).toBe('FORBIDDEN');

      const clientRead = await client.query('platformCapabilities.getUserPlatformEffectivePermissions', { userId: adminId }, { tenantId });
      expect(clientRead.json.error?.data.code).toBe('FORBIDDEN');
    });

    it('should return FORBIDDEN for a service account', async () => {
      const server = await getTestServer();
      const tenantId = await createTenant(services, adminId);
      const saClient = await createServiceAccountClient(server, services, { type: 'client', userId: adminId, tenantId });

      const read = await saClient.query('platformRoles.getPlatformRoles');
      expect(read.json.error.data.code).toBe('FORBIDDEN');
    });

    it('should still answer hasPlatformAccess for an uncapable caller, since the route guard and the navbar depend on it', async () => {
      const outsider = await createUser(db, 'outsider@test.com');
      client.clearCookies();
      await signInAs(client, outsider.userId);

      const res = await client.query('platformCapabilities.hasPlatformAccess');
      expect(res.status).toBe(200);
      expect(res.json.result.data).toBe(false);
    });

    it('should return CONFLICT, not an opaque 500, when a capable caller would revoke the last MANAGE_USERS holder, and leave the platform reachable', async () => {
      const groupsRes = await client.query('platformGroups.getUserPlatformGroups', { userId: adminId });
      const adminGroupId = groupsRes.json.result.data[0].group.id;
      const rolesRes = await client.query('platformGroups.getPlatformGroupRoles', { platformGroupId: adminGroupId });
      const adminRoleId = rolesRes.json.result.data[0].role.id;

      const res = await client.mutation('platformRoles.removeCapabilityFromPlatformRole', {
        platformRoleId: adminRoleId, capabilityId: PlatformCapability_ManageUsers,
      });
      expect(res.json.error.data.code).toBe('CONFLICT');
      expect(res.json.error.message).toBe('The platform must keep at least one user holding the Manage Users capability');

      const stillReachable = await client.query('platformRoles.getPlatformRoles');
      expect(stillReachable.status).toBe(200);
    });

    it.each([
      {
        name: 'platformRoles.deletePlatformRole',
        run: (ids: { adminGroupId: string, adminRoleId: string }) => client.mutation('platformRoles.deletePlatformRole', { id: ids.adminRoleId }),
      },
      {
        name: 'platformGroups.removeUserFromPlatformGroup',
        run: (ids: { adminGroupId: string, adminRoleId: string }) => client.mutation('platformGroups.removeUserFromPlatformGroup', { platformGroupId: ids.adminGroupId, userId: adminId }),
      },
      {
        name: 'platformGroups.removeRoleFromPlatformGroup',
        run: (ids: { adminGroupId: string, adminRoleId: string }) => client.mutation('platformGroups.removeRoleFromPlatformGroup', { platformGroupId: ids.adminGroupId, platformRoleId: ids.adminRoleId }),
      },
      {
        name: 'platformGroups.deletePlatformGroup',
        run: (ids: { adminGroupId: string, adminRoleId: string }) => client.mutation('platformGroups.deletePlatformGroup', { id: ids.adminGroupId }),
      },
    ])('should return CONFLICT, not an opaque 500, when $name would revoke the last MANAGE_USERS holder', async ({ run }) => {
      const groupsRes = await client.query('platformGroups.getUserPlatformGroups', { userId: adminId });
      const adminGroupId = groupsRes.json.result.data[0].group.id;
      const rolesRes = await client.query('platformGroups.getPlatformGroupRoles', { platformGroupId: adminGroupId });
      const adminRoleId = rolesRes.json.result.data[0].role.id;

      const res = await run({ adminGroupId, adminRoleId });
      expect(res.json.error.data.code).toBe('CONFLICT');

      const stillReachable = await client.query('platformRoles.getPlatformRoles');
      expect(stillReachable.status).toBe(200);
    });
  });
});
