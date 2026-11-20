import type { EventOrigin } from '@app/module';
import {
  LastPlatformAdminError,
  PlatformCapability_CreateTenants,
  PlatformCapability_ManageUsers,
  PlatformCapability_PlatformAccess,
  platformGroupRoles,
  platformGroups,
  platformGroupUsers,
  platformRoleCapabilities,
  platformRoles,
} from '@app/module';
import { sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createAdminUser, createTenant, createTenantUser, createUser } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('Platform Admin', () => {
  let adminUserId: string;
  let adminOrigin: EventOrigin;

  beforeEach(async () => {
    await truncateAllTables(db);
    const admin = await createAdminUser(services);
    adminUserId = admin.userId;
    adminOrigin = { type: 'platform', userId: adminUserId };
  });

  describe('platform capabilities', () => {
    it('should list seeded platform capabilities', async () => {
      const caps = await services.withOrigin(adminOrigin)
        .platformCapabilities.getPlatformCapabilities();
      expect(caps.length).toBeGreaterThanOrEqual(3);

      const capIds = caps.map((c) => c.id);
      expect(capIds).toContain(PlatformCapability_CreateTenants);
      expect(capIds).toContain(PlatformCapability_ManageUsers);
      expect(capIds).toContain(PlatformCapability_PlatformAccess);
    });

    it('should report admin has all platform capabilities', async () => {
      const caps = await services.withOrigin(adminOrigin)
        .platformCapabilities.getUserPlatformCapabilities(adminUserId);
      const capIds = caps.map((c) => c.capability.id);
      expect(capIds).toContain(PlatformCapability_CreateTenants);
      expect(capIds).toContain(PlatformCapability_ManageUsers);
      expect(capIds).toContain(PlatformCapability_PlatformAccess);
    });

    it('should confirm admin has platform access', async () => {
      const has = await services.withOrigin(adminOrigin)
        .platformCapabilities.hasPlatformAccess();
      expect(has).toBe(true);
    });

    it('should deny platform access for regular user', async () => {
      const user = await createUser(db);
      const userOrigin: EventOrigin = { type: 'platform', userId: user.userId };
      const has = await services.withOrigin(userOrigin)
        .platformCapabilities.hasPlatformAccess();
      expect(has).toBe(false);
    });

    it('should check specific platform capability', async () => {
      const has = await services.withOrigin(adminOrigin)
        .platformCapabilities.hasPlatformCapability(PlatformCapability_CreateTenants);
      expect(has).toBe(true);
    });
  });

  describe('users on the platform surface', () => {
    it('should return every user to a platform admin holding MANAGE_USERS', async () => {
      const other = await createUser(db);

      const users = await services.withOrigin(adminOrigin).users.getUsers();

      expect(users.map((user) => user.id)).toEqual(expect.arrayContaining([adminUserId, other.userId]));
    });

    it('should return only their own row to a platform user without MANAGE_USERS', async () => {
      const user = await createUser(db);
      await createUser(db);
      const userOrigin: EventOrigin = { type: 'platform', userId: user.userId };

      const users = await services.withOrigin(userOrigin).users.getUsers();

      expect(users.map((u) => u.id)).toEqual([user.userId]);
    });
  });

  describe('platform groups', () => {
    it('should create a platform group', async () => {
      const groupId = uuidv7();
      await services.withOrigin(adminOrigin).platformGroups.createPlatformGroup({
        id: groupId, name: 'Operators',
      });

      const group = await services.withOrigin(adminOrigin)
        .platformGroups.getPlatformGroup(groupId);
      expect(group).toBeTruthy();
      expect(group!.name).toBe('Operators');
    });

    it('should list platform groups', async () => {
      // There should be at least one (Admin) from createAdminUser
      const groups = await services.withOrigin(adminOrigin)
        .platformGroups.getPlatformGroups();
      expect(groups.length).toBeGreaterThanOrEqual(1);
    });

    it('should add and remove users from platform groups', async () => {
      const groupId = uuidv7();
      await services.withOrigin(adminOrigin).platformGroups.createPlatformGroup({
        id: groupId, name: 'User Group',
      });

      const user = await createUser(db);
      await services.withOrigin(adminOrigin)
        .platformGroups.addUserToPlatformGroup(groupId, user.userId);

      let users = await services.withOrigin(adminOrigin)
        .platformGroups.getPlatformGroupUsers(groupId);
      expect(users.map((u) => u.user.id)).toContain(user.userId);

      await services.withOrigin(adminOrigin)
        .platformGroups.removeUserFromPlatformGroup(groupId, user.userId);

      users = await services.withOrigin(adminOrigin)
        .platformGroups.getPlatformGroupUsers(groupId);
      expect(users.map((u) => u.user.id)).not.toContain(user.userId);
    });

    it('should add and remove roles from platform groups', async () => {
      const groupId = uuidv7();
      await services.withOrigin(adminOrigin).platformGroups.createPlatformGroup({
        id: groupId, name: 'Role Group',
      });

      const roleId = uuidv7();
      await services.withOrigin(adminOrigin).platformRoles.createPlatformRole({
        id: roleId, name: 'Custom Platform Role',
      });

      await services.withOrigin(adminOrigin)
        .platformGroups.addRoleToPlatformGroup(groupId, roleId);

      let roles = await services.withOrigin(adminOrigin)
        .platformGroups.getPlatformGroupRoles(groupId);
      expect(roles.map((r) => r.role.id)).toContain(roleId);

      await services.withOrigin(adminOrigin)
        .platformGroups.removeRoleFromPlatformGroup(groupId, roleId);

      roles = await services.withOrigin(adminOrigin)
        .platformGroups.getPlatformGroupRoles(groupId);
      expect(roles.map((r) => r.role.id)).not.toContain(roleId);
    });

    it('should get user platform groups', async () => {
      const groups = await services.withOrigin(adminOrigin)
        .platformGroups.getUserPlatformGroups(adminUserId);
      expect(groups.length).toBeGreaterThanOrEqual(1);
    });

    it('should never return the members\' password hash', async () => {
      const [adminGroup] = await services.withOrigin(adminOrigin).platformGroups.getUserPlatformGroups(adminUserId);

      const users = await services.withOrigin(adminOrigin).platformGroups.getPlatformGroupUsers(adminGroup.group.id);

      expect(users.length).toBeGreaterThan(0);
      users.forEach((groupUser) => expect(groupUser.user).not.toHaveProperty('passwordHash'));
    });
  });

  describe('list pages', () => {
    it('should carry each platform group\'s member count and its roles sorted by name', async () => {
      const scoped = services.withOrigin(adminOrigin);
      const groupId = uuidv7();
      await scoped.platformGroups.createPlatformGroup({ id: groupId, name: 'Operators' });
      const user = await createUser(db);
      await scoped.platformGroups.addUserToPlatformGroup(groupId, user.userId);
      const operatorId = uuidv7();
      const auditorId = uuidv7();
      await scoped.platformRoles.createPlatformRole({ id: operatorId, name: 'Operator' });
      await scoped.platformRoles.createPlatformRole({ id: auditorId, name: 'Auditor' });
      await scoped.platformGroups.addRoleToPlatformGroup(groupId, operatorId);
      await scoped.platformGroups.addRoleToPlatformGroup(groupId, auditorId);

      const rows = await scoped.platformGroups.listPlatformGroups();

      expect(rows.find((row) => row.id === groupId)).toEqual({
        id: groupId,
        name: 'Operators',
        memberCount: 1,
        roles: [{ id: auditorId, name: 'Auditor' }, { id: operatorId, name: 'Operator' }],
      });
    });

    it('should count each platform role\'s capabilities', async () => {
      const scoped = services.withOrigin(adminOrigin);
      const roleId = uuidv7();
      const emptyId = uuidv7();
      await scoped.platformRoles.createPlatformRole({ id: roleId, name: 'Tenant Manager' });
      await scoped.platformRoles.createPlatformRole({ id: emptyId, name: 'Empty' });
      await scoped.platformRoles.addCapabilityToPlatformRole(roleId, PlatformCapability_CreateTenants);
      await scoped.platformRoles.addCapabilityToPlatformRole(roleId, PlatformCapability_PlatformAccess);

      const rows = await scoped.platformRoles.listPlatformRoles();

      expect(rows.find((row) => row.id === roleId)).toEqual({ id: roleId, name: 'Tenant Manager', capabilityCount: 2 });
      expect(rows.find((row) => row.id === emptyId)).toEqual({ id: emptyId, name: 'Empty', capabilityCount: 0 });
    });

    it('should carry each user\'s platform groups and the roles they grant, a role two groups share listed once', async () => {
      const scoped = services.withOrigin(adminOrigin);
      const user = await createUser(db);
      const loner = await createUser(db);
      const nightId = uuidv7();
      const dayId = uuidv7();
      await scoped.platformGroups.createPlatformGroup({ id: nightId, name: 'Night shift' });
      await scoped.platformGroups.createPlatformGroup({ id: dayId, name: 'Day shift' });
      const operatorId = uuidv7();
      await scoped.platformRoles.createPlatformRole({ id: operatorId, name: 'Operator' });
      await scoped.platformGroups.addRoleToPlatformGroup(nightId, operatorId);
      await scoped.platformGroups.addRoleToPlatformGroup(dayId, operatorId);
      await scoped.platformGroups.addUserToPlatformGroup(nightId, user.userId);
      await scoped.platformGroups.addUserToPlatformGroup(dayId, user.userId);

      const rows = await scoped.users.listPlatformUsers();

      expect(rows.find((row) => row.id === user.userId)).toEqual({
        id: user.userId,
        email: user.email,
        name: null,
        title: null,
        isSuperAdmin: false,
        platformGroups: [{ id: dayId, name: 'Day shift' }, { id: nightId, name: 'Night shift' }],
        platformRoles: [{ id: operatorId, name: 'Operator' }],
        tenants: [],
      });
      expect(rows.find((row) => row.id === loner.userId)).toMatchObject({ platformGroups: [], platformRoles: [] });
    });
  });

  describe('platform roles', () => {
    it('should create a platform role', async () => {
      const roleId = uuidv7();
      await services.withOrigin(adminOrigin).platformRoles.createPlatformRole({
        id: roleId, name: 'Auditor',
      });

      const role = await services.withOrigin(adminOrigin)
        .platformRoles.getPlatformRole(roleId);
      expect(role).toBeTruthy();
      expect(role!.name).toBe('Auditor');
    });

    it('should add and remove capabilities from platform roles', async () => {
      const roleId = uuidv7();
      await services.withOrigin(adminOrigin).platformRoles.createPlatformRole({
        id: roleId, name: 'Test Role',
      });

      await services.withOrigin(adminOrigin)
        .platformRoles.addCapabilityToPlatformRole(roleId, PlatformCapability_CreateTenants);

      let caps = await services.withOrigin(adminOrigin)
        .platformRoles.getPlatformRoleCapabilities(roleId);
      expect(caps.map((c) => c.capability.id)).toContain(PlatformCapability_CreateTenants);

      await services.withOrigin(adminOrigin)
        .platformRoles.removeCapabilityFromPlatformRole(roleId, PlatformCapability_CreateTenants);

      caps = await services.withOrigin(adminOrigin)
        .platformRoles.getPlatformRoleCapabilities(roleId);
      expect(caps.map((c) => c.capability.id)).not.toContain(PlatformCapability_CreateTenants);
    });

    it('should grant platform capabilities via group → role → capability chain', async () => {
      const user = await createUser(db);

      // Create a platform role with CREATE_TENANTS capability
      const roleId = uuidv7();
      await services.withOrigin(adminOrigin).platformRoles.createPlatformRole({
        id: roleId, name: 'Tenant Manager',
      });
      await services.withOrigin(adminOrigin)
        .platformRoles.addCapabilityToPlatformRole(roleId, PlatformCapability_CreateTenants);

      // Create a platform group with this role
      const groupId = uuidv7();
      await services.withOrigin(adminOrigin).platformGroups.createPlatformGroup({
        id: groupId, name: 'Tenant Managers',
      });
      await services.withOrigin(adminOrigin)
        .platformGroups.addRoleToPlatformGroup(groupId, roleId);

      // Add user to the group
      await services.withOrigin(adminOrigin)
        .platformGroups.addUserToPlatformGroup(groupId, user.userId);

      // Now user should have CREATE_TENANTS capability
      const userOrigin: EventOrigin = { type: 'platform', userId: user.userId };
      const has = await services.withOrigin(userOrigin)
        .platformCapabilities.hasPlatformCapability(PlatformCapability_CreateTenants);
      expect(has).toBe(true);

      // But should NOT have PLATFORM_ACCESS capability
      const hasAccess = await services.withOrigin(userOrigin)
        .platformCapabilities.hasPlatformAccess();
      expect(hasAccess).toBe(false);
    });
  });

  describe('security policy: only MANAGE_USERS may write the platform group/role tables', () => {
    it('should refuse createPlatformRole for a platform origin holding no platform capability', async () => {
      const attacker = await createUser(db);
      const attackerOrigin: EventOrigin = { type: 'platform', userId: attacker.userId };

      await expect(services.withOrigin(attackerOrigin).platformRoles.createPlatformRole({
        id: uuidv7(), name: 'Self-Granted Admin',
      })).rejects.toThrow();

      const hasAccess = await services.withOrigin(attackerOrigin).platformCapabilities.hasPlatformAccess();
      expect(hasAccess).toBe(false);
    });

    it('should refuse the same escalation for a client origin (a tenant member sending the tenant header)', async () => {
      const tenantId = await createTenant(services, adminUserId);
      const tenantMember = await createTenantUser(services, db, { type: 'client', userId: adminUserId, tenantId });

      await expect(services.withOrigin(tenantMember.origin).platformRoles.createPlatformRole({
        id: uuidv7(), name: 'Self-Granted Admin',
      })).rejects.toThrow();
    });

    it('should refuse the same escalation for a connector origin (a service account buys nothing here)', async () => {
      const connectorOrigin: EventOrigin = { type: 'connector', serviceAccountId: uuidv7(), tenantId: uuidv7() };

      await expect(services.withOrigin(connectorOrigin).platformRoles.createPlatformRole({
        id: uuidv7(), name: 'Self-Granted Admin',
      })).rejects.toThrow();
    });

    it('should silently no-op updatePlatformRole for an uncapable origin, leaving the row unchanged', async () => {
      const roleId = uuidv7();
      await services.withOrigin(adminOrigin).platformRoles.createPlatformRole({ id: roleId, name: 'Original Name' });

      const attacker = await createUser(db);
      const attackerOrigin: EventOrigin = { type: 'platform', userId: attacker.userId };

      await services.withOrigin(attackerOrigin).platformRoles.updatePlatformRole(roleId, { name: 'Renamed By Attacker' });

      const role = await services.withOrigin(adminOrigin).platformRoles.getPlatformRole(roleId);
      expect(role!.name).toBe('Original Name');
    });

    it('should silently no-op deletePlatformRole for an uncapable origin, leaving the row in place', async () => {
      const roleId = uuidv7();
      await services.withOrigin(adminOrigin).platformRoles.createPlatformRole({ id: roleId, name: 'Survivor' });

      const attacker = await createUser(db);
      const attackerOrigin: EventOrigin = { type: 'platform', userId: attacker.userId };

      await services.withOrigin(attackerOrigin).platformRoles.deletePlatformRole(roleId);

      const role = await services.withOrigin(adminOrigin).platformRoles.getPlatformRole(roleId);
      expect(role).toBeTruthy();
    });

    it('should refuse addUserToPlatformGroup for an uncapable origin, the last step of the escalation', async () => {
      const roleId = uuidv7();
      await services.withOrigin(adminOrigin).platformRoles.createPlatformRole({ id: roleId, name: 'Privileged Role' });
      await services.withOrigin(adminOrigin)
        .platformRoles.addCapabilityToPlatformRole(roleId, PlatformCapability_ManageUsers);

      const groupId = uuidv7();
      await services.withOrigin(adminOrigin).platformGroups.createPlatformGroup({ id: groupId, name: 'Privileged Group' });
      await services.withOrigin(adminOrigin).platformGroups.addRoleToPlatformGroup(groupId, roleId);

      const attacker = await createUser(db);
      const attackerOrigin: EventOrigin = { type: 'platform', userId: attacker.userId };

      await expect(services.withOrigin(attackerOrigin)
        .platformGroups.addUserToPlatformGroup(groupId, attacker.userId)).rejects.toThrow();
    });

    it('should still answer reads for an uncapable origin, proving the read trap was avoided', async () => {
      const attacker = await createUser(db);
      const attackerOrigin: EventOrigin = { type: 'platform', userId: attacker.userId };

      const roles = await services.withOrigin(attackerOrigin).platformRoles.getPlatformRoles();
      const groups = await services.withOrigin(attackerOrigin).platformGroups.getPlatformGroups();

      expect(roles.length).toBeGreaterThanOrEqual(1);
      expect(groups.length).toBeGreaterThanOrEqual(1);

      const hasCapability = await services.withOrigin(adminOrigin)
        .platformCapabilities.hasPlatformCapability(PlatformCapability_ManageUsers);
      expect(hasCapability).toBe(true);
    });
  });

  describe('platform reachability invariant', () => {
    let adminGroupId: string;
    let adminRoleId: string;

    /** A second holder of MANAGE_USERS, through its own group and role. */
    const createBackupAdmin = async () => {
      const user = await createUser(db);
      const roleId = uuidv7();
      const groupId = uuidv7();
      await services.withOrigin(adminOrigin).platformRoles.createPlatformRole({ id: roleId, name: `Backup Admin ${roleId.substring(0, 8)}` });
      await services.withOrigin(adminOrigin).platformRoles.addCapabilityToPlatformRole(roleId, PlatformCapability_ManageUsers);
      await services.withOrigin(adminOrigin).platformGroups.createPlatformGroup({ id: groupId, name: `Backup Admins ${groupId.substring(0, 8)}` });
      await services.withOrigin(adminOrigin).platformGroups.addRoleToPlatformGroup(groupId, roleId);
      await services.withOrigin(adminOrigin).platformGroups.addUserToPlatformGroup(groupId, user.userId);
      return { userId: user.userId, roleId, groupId };
    };

    beforeEach(async () => {
      const groups = await services.withOrigin(adminOrigin).platformGroups.getUserPlatformGroups(adminUserId);
      adminGroupId = groups[0].group.id;
      const roles = await services.withOrigin(adminOrigin).platformGroups.getPlatformGroupRoles(adminGroupId);
      adminRoleId = roles[0].role.id;
    });

    it('should refuse removeCapabilityFromPlatformRole on the last MANAGE_USERS holder, leaving the capability in place', async () => {
      await expect(services.withOrigin(adminOrigin)
        .platformRoles.removeCapabilityFromPlatformRole(adminRoleId, PlatformCapability_ManageUsers))
        .rejects.toThrow(LastPlatformAdminError);

      const caps = await services.withOrigin(adminOrigin).platformRoles.getPlatformRoleCapabilities(adminRoleId);
      expect(caps.map((c) => c.capability.id)).toContain(PlatformCapability_ManageUsers);
    });

    it('should refuse removing the last PLATFORM_ACCESS holder, which the platform routes log every caller out without', async () => {
      await expect(services.withOrigin(adminOrigin)
        .platformRoles.removeCapabilityFromPlatformRole(adminRoleId, PlatformCapability_PlatformAccess))
        .rejects.toThrow(LastPlatformAdminError);

      const caps = await services.withOrigin(adminOrigin).platformRoles.getPlatformRoleCapabilities(adminRoleId);
      expect(caps.map((c) => c.capability.id)).toContain(PlatformCapability_PlatformAccess);
      expect(await services.withOrigin(adminOrigin).platformCapabilities.hasPlatformAccess()).toBe(true);
    });

    it('should refuse removeUserFromPlatformGroup on the last MANAGE_USERS holder, leaving the membership in place', async () => {
      await expect(services.withOrigin(adminOrigin)
        .platformGroups.removeUserFromPlatformGroup(adminGroupId, adminUserId))
        .rejects.toThrow(LastPlatformAdminError);

      const users = await services.withOrigin(adminOrigin).platformGroups.getPlatformGroupUsers(adminGroupId);
      expect(users.map((u) => u.user.id)).toContain(adminUserId);
    });

    it('should refuse removeUserFromPlatformGroup on the last PLATFORM_ACCESS holder, leaving the membership in place', async () => {
      await expect(services.withOrigin(adminOrigin)
        .platformGroups.removeUserFromPlatformGroup(adminGroupId, adminUserId))
        .rejects.toThrow(LastPlatformAdminError);

      expect(await services.withOrigin(adminOrigin).platformCapabilities.hasPlatformAccess()).toBe(true);
    });

    it('should refuse removeRoleFromPlatformGroup on the last MANAGE_USERS holder, leaving the role attached', async () => {
      await expect(services.withOrigin(adminOrigin)
        .platformGroups.removeRoleFromPlatformGroup(adminGroupId, adminRoleId))
        .rejects.toThrow(LastPlatformAdminError);

      const roles = await services.withOrigin(adminOrigin).platformGroups.getPlatformGroupRoles(adminGroupId);
      expect(roles.map((r) => r.role.id)).toContain(adminRoleId);
    });

    it('should refuse removeRoleFromPlatformGroup on the last PLATFORM_ACCESS holder, leaving the role attached', async () => {
      await expect(services.withOrigin(adminOrigin)
        .platformGroups.removeRoleFromPlatformGroup(adminGroupId, adminRoleId))
        .rejects.toThrow(LastPlatformAdminError);

      expect(await services.withOrigin(adminOrigin).platformCapabilities.hasPlatformAccess()).toBe(true);
    });

    it('should refuse deletePlatformGroup on the last MANAGE_USERS holder, leaving the group and its junction rows in place', async () => {
      await expect(services.withOrigin(adminOrigin)
        .platformGroups.deletePlatformGroup(adminGroupId))
        .rejects.toThrow(LastPlatformAdminError);

      const group = await services.withOrigin(adminOrigin).platformGroups.getPlatformGroup(adminGroupId);
      expect(group).toBeTruthy();
      const roles = await services.withOrigin(adminOrigin).platformGroups.getPlatformGroupRoles(adminGroupId);
      expect(roles.map((r) => r.role.id)).toContain(adminRoleId);
      const users = await services.withOrigin(adminOrigin).platformGroups.getPlatformGroupUsers(adminGroupId);
      expect(users.map((u) => u.user.id)).toContain(adminUserId);
    });

    it('should refuse deletePlatformGroup on the last PLATFORM_ACCESS holder, leaving the group in place', async () => {
      await expect(services.withOrigin(adminOrigin)
        .platformGroups.deletePlatformGroup(adminGroupId))
        .rejects.toThrow(LastPlatformAdminError);

      expect(await services.withOrigin(adminOrigin).platformCapabilities.hasPlatformAccess()).toBe(true);
    });

    it('should refuse deletePlatformRole on the last MANAGE_USERS holder, leaving the role and its capabilities in place', async () => {
      await expect(services.withOrigin(adminOrigin)
        .platformRoles.deletePlatformRole(adminRoleId))
        .rejects.toThrow(LastPlatformAdminError);

      const role = await services.withOrigin(adminOrigin).platformRoles.getPlatformRole(adminRoleId);
      expect(role).toBeTruthy();
      const caps = await services.withOrigin(adminOrigin).platformRoles.getPlatformRoleCapabilities(adminRoleId);
      expect(caps.map((c) => c.capability.id)).toContain(PlatformCapability_ManageUsers);
    });

    it('should refuse deletePlatformRole on the last PLATFORM_ACCESS holder, leaving the role in place', async () => {
      await expect(services.withOrigin(adminOrigin)
        .platformRoles.deletePlatformRole(adminRoleId))
        .rejects.toThrow(LastPlatformAdminError);

      expect(await services.withOrigin(adminOrigin).platformCapabilities.hasPlatformAccess()).toBe(true);
    });

    it('should refuse deleting the last user holding the platform capabilities, leaving the account in place', async () => {
      await expect(services.withOrigin(adminOrigin).users.deleteUser(adminUserId))
        .rejects.toThrow(LastPlatformAdminError);

      expect(await services.withOrigin(adminOrigin).users.getUser(adminUserId)).toBeTruthy();
    });

    it('should still allow removing a capability that gates nothing on the platform surface', async () => {
      const caps = await services.withOrigin(adminOrigin).platformRoles.getPlatformRoleCapabilities(adminRoleId);
      expect(caps.map((c) => c.capability.id)).toContain(PlatformCapability_CreateTenants);

      await services.withOrigin(adminOrigin)
        .platformRoles.removeCapabilityFromPlatformRole(adminRoleId, PlatformCapability_CreateTenants);

      const remaining = await services.withOrigin(adminOrigin).platformRoles.getPlatformRoleCapabilities(adminRoleId);
      expect(remaining.map((c) => c.capability.id)).not.toContain(PlatformCapability_CreateTenants);
    });

    it('should allow removing MANAGE_USERS from the admin role once a second holder exists', async () => {
      const backup = await createBackupAdmin();

      await services.withOrigin(adminOrigin)
        .platformRoles.removeCapabilityFromPlatformRole(adminRoleId, PlatformCapability_ManageUsers);

      const backupOrigin: EventOrigin = { type: 'platform', userId: backup.userId };
      expect(await services.withOrigin(adminOrigin)
        .platformCapabilities.hasPlatformCapability(PlatformCapability_ManageUsers)).toBe(false);
      expect(await services.withOrigin(backupOrigin)
        .platformCapabilities.hasPlatformCapability(PlatformCapability_ManageUsers)).toBe(true);
    });

    it('should let only one of two concurrent removals of distinct MANAGE_USERS holders through', async () => {
      const backup = await createBackupAdmin();
      const backupOrigin: EventOrigin = { type: 'platform', userId: backup.userId };

      // Each actor removes their own standing: the write's policy predicate reads the caller's
      // *current* capability, so having one actor strip the other's role would make the second
      // call's own predicate fail once the first commits, refusing it as a silent no-op the guard
      // cannot tell apart from an idempotent retry — a separate race from the one under test here.
      const outcomes = await Promise.allSettled([
        services.withOrigin(adminOrigin)
          .platformRoles.removeCapabilityFromPlatformRole(adminRoleId, PlatformCapability_ManageUsers),
        services.withOrigin(backupOrigin)
          .platformRoles.removeCapabilityFromPlatformRole(backup.roleId, PlatformCapability_ManageUsers),
      ]);

      const rejected = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(LastPlatformAdminError);

      const holders = await Promise.all([
        services.withOrigin(adminOrigin).platformCapabilities.hasPlatformCapability(PlatformCapability_ManageUsers),
        services.withOrigin(backupOrigin).platformCapabilities.hasPlatformCapability(PlatformCapability_ManageUsers),
      ]);
      expect(holders.filter(Boolean)).toHaveLength(1);
    });

    describe('on a platform where a capability has no group holder', () => {
      /** A role holding `capabilityIds`, attached to a group that has `memberIds` as its members. */
      const createGroupWithRole = async (capabilityIds: Array<string>, memberIds: Array<string> = []) => {
        const roleId = uuidv7();
        const groupId = uuidv7();
        await db.insert(platformRoles).values({ id: roleId, name: `Role ${roleId.substring(0, 8)}` });
        await db.insert(platformRoleCapabilities).values(capabilityIds.map((capabilityId) => ({ platformRoleId: roleId, capabilityId })));
        await db.insert(platformGroups).values({ id: groupId, name: `Group ${groupId.substring(0, 8)}` });
        await db.insert(platformGroupRoles).values({ platformGroupId: groupId, platformRoleId: roleId });
        if (memberIds.length > 0) {
          await db.insert(platformGroupUsers).values(memberIds.map((userId) => ({ platformGroupId: groupId, userId })));
        }
        return { roleId, groupId };
      };

      beforeEach(async () => {
        await db.delete(platformGroupUsers);
      });

      const createSuperAdminOrigin = async (): Promise<EventOrigin> => {
        const { userId } = await createUser(db);
        await db.execute(sql`UPDATE users SET is_super_admin = true WHERE id = ${userId}`);
        return { type: 'platform', userId };
      };

      it('should let a super administrator delete a group no one is a member of', async () => {
        const scoped = services.withOrigin(await createSuperAdminOrigin());
        const { groupId } = await createGroupWithRole([PlatformCapability_ManageUsers, PlatformCapability_PlatformAccess]);

        await scoped.platformGroups.deletePlatformGroup(groupId);

        expect(await scoped.platformGroups.getPlatformGroup(groupId)).toBeUndefined();
      });

      it('should let a super administrator delete a role no one holds', async () => {
        const scoped = services.withOrigin(await createSuperAdminOrigin());
        const { roleId } = await createGroupWithRole([PlatformCapability_ManageUsers, PlatformCapability_PlatformAccess]);

        await scoped.platformRoles.deletePlatformRole(roleId);

        expect(await scoped.platformRoles.getPlatformRole(roleId)).toBeUndefined();
      });

      it('should let a super administrator detach a role from a group no one is a member of', async () => {
        const scoped = services.withOrigin(await createSuperAdminOrigin());
        const { groupId, roleId } = await createGroupWithRole([PlatformCapability_ManageUsers, PlatformCapability_PlatformAccess]);

        await scoped.platformGroups.removeRoleFromPlatformGroup(groupId, roleId);

        expect(await scoped.platformGroups.getPlatformGroupRoles(groupId)).toHaveLength(0);
      });

      it('should let a super administrator remove a capability from a role no one holds', async () => {
        const scoped = services.withOrigin(await createSuperAdminOrigin());
        const { roleId } = await createGroupWithRole([PlatformCapability_ManageUsers, PlatformCapability_PlatformAccess]);

        await scoped.platformRoles.removeCapabilityFromPlatformRole(roleId, PlatformCapability_ManageUsers);

        const capabilities = await scoped.platformRoles.getPlatformRoleCapabilities(roleId);
        expect(capabilities.map((c) => c.capability.id)).toEqual([PlatformCapability_PlatformAccess]);
      });

      it('should name only the capability that loses its last holder when the other has none to begin with', async () => {
        const holder = await createUser(db);
        const { groupId } = await createGroupWithRole([PlatformCapability_ManageUsers], [holder.userId]);
        const holderOrigin: EventOrigin = { type: 'platform', userId: holder.userId };

        const refusal = services.withOrigin(holderOrigin).platformGroups.removeUserFromPlatformGroup(groupId, holder.userId);

        await expect(refusal).rejects.toThrow(LastPlatformAdminError);
        await expect(refusal).rejects.toMatchObject({ data: { capabilityIds: [PlatformCapability_ManageUsers] } });
        const users = await services.withOrigin(holderOrigin).platformGroups.getPlatformGroupUsers(groupId);
        expect(users.map((u) => u.user.id)).toEqual([holder.userId]);
      });
    });
  });
});
