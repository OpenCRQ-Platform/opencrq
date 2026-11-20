import { Capability_ManageSecurity } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createUser, grantCapability } from '../../helpers/factories';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAs, signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';

describe('Authorization (HTTP/tRPC)', () => {
  let client: ReturnType<typeof createTrpcTestClient>;
  const services = createTestServices(db);

  beforeEach(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    client = createTrpcTestClient(server);
  });

  describe('updateTenantUserProfile authorization', () => {
    let adminId: string;
    let tenantId: string;

    beforeEach(async () => {
      adminId = uuidv7();
      await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });

      tenantId = uuidv7();
      await services.withOrigin({ type: 'platform', userId: adminId })
        .tenants.createTenant({ id: tenantId, name: 'Test Tenant' }, adminId);
    });

    it('should allow a user to update their own tenant profile', async () => {
      const res = await client.mutation('tenants.updateTenantUserProfile', {
        tenantId, userId: adminId, name: 'My Tenant Name', title: 'My Tenant Title',
      }, { tenantId });

      expect(res.status).toBe(200);
    });

    it('should allow an admin to update another user tenant profile', async () => {
      const otherUser = await createUser(db);
      await services.withOrigin({ type: 'client', userId: adminId, tenantId })
        .tenants.addTenantUser(tenantId, otherUser.userId);

      const res = await client.mutation('tenants.updateTenantUserProfile', {
        tenantId, userId: otherUser.userId, name: 'Admin Set Name',
      }, { tenantId });

      expect(res.status).toBe(200);
    });

    it('should return FORBIDDEN when a non-admin updates another user tenant profile', async () => {
      const regularUser = await createUser(db);
      await services.withOrigin({ type: 'client', userId: adminId, tenantId })
        .tenants.addTenantUser(tenantId, regularUser.userId);

      // Login as the regular user
      client.clearCookies();
      await signInAs(client, regularUser.userId);

      const res = await client.mutation('tenants.updateTenantUserProfile', {
        tenantId, userId: adminId, name: 'Should Fail',
      }, { tenantId });

      expect(res.json.error).toBeTruthy();
      expect(res.json.error.data.code).toBe('FORBIDDEN');
    });

    it('should return FORBIDDEN when the input tenant does not match the x-tenant-id header', async () => {
      const tenantBId = uuidv7();
      await services.withOrigin({ type: 'platform', userId: adminId })
        .tenants.createTenant({ id: tenantBId, name: 'Tenant B' }, adminId);

      const res = await client.mutation('tenants.updateTenantUserProfile', {
        tenantId, userId: adminId, name: 'Should Fail',
      }, { tenantId: tenantBId });

      expect(res.json.error).toBeTruthy();
      expect(res.json.error.data.code).toBe('FORBIDDEN');
    });

    it('should return FORBIDDEN for a manager of this tenant who is not a member of the tenant named in the input, and leave that profile unchanged', async () => {
      const tenantBId = uuidv7();
      await services.withOrigin({ type: 'platform', userId: adminId })
        .tenants.createTenant({ id: tenantBId, name: 'Tenant B' }, adminId);
      const originB = { type: 'client' as const, userId: adminId, tenantId: tenantBId };
      const targetInB = await createUser(db);
      await services.withOrigin(originB).tenants.addTenantUser(tenantBId, targetInB.userId);
      const manager = await createUser(db);
      await services.withOrigin({ type: 'client', userId: adminId, tenantId })
        .tenants.addTenantUser(tenantId, manager.userId);
      await grantCapability(services, { type: 'client', userId: adminId, tenantId }, manager.userId, Capability_ManageSecurity);

      client.clearCookies();
      await signInAs(client, manager.userId);

      const res = await client.mutation('tenants.updateTenantUserProfile', {
        tenantId: tenantBId, userId: targetInB.userId, name: 'Hijacked',
      }, { tenantId });

      expect(res.json.error.data.code).toBe('FORBIDDEN');
      expect(await services.withOrigin({ type: 'system' }).tenants.getTenantUserProfile(tenantBId, targetInB.userId))
        .toEqual({ name: null, title: null });
    });

    it('should return FORBIDDEN when no x-tenant-id header is sent', async () => {
      const res = await client.mutation('tenants.updateTenantUserProfile', {
        tenantId, userId: adminId, name: 'Should Fail',
      });

      expect(res.json.error).toBeTruthy();
      expect(res.json.error.data.code).toBe('FORBIDDEN');
    });

    it('should return FORBIDDEN for a member of this tenant who is an admin of another tenant', async () => {
      const tenantBId = uuidv7();
      await services.withOrigin({ type: 'platform', userId: adminId })
        .tenants.createTenant({ id: tenantBId, name: 'Tenant B' }, adminId);

      const crossTenantUser = await createUser(db);
      await services.withOrigin({ type: 'client', userId: adminId, tenantId })
        .tenants.addTenantUser(tenantId, crossTenantUser.userId);
      await services.withOrigin({ type: 'client', userId: adminId, tenantId: tenantBId })
        .tenants.addTenantUser(tenantBId, crossTenantUser.userId);
      await grantCapability(
        services,
        { type: 'client', userId: adminId, tenantId: tenantBId },
        crossTenantUser.userId,
        Capability_ManageSecurity,
      );

      client.clearCookies();
      await signInAs(client, crossTenantUser.userId);

      const res = await client.mutation('tenants.updateTenantUserProfile', {
        tenantId, userId: adminId, name: 'Should Fail',
      }, { tenantId });

      expect(res.json.error).toBeTruthy();
      expect(res.json.error.data.code).toBe('FORBIDDEN');
    });
  });

  describe('getTenantUserProfile authorization', () => {
    let adminId: string;
    let tenantId: string;

    beforeEach(async () => {
      adminId = uuidv7();
      await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });

      tenantId = uuidv7();
      await services.withOrigin({ type: 'platform', userId: adminId })
        .tenants.createTenant({ id: tenantId, name: 'Test Tenant' }, adminId);
    });

    it('should allow a member to read a tenant profile in their own tenant', async () => {
      const res = await client.query('tenants.getTenantUserProfile', {
        tenantId, userId: adminId,
      }, { tenantId });

      expect(res.status).toBe(200);
    });

    it('should answer null, not an empty result, for a user who is no longer a member', async () => {
      const formerMember = await createUser(db);
      await services.withOrigin({ type: 'client', userId: adminId, tenantId })
        .tenants.addTenantUser(tenantId, formerMember.userId);
      await services.withOrigin({ type: 'client', userId: adminId, tenantId })
        .tenants.removeTenantUser(tenantId, formerMember.userId);

      const res = await client.query('tenants.getTenantUserProfile', {
        tenantId, userId: formerMember.userId,
      }, { tenantId });

      expect(res.status).toBe(200);
      expect(res.json.result).toEqual({ data: null });
    });

    it('should return FORBIDDEN when the input tenant does not match the x-tenant-id header', async () => {
      const tenantBId = uuidv7();
      await services.withOrigin({ type: 'platform', userId: adminId })
        .tenants.createTenant({ id: tenantBId, name: 'Tenant B' }, adminId);

      const res = await client.query('tenants.getTenantUserProfile', {
        tenantId, userId: adminId,
      }, { tenantId: tenantBId });

      expect(res.json.error).toBeTruthy();
      expect(res.json.error.data.code).toBe('FORBIDDEN');
    });

    it('should return FORBIDDEN when no x-tenant-id header is sent', async () => {
      const res = await client.query('tenants.getTenantUserProfile', {
        tenantId, userId: adminId,
      });

      expect(res.json.error).toBeTruthy();
      expect(res.json.error.data.code).toBe('FORBIDDEN');
    });

    it('should return FORBIDDEN for a member of another tenant reading a profile in this one', async () => {
      const outsider = await createUser(db);
      const tenantBId = uuidv7();
      await services.withOrigin({ type: 'platform', userId: adminId })
        .tenants.createTenant({ id: tenantBId, name: 'Tenant B' }, adminId);
      await services.withOrigin({ type: 'client', userId: adminId, tenantId: tenantBId })
        .tenants.addTenantUser(tenantBId, outsider.userId);

      client.clearCookies();
      await signInAs(client, outsider.userId);

      const res = await client.query('tenants.getTenantUserProfile', {
        tenantId, userId: adminId,
      }, { tenantId });

      expect(res.json.error).toBeTruthy();
      expect(res.json.error.data.code).toBe('FORBIDDEN');
    });
  });

  describe('removeTenantUser authorization', () => {
    let adminId: string;
    let tenantId: string;

    beforeEach(async () => {
      adminId = uuidv7();
      await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });

      tenantId = uuidv7();
      await services.withOrigin({ type: 'platform', userId: adminId })
        .tenants.createTenant({ id: tenantId, name: 'Test Tenant' }, adminId);
    });

    it('should allow an admin to remove another tenant user', async () => {
      const otherUser = await createUser(db);
      await services.withOrigin({ type: 'client', userId: adminId, tenantId })
        .tenants.addTenantUser(tenantId, otherUser.userId);

      const res = await client.mutation('tenants.removeTenantUser', {
        tenantId, userId: otherUser.userId,
      }, { tenantId });

      expect(res.status).toBe(200);
    });

    it('should return NOT_FOUND when removing a user who is no longer a member', async () => {
      const formerMember = await createUser(db);
      await services.withOrigin({ type: 'client', userId: adminId, tenantId })
        .tenants.addTenantUser(tenantId, formerMember.userId);
      await services.withOrigin({ type: 'client', userId: adminId, tenantId })
        .tenants.removeTenantUser(tenantId, formerMember.userId);

      const res = await client.mutation('tenants.removeTenantUser', {
        tenantId, userId: formerMember.userId,
      }, { tenantId });

      expect(res.json.error.data.code).toBe('NOT_FOUND');
    });

    it('should return FORBIDDEN when a non-admin removes a tenant user', async () => {
      const regularUser = await createUser(db);
      const otherUser = await createUser(db);
      await services.withOrigin({ type: 'client', userId: adminId, tenantId })
        .tenants.addTenantUser(tenantId, regularUser.userId);
      await services.withOrigin({ type: 'client', userId: adminId, tenantId })
        .tenants.addTenantUser(tenantId, otherUser.userId);

      client.clearCookies();
      await signInAs(client, regularUser.userId);

      const res = await client.mutation('tenants.removeTenantUser', {
        tenantId, userId: otherUser.userId,
      }, { tenantId });

      expect(res.json.error).toBeTruthy();
      expect(res.json.error.data.code).toBe('FORBIDDEN');
    });

    it('should return FORBIDDEN when the input tenant does not match the x-tenant-id header', async () => {
      const tenantBId = uuidv7();
      await services.withOrigin({ type: 'platform', userId: adminId })
        .tenants.createTenant({ id: tenantBId, name: 'Tenant B' }, adminId);

      const res = await client.mutation('tenants.removeTenantUser', {
        tenantId, userId: adminId,
      }, { tenantId: tenantBId });

      expect(res.json.error).toBeTruthy();
      expect(res.json.error.data.code).toBe('FORBIDDEN');
    });

    it('should return FORBIDDEN when no x-tenant-id header is sent', async () => {
      const res = await client.mutation('tenants.removeTenantUser', {
        tenantId, userId: adminId,
      });

      expect(res.json.error).toBeTruthy();
      expect(res.json.error.data.code).toBe('FORBIDDEN');
    });

    it('should return FORBIDDEN for a member of another tenant removing a user in this one', async () => {
      const outsider = await createUser(db);
      const tenantBId = uuidv7();
      await services.withOrigin({ type: 'platform', userId: adminId })
        .tenants.createTenant({ id: tenantBId, name: 'Tenant B' }, adminId);
      await services.withOrigin({ type: 'client', userId: adminId, tenantId: tenantBId })
        .tenants.addTenantUser(tenantBId, outsider.userId);

      client.clearCookies();
      await signInAs(client, outsider.userId);

      const res = await client.mutation('tenants.removeTenantUser', {
        tenantId, userId: adminId,
      }, { tenantId });

      expect(res.json.error).toBeTruthy();
      expect(res.json.error.data.code).toBe('FORBIDDEN');
    });
  });

  describe('getTenantUsers authorization', () => {
    let adminId: string;
    let tenantId: string;

    beforeEach(async () => {
      adminId = uuidv7();
      await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });

      tenantId = uuidv7();
      await services.withOrigin({ type: 'platform', userId: adminId })
        .tenants.createTenant({ id: tenantId, name: 'Test Tenant' }, adminId);
    });

    it('should allow a member to list the users of their own tenant', async () => {
      const res = await client.query('tenants.getTenantUsers', { tenantId }, { tenantId });

      expect(res.status).toBe(200);
    });

    it('should return FORBIDDEN when the input tenant does not match the x-tenant-id header', async () => {
      const tenantBId = uuidv7();
      await services.withOrigin({ type: 'platform', userId: adminId })
        .tenants.createTenant({ id: tenantBId, name: 'Tenant B' }, adminId);

      const res = await client.query('tenants.getTenantUsers', { tenantId }, { tenantId: tenantBId });

      expect(res.json.error).toBeTruthy();
      expect(res.json.error.data.code).toBe('FORBIDDEN');
    });

    it('should return FORBIDDEN when no x-tenant-id header is sent', async () => {
      const res = await client.query('tenants.getTenantUsers', { tenantId });

      expect(res.json.error).toBeTruthy();
      expect(res.json.error.data.code).toBe('FORBIDDEN');
    });

    it('should return FORBIDDEN for a member of another tenant reading the users of this one', async () => {
      const outsider = await createUser(db);
      const tenantBId = uuidv7();
      await services.withOrigin({ type: 'platform', userId: adminId })
        .tenants.createTenant({ id: tenantBId, name: 'Tenant B' }, adminId);
      await services.withOrigin({ type: 'client', userId: adminId, tenantId: tenantBId })
        .tenants.addTenantUser(tenantBId, outsider.userId);

      client.clearCookies();
      await signInAs(client, outsider.userId);

      const res = await client.query('tenants.getTenantUsers', { tenantId }, { tenantId });

      expect(res.json.error).toBeTruthy();
      expect(res.json.error.data.code).toBe('FORBIDDEN');
    });
  });

  describe('listTenantUsers authorization', () => {
    let adminId: string;
    let tenantId: string;

    beforeEach(async () => {
      adminId = uuidv7();
      await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });

      tenantId = uuidv7();
      await services.withOrigin({ type: 'platform', userId: adminId })
        .tenants.createTenant({ id: tenantId, name: 'Test Tenant' }, adminId);
    });

    it('should allow a member to list the users of their own tenant', async () => {
      const res = await client.query('tenants.listTenantUsers', { tenantId }, { tenantId });

      expect(res.status).toBe(200);
      expect(res.json.result.data.map((row: { id: string }) => row.id)).toEqual([adminId]);
    });

    it('should return FORBIDDEN when the input tenant does not match the x-tenant-id header', async () => {
      const tenantBId = uuidv7();
      await services.withOrigin({ type: 'platform', userId: adminId })
        .tenants.createTenant({ id: tenantBId, name: 'Tenant B' }, adminId);

      const res = await client.query('tenants.listTenantUsers', { tenantId }, { tenantId: tenantBId });

      expect(res.json.error).toBeTruthy();
      expect(res.json.error.data.code).toBe('FORBIDDEN');
    });

    it('should return FORBIDDEN when no x-tenant-id header is sent', async () => {
      const res = await client.query('tenants.listTenantUsers', { tenantId });

      expect(res.json.error).toBeTruthy();
      expect(res.json.error.data.code).toBe('FORBIDDEN');
    });

    it('should return FORBIDDEN for a member of another tenant reading the users of this one', async () => {
      const outsider = await createUser(db);
      const tenantBId = uuidv7();
      await services.withOrigin({ type: 'platform', userId: adminId })
        .tenants.createTenant({ id: tenantBId, name: 'Tenant B' }, adminId);
      await services.withOrigin({ type: 'client', userId: adminId, tenantId: tenantBId })
        .tenants.addTenantUser(tenantBId, outsider.userId);

      client.clearCookies();
      await signInAs(client, outsider.userId);

      const res = await client.query('tenants.listTenantUsers', { tenantId }, { tenantId });

      expect(res.json.error).toBeTruthy();
      expect(res.json.error.data.code).toBe('FORBIDDEN');
    });
  });
});
