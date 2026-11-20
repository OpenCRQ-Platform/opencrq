import type { EventOrigin } from '@app/module';
import { Capability_ManageSecurity } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createAdminUser, createTenant, createTenantUser, createTenantWithAdmin, grantCapability } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('Security Policies', () => {
  beforeEach(async () => {
    await truncateAllTables(db);
  });

  describe('tenantIsolationPolicy', () => {
    it('should filter reads by tenant membership for tables with tenantId', async () => {
      const { origin: originA, userId } = await createTenantWithAdmin(services);

      // Create org in Tenant A
      await services.withOrigin(originA).organizations.createOrganizations([
        { id: uuidv7(), name: 'Org A' },
      ]);

      // Since we can only call createAdminUser once (locks on first user), we use the admin from A
      const tenantBId = await createTenant(services, userId);
      const originB: EventOrigin = { type: 'client', userId, tenantId: tenantBId };

      await services.withOrigin(originB).organizations.createOrganizations([
        { id: uuidv7(), name: 'Org B' },
      ]);

      // Admin in context A only sees Org A
      const orgsA = await services.withOrigin(originA).organizations.getOrganizations();
      expect(orgsA).toHaveLength(1);
      expect(orgsA[0].name).toBe('Org A');

      // Admin in context B only sees Org B
      const orgsB = await services.withOrigin(originB).organizations.getOrganizations();
      expect(orgsB).toHaveLength(1);
      expect(orgsB[0].name).toBe('Org B');
    });

    it('should block writes for cross-tenant creation', async () => {
      const { origin, userId } = await createTenantWithAdmin(services);

      // Create a second tenant
      const tenantBId = await createTenant(services, userId);

      const wrongOrigin: EventOrigin = { type: 'client', userId, tenantId: tenantBId };

      // We can only create in the tenant that matches our origin: the service enforces this
      // by injecting tenantId from eventOrigin. So cross-tenant creation is structurally prevented.
      const orgId = uuidv7();
      await services.withOrigin(wrongOrigin).organizations.createOrganizations([
        { id: orgId, name: 'Test Org' },
      ]);

      // The org should be visible in tenant B (where origin points), not in tenant A
      const orgsB = await services.withOrigin(wrongOrigin).organizations.getOrganizations();
      expect(orgsB).toHaveLength(1);

      const orgsA = await services.withOrigin(origin).organizations.getOrganizations();
      expect(orgsA).toHaveLength(0);
    });
  });

  describe('tenantMembershipPolicy', () => {
    it('should only show tenants where user is a member', async () => {
      const admin = await createAdminUser(services);
      const tenantAId = await createTenant(services, admin.userId);
      await createTenant(services, admin.userId);

      // Create user only in tenant A
      const userA = await createTenantUser(
        services, db,
        { type: 'client', userId: admin.userId, tenantId: tenantAId },
      );

      const tenantsForUserA = await services.withOrigin(userA.origin).tenants.getTenants();
      expect(tenantsForUserA).toHaveLength(1);
      expect(tenantsForUserA[0].id).toBe(tenantAId);
    });
  });

  describe('tenantUsersPolicy', () => {
    it('should only show users that share the same tenant', async () => {
      const admin = await createAdminUser(services);
      const tenantAId = await createTenant(services, admin.userId);
      const tenantBId = await createTenant(services, admin.userId);

      const userA = await createTenantUser(
        services, db,
        { type: 'client', userId: admin.userId, tenantId: tenantAId },
      );
      const userB = await createTenantUser(
        services, db,
        { type: 'client', userId: admin.userId, tenantId: tenantBId },
      );

      // User A should see admin (co-tenant) and themselves, but NOT user B
      const usersSeenByA = await services.withOrigin(userA.origin).users.getUsers();
      const userIds = usersSeenByA.map((u) => u.id);
      expect(userIds).toContain(admin.userId);
      expect(userIds).toContain(userA.userId);
      expect(userIds).not.toContain(userB.userId);
    });
  });

  describe('tenantUserRowsPolicy', () => {
    const twoTenants = async () => {
      const admin = await createAdminUser(services);
      const tenantAId = await createTenant(services, admin.userId);
      const tenantBId = await createTenant(services, admin.userId);
      const adminOriginInA: EventOrigin = { type: 'client', userId: admin.userId, tenantId: tenantAId };
      const adminOriginInB: EventOrigin = { type: 'client', userId: admin.userId, tenantId: tenantBId };
      const memberOfA = await createTenantUser(services, db, adminOriginInA);
      const memberOfB = await createTenantUser(services, db, adminOriginInB);
      return { admin, tenantAId, tenantBId, adminOriginInA, adminOriginInB, memberOfA, memberOfB };
    };

    it('should hide the members of a tenant from a client who is not in it, whatever tenant the origin names', async () => {
      const { tenantBId, memberOfA, memberOfB } = await twoTenants();
      const lyingOrigin: EventOrigin = { type: 'client', userId: memberOfA.userId, tenantId: tenantBId };

      expect(await services.withOrigin(lyingOrigin).tenants.isTenantUser(tenantBId, memberOfB.userId)).toBe(false);
    });

    it('should show a platform origin the members of the tenants it belongs to', async () => {
      const { tenantAId, admin, memberOfA } = await twoTenants();
      const platformOrigin: EventOrigin = { type: 'platform', userId: memberOfA.userId };

      expect(await services.withOrigin(platformOrigin).tenants.isTenantUser(tenantAId, admin.userId)).toBe(true);
    });

    it('should hide the members of other tenants from a platform origin without MANAGE_USERS', async () => {
      const { tenantBId, memberOfA, memberOfB } = await twoTenants();
      const platformOrigin: EventOrigin = { type: 'platform', userId: memberOfA.userId };

      expect(await services.withOrigin(platformOrigin).tenants.isTenantUser(tenantBId, memberOfB.userId)).toBe(false);
    });

    it('should show a platform origin holding MANAGE_USERS the members of a tenant it does not belong to', async () => {
      const { admin, tenantBId, adminOriginInB, memberOfB } = await twoTenants();
      await services.withOrigin(adminOriginInB).tenants.removeTenantUser(tenantBId, admin.userId);
      const platformOrigin: EventOrigin = { type: 'platform', userId: admin.userId };

      expect(await services.withOrigin(platformOrigin).tenants.isTenantUser(tenantBId, memberOfB.userId)).toBe(true);
    });

    it('should scope a connector to the members of its own tenant', async () => {
      const { admin, tenantAId, tenantBId, adminOriginInA, memberOfB } = await twoTenants();
      const serviceAccountId = uuidv7();
      await services.withOrigin(adminOriginInA).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'Test Bot' });
      const connectorOrigin: EventOrigin = { type: 'connector', serviceAccountId, tenantId: tenantAId };

      expect(await services.withOrigin(connectorOrigin).tenants.isTenantUser(tenantAId, admin.userId)).toBe(true);
      expect(await services.withOrigin(connectorOrigin).tenants.isTenantUser(tenantBId, memberOfB.userId)).toBe(false);
    });
  });

  describe('auth origin bypasses client policies', () => {
    it('should allow auth origin to read all users without tenant filtering', async () => {
      await createAdminUser(services);

      // Auth origin should see the admin user (no tenant filter applied)
      const authOrigin: EventOrigin = { type: 'auth' };
      const users = await services.withOrigin(authOrigin).users.getUsers();
      expect(users.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('manageSecurityPolicy', () => {
    it('should block group reads for users without MANAGE_SECURITY', async () => {
      const { origin: adminOrigin } = await createTenantWithAdmin(services);
      const regularUser = await createTenantUser(services, db, adminOrigin);

      const groupsSeen = await services.withOrigin(regularUser.origin).groups.getGroups();
      expect(groupsSeen).toHaveLength(0);
    });

    it('should block role reads for users without MANAGE_SECURITY', async () => {
      const { origin: adminOrigin } = await createTenantWithAdmin(services);
      const regularUser = await createTenantUser(services, db, adminOrigin);

      const rolesSeen = await services.withOrigin(regularUser.origin).roles.getRoles();
      expect(rolesSeen).toHaveLength(0);
    });

    it('should allow reads after granting MANAGE_SECURITY via RBAC chain', async () => {
      const { origin: adminOrigin } = await createTenantWithAdmin(services);
      const regularUser = await createTenantUser(services, db, adminOrigin);

      // Initially no groups visible
      let groupsSeen = await services.withOrigin(regularUser.origin).groups.getGroups();
      expect(groupsSeen).toHaveLength(0);

      // Grant MANAGE_SECURITY: create role, add capability, create group, assign role, add user
      const roleId = uuidv7();
      await services.withOrigin(adminOrigin).roles.createRole({ id: roleId, name: 'Security' });
      await services.withOrigin(adminOrigin).roles.addCapabilityToRole(roleId, Capability_ManageSecurity);

      const groupId = uuidv7();
      await services.withOrigin(adminOrigin).groups.createGroup({ id: groupId, name: 'Security Group' });
      await services.withOrigin(adminOrigin).groups.addRoleToGroup(groupId, roleId);
      await services.withOrigin(adminOrigin).groups.addUserToGroup(groupId, regularUser.userId);

      // Now groups should be visible
      groupsSeen = await services.withOrigin(regularUser.origin).groups.getGroups();
      expect(groupsSeen.length).toBeGreaterThan(0);
    });

    it('should refuse a MANAGE_SECURITY-gated write in the tenant the capability was not granted in', async () => {
      const admin = await createAdminUser(services);
      const tenantAId = await createTenant(services, admin.userId);
      const tenantBId = await createTenant(services, admin.userId);

      const adminOriginInA: EventOrigin = { type: 'client', userId: admin.userId, tenantId: tenantAId };
      const adminOriginInB: EventOrigin = { type: 'client', userId: admin.userId, tenantId: tenantBId };

      const user = await createTenantUser(services, db, adminOriginInA);
      const userOriginInA = user.origin;
      const userOriginInB: EventOrigin = { type: 'client', userId: user.userId, tenantId: tenantBId };

      // The user is an ordinary member of A and an administrator of B.
      await services.withOrigin(adminOriginInB).tenants.addTenantUser(tenantBId, user.userId);
      await grantCapability(services, adminOriginInB, user.userId, Capability_ManageSecurity);

      await expect(
        services.withOrigin(userOriginInA).groups.createGroup({ id: uuidv7(), name: 'Group in A' }),
      ).rejects.toThrow();
      const groupsSeenInA = await services.withOrigin(userOriginInA).groups.getGroups();
      expect(groupsSeenInA).toHaveLength(0);

      await services.withOrigin(userOriginInB).groups.createGroup({ id: uuidv7(), name: 'Group in B' });
      const groupsSeenInB = await services.withOrigin(userOriginInB).groups.getGroups();
      expect(groupsSeenInB.length).toBeGreaterThan(0);
    });
  });
});
