import type { EventOrigin } from '@app/module';
import { groupRoles, groupUsers } from '@app/module';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantUser, createTenantWithAdmin, createUser } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('Groups Service', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    tenantId = setup.tenantId;
  });

  describe('CRUD', () => {
    it('should create a group', async () => {
      const groupId = uuidv7();
      await services.withOrigin(adminOrigin).groups.createGroup({
        id: groupId, name: 'Developers',
      });

      const group = await services.withOrigin(adminOrigin).groups.getGroup(groupId);
      expect(group).toBeTruthy();
      expect(group!.name).toBe('Developers');
    });

    it('should list groups in the tenant', async () => {
      await services.withOrigin(adminOrigin).groups.createGroup({
        id: uuidv7(), name: 'Group A',
      });

      // The tenant already has an 'Admin' group created by createTenantWithAdmin
      const allGroups = await services.withOrigin(adminOrigin).groups.getGroups();
      expect(allGroups.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('user management', () => {
    it('should add and remove a user from a group', async () => {
      const groupId = uuidv7();
      await services.withOrigin(adminOrigin).groups.createGroup({
        id: groupId, name: 'Test Group',
      });

      const user = await createTenantUser(services, db, adminOrigin);

      await services.withOrigin(adminOrigin).groups.addUserToGroup(groupId, user.userId);

      let users = await services.withOrigin(adminOrigin).groups.getGroupUsers(groupId);
      expect(users.map((u) => u.user.id)).toContain(user.userId);

      await services.withOrigin(adminOrigin).groups.removeUserFromGroup(groupId, user.userId);

      users = await services.withOrigin(adminOrigin).groups.getGroupUsers(groupId);
      expect(users.map((u) => u.user.id)).not.toContain(user.userId);
    });

    it('should refuse to add a user who is not a member of the tenant', async () => {
      const groupId = uuidv7();
      await services.withOrigin(adminOrigin).groups.createGroup({ id: groupId, name: 'Members only' });
      const stranger = await createUser(db);

      await expect(
        services.withOrigin(adminOrigin).groups.addUserToGroup(groupId, stranger.userId),
      ).rejects.toThrow('Access Denied');

      expect(await db.select().from(groupUsers).where(eq(groupUsers.userId, stranger.userId))).toHaveLength(0);
    });

    it('should refuse to add a former member of the tenant', async () => {
      const groupId = uuidv7();
      await services.withOrigin(adminOrigin).groups.createGroup({ id: groupId, name: 'Members only' });
      const member = await createTenantUser(services, db, adminOrigin);
      await services.withOrigin(adminOrigin).groups.addUserToGroup(groupId, member.userId);
      await services.withOrigin(adminOrigin).tenants.removeTenantUser(tenantId, member.userId);

      await expect(
        services.withOrigin(adminOrigin).groups.addUserToGroup(groupId, member.userId),
      ).rejects.toThrow('Access Denied');

      expect(await db.select().from(groupUsers).where(eq(groupUsers.userId, member.userId))).toHaveLength(0);
    });

    it('should refuse to add a member of another tenant only', async () => {
      const groupId = uuidv7();
      await services.withOrigin(adminOrigin).groups.createGroup({ id: groupId, name: 'Members only' });
      const otherTenantId = await createTenant(services, adminUserId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };
      const outsider = await createTenantUser(services, db, otherOrigin);

      await expect(
        services.withOrigin(adminOrigin).groups.addUserToGroup(groupId, outsider.userId),
      ).rejects.toThrow('Access Denied');

      expect(await db.select().from(groupUsers).where(eq(groupUsers.userId, outsider.userId))).toHaveLength(0);
    });

    it('should list groups for a user', async () => {
      const groupId = uuidv7();
      await services.withOrigin(adminOrigin).groups.createGroup({
        id: groupId, name: 'User Group',
      });
      await services.withOrigin(adminOrigin).groups.addUserToGroup(groupId, adminUserId);

      const userGroups = await services.withOrigin(adminOrigin).groups.getUserGroups(adminUserId);
      const groupIds = userGroups.map((g) => g.group.id);
      expect(groupIds).toContain(groupId);
    });
  });

  describe('role management', () => {
    it('should add and remove a role from a group', async () => {
      const groupId = uuidv7();
      await services.withOrigin(adminOrigin).groups.createGroup({
        id: groupId, name: 'Role Group',
      });

      const roleId = uuidv7();
      await services.withOrigin(adminOrigin).roles.createRole({
        id: roleId, name: 'Viewer',
      });

      await services.withOrigin(adminOrigin).groups.addRoleToGroup(groupId, roleId);

      let roles = await services.withOrigin(adminOrigin).groups.getGroupRoles(groupId);
      expect(roles.map((r) => r.role.id)).toContain(roleId);

      await services.withOrigin(adminOrigin).groups.removeRoleFromGroup(groupId, roleId);

      roles = await services.withOrigin(adminOrigin).groups.getGroupRoles(groupId);
      expect(roles.map((r) => r.role.id)).not.toContain(roleId);
    });

    it('should refuse to give a group a role of another tenant', async () => {
      const groupId = uuidv7();
      await services.withOrigin(adminOrigin).groups.createGroup({ id: groupId, name: 'Role Group' });
      const otherTenantId = await createTenant(services, adminUserId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };
      const foreignRoleId = uuidv7();
      await services.withOrigin(otherOrigin).roles.createRole({ id: foreignRoleId, name: 'Foreign' });

      await expect(
        services.withOrigin(adminOrigin).groups.addRoleToGroup(groupId, foreignRoleId),
      ).rejects.toThrow('Access Denied');

      expect(await db.select().from(groupRoles).where(eq(groupRoles.roleId, foreignRoleId))).toHaveLength(0);
    });
  });

  describe('list page', () => {
    it('should carry each group\'s member and service account counts and its roles sorted by name', async () => {
      const scoped = services.withOrigin(adminOrigin);
      const groupId = uuidv7();
      await scoped.groups.createGroup({ id: groupId, name: 'Analysts' });
      const member = await createTenantUser(services, db, adminOrigin);
      await scoped.groups.addUserToGroup(groupId, member.userId);
      await scoped.groups.addUserToGroup(groupId, adminUserId);
      const serviceAccountId = uuidv7();
      await scoped.serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'Feed Bot' });
      await scoped.serviceAccounts.addGroupToServiceAccount(serviceAccountId, groupId);
      const viewerId = uuidv7();
      const auditorId = uuidv7();
      await scoped.roles.createRole({ id: viewerId, name: 'Viewer' });
      await scoped.roles.createRole({ id: auditorId, name: 'Auditor' });
      await scoped.groups.addRoleToGroup(groupId, viewerId);
      await scoped.groups.addRoleToGroup(groupId, auditorId);

      const rows = await scoped.groups.listGroups();

      expect(rows.find((row) => row.id === groupId)).toEqual({
        id: groupId,
        name: 'Analysts',
        memberCount: 2,
        serviceAccountCount: 1,
        roles: [{ id: auditorId, name: 'Auditor' }, { id: viewerId, name: 'Viewer' }],
      });
    });

    it('should report zero counts and no roles for an empty group', async () => {
      const groupId = uuidv7();
      await services.withOrigin(adminOrigin).groups.createGroup({ id: groupId, name: 'Empty' });

      const rows = await services.withOrigin(adminOrigin).groups.listGroups();

      expect(rows.find((row) => row.id === groupId)).toEqual({
        id: groupId, name: 'Empty', memberCount: 0, serviceAccountCount: 0, roles: [],
      });
    });

    it('should list nothing to a user without MANAGE_SECURITY', async () => {
      const regularUser = await createTenantUser(services, db, adminOrigin);

      const rows = await services.withOrigin(regularUser.origin).groups.listGroups();

      expect(rows).toHaveLength(0);
    });
  });

  describe('security policy', () => {
    it('should not allow a user without MANAGE_SECURITY to see groups', async () => {
      // Create a user in the tenant but not in the admin group
      const regularUser = await createTenantUser(services, db, adminOrigin);

      // Regular user cannot see groups (manageSecurityPolicy blocks reads)
      const groupsSeen = await services.withOrigin(regularUser.origin).groups.getGroups();
      expect(groupsSeen).toHaveLength(0);
    });

    it('should not allow a user without MANAGE_SECURITY to create a group', async () => {
      const regularUser = await createTenantUser(services, db, adminOrigin);

      await expect(
        services.withOrigin(regularUser.origin).groups.createGroup({
          id: uuidv7(), name: 'Unauthorized Group',
        }),
      ).rejects.toThrow();
    });
  });
});
