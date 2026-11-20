import type { EventOrigin } from '@app/module';
import { Capability_ManageSecurity, PlatformCapability_PlatformAccess } from '@app/module';
import { sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantUser, createTenantWithAdmin, createUser } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

/** Helper to count rows in a junction table by column value */
const countRows = async (table: string, column: string, value: string) => {
  const result = await db.execute(sql`SELECT COUNT(*) FROM ${sql.identifier(table)} WHERE ${sql.identifier(column)} = ${value}`);
  return Number(result.rows[0].count);
};

describe('Cascade Deletes', () => {
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

  describe('group cascade', () => {
    it('should cascade delete group_users when group is deleted', async () => {
      const groupId = uuidv7();
      await services.withOrigin(adminOrigin).groups.createGroup({
        id: groupId, name: 'Cascade Group',
      });

      const user = await createTenantUser(services, db, adminOrigin);
      await services.withOrigin(adminOrigin).groups.addUserToGroup(groupId, user.userId);

      expect(await countRows('group_users', 'group_id', groupId)).toBe(1);

      await services.withOrigin(adminOrigin).groups.deleteGroup(groupId);

      expect(await countRows('group_users', 'group_id', groupId)).toBe(0);
    });

    it('should cascade delete group_roles when group is deleted', async () => {
      const groupId = uuidv7();
      await services.withOrigin(adminOrigin).groups.createGroup({
        id: groupId, name: 'Cascade Role Group',
      });

      const roleId = uuidv7();
      await services.withOrigin(adminOrigin).roles.createRole({
        id: roleId, name: 'Cascade Role',
      });
      await services.withOrigin(adminOrigin).groups.addRoleToGroup(groupId, roleId);

      expect(await countRows('group_roles', 'group_id', groupId)).toBe(1);

      await services.withOrigin(adminOrigin).groups.deleteGroup(groupId);

      expect(await countRows('group_roles', 'group_id', groupId)).toBe(0);
    });
  });

  describe('role cascade', () => {
    it('should cascade delete role_capabilities when role is deleted', async () => {
      const roleId = uuidv7();
      await services.withOrigin(adminOrigin).roles.createRole({
        id: roleId, name: 'Capability Role',
      });
      await services.withOrigin(adminOrigin).roles.addCapabilityToRole(roleId, Capability_ManageSecurity);

      expect(await countRows('role_capabilities', 'role_id', roleId)).toBe(1);

      await services.withOrigin(adminOrigin).roles.deleteRole(roleId);

      expect(await countRows('role_capabilities', 'role_id', roleId)).toBe(0);
    });

    it('should cascade delete group_roles when role is deleted', async () => {
      const groupId = uuidv7();
      await services.withOrigin(adminOrigin).groups.createGroup({
        id: groupId, name: 'Group For Role',
      });

      const roleId = uuidv7();
      await services.withOrigin(adminOrigin).roles.createRole({
        id: roleId, name: 'Deletable Role',
      });
      await services.withOrigin(adminOrigin).groups.addRoleToGroup(groupId, roleId);

      expect(await countRows('group_roles', 'role_id', roleId)).toBe(1);

      await services.withOrigin(adminOrigin).roles.deleteRole(roleId);

      expect(await countRows('group_roles', 'role_id', roleId)).toBe(0);
    });
  });

  describe('user cascade', () => {
    it('should cascade delete group_users when user is deleted', async () => {
      const groupId = uuidv7();
      await services.withOrigin(adminOrigin).groups.createGroup({
        id: groupId, name: 'User Group',
      });

      const user = await createTenantUser(services, db, adminOrigin);
      await services.withOrigin(adminOrigin).groups.addUserToGroup(groupId, user.userId);

      expect(await countRows('group_users', 'user_id', user.userId)).toBe(1);

      await services.withOrigin(adminOrigin).tenants.removeTenantUser(tenantId, user.userId);
      await services.withOrigin({ type: 'auth' }).users.deleteUser(user.userId);

      expect(await countRows('group_users', 'user_id', user.userId)).toBe(0);
    });

    it('should cascade delete tenant_users when user is deleted', async () => {
      const user = await createTenantUser(services, db, adminOrigin);

      expect(await countRows('tenant_users', 'user_id', user.userId)).toBe(1);

      await services.withOrigin({ type: 'auth' }).users.deleteUser(user.userId);

      expect(await countRows('tenant_users', 'user_id', user.userId)).toBe(0);
    });

    it('should cascade delete platform_group_users when user is deleted', async () => {
      const user = await createUser(db);

      const platformGroupId = uuidv7();
      await services.withOrigin({ type: 'auth' }).platformGroups.createPlatformGroup({
        id: platformGroupId, name: 'PG for user cascade',
      });
      await services.withOrigin({ type: 'auth' }).platformGroups.addUserToPlatformGroup(platformGroupId, user.userId);

      expect(await countRows('platform_group_users', 'user_id', user.userId)).toBe(1);

      await services.withOrigin({ type: 'auth' }).users.deleteUser(user.userId);

      expect(await countRows('platform_group_users', 'user_id', user.userId)).toBe(0);
    });
  });

  describe('platform group cascade', () => {
    it('should cascade delete platform_group_users when platform group is deleted', async () => {
      const user = await createUser(db);

      const platformGroupId = uuidv7();
      await services.withOrigin({ type: 'auth' }).platformGroups.createPlatformGroup({
        id: platformGroupId, name: 'PG cascade users',
      });
      await services.withOrigin({ type: 'auth' }).platformGroups.addUserToPlatformGroup(platformGroupId, user.userId);

      expect(await countRows('platform_group_users', 'platform_group_id', platformGroupId)).toBe(1);

      await services.withOrigin({ type: 'auth' }).platformGroups.deletePlatformGroup(platformGroupId);

      expect(await countRows('platform_group_users', 'platform_group_id', platformGroupId)).toBe(0);
    });

    it('should cascade delete platform_group_roles when platform group is deleted', async () => {
      const platformGroupId = uuidv7();
      await services.withOrigin({ type: 'auth' }).platformGroups.createPlatformGroup({
        id: platformGroupId, name: 'PG cascade roles',
      });

      const platformRoleId = uuidv7();
      await services.withOrigin({ type: 'auth' }).platformRoles.createPlatformRole({
        id: platformRoleId, name: 'PR for PG cascade',
      });
      await services.withOrigin({ type: 'auth' }).platformGroups.addRoleToPlatformGroup(platformGroupId, platformRoleId);

      expect(await countRows('platform_group_roles', 'platform_group_id', platformGroupId)).toBe(1);

      await services.withOrigin({ type: 'auth' }).platformGroups.deletePlatformGroup(platformGroupId);

      expect(await countRows('platform_group_roles', 'platform_group_id', platformGroupId)).toBe(0);
    });
  });

  describe('platform role cascade', () => {
    it('should cascade delete platform_role_capabilities when platform role is deleted', async () => {
      const platformRoleId = uuidv7();
      await services.withOrigin({ type: 'auth' }).platformRoles.createPlatformRole({
        id: platformRoleId, name: 'PR cascade caps',
      });
      await services.withOrigin({ type: 'auth' }).platformRoles.addCapabilityToPlatformRole(platformRoleId, PlatformCapability_PlatformAccess);

      expect(await countRows('platform_role_capabilities', 'platform_role_id', platformRoleId)).toBe(1);

      await services.withOrigin({ type: 'auth' }).platformRoles.deletePlatformRole(platformRoleId);

      expect(await countRows('platform_role_capabilities', 'platform_role_id', platformRoleId)).toBe(0);
    });

    it('should cascade delete platform_group_roles when platform role is deleted', async () => {
      const platformGroupId = uuidv7();
      await services.withOrigin({ type: 'auth' }).platformGroups.createPlatformGroup({
        id: platformGroupId, name: 'PG for PR cascade',
      });

      const platformRoleId = uuidv7();
      await services.withOrigin({ type: 'auth' }).platformRoles.createPlatformRole({
        id: platformRoleId, name: 'PR cascade group_roles',
      });
      await services.withOrigin({ type: 'auth' }).platformGroups.addRoleToPlatformGroup(platformGroupId, platformRoleId);

      expect(await countRows('platform_group_roles', 'platform_role_id', platformRoleId)).toBe(1);

      await services.withOrigin({ type: 'auth' }).platformRoles.deletePlatformRole(platformRoleId);

      expect(await countRows('platform_group_roles', 'platform_role_id', platformRoleId)).toBe(0);
    });
  });

  describe('idempotent junction inserts (onConflictDoNothing)', () => {
    it('should not fail or duplicate when adding the same user to a tenant group twice', async () => {
      const groupId = uuidv7();
      await services.withOrigin(adminOrigin).groups.createGroup({ id: groupId, name: 'Idem Group' });

      const user = await createTenantUser(services, db, adminOrigin);
      await services.withOrigin(adminOrigin).groups.addUserToGroup(groupId, user.userId);
      await services.withOrigin(adminOrigin).groups.addUserToGroup(groupId, user.userId);

      expect(await countRows('group_users', 'group_id', groupId)).toBe(1);
    });

    it('should not fail or duplicate when adding the same role to a tenant group twice', async () => {
      const groupId = uuidv7();
      await services.withOrigin(adminOrigin).groups.createGroup({ id: groupId, name: 'Idem Role Group' });

      const roleId = uuidv7();
      await services.withOrigin(adminOrigin).roles.createRole({ id: roleId, name: 'Idem Role' });
      await services.withOrigin(adminOrigin).groups.addRoleToGroup(groupId, roleId);
      await services.withOrigin(adminOrigin).groups.addRoleToGroup(groupId, roleId);

      expect(await countRows('group_roles', 'group_id', groupId)).toBe(1);
    });

    it('should not fail or duplicate when adding the same capability to a role twice', async () => {
      const roleId = uuidv7();
      await services.withOrigin(adminOrigin).roles.createRole({ id: roleId, name: 'Idem Cap Role' });
      await services.withOrigin(adminOrigin).roles.addCapabilityToRole(roleId, Capability_ManageSecurity);
      await services.withOrigin(adminOrigin).roles.addCapabilityToRole(roleId, Capability_ManageSecurity);

      expect(await countRows('role_capabilities', 'role_id', roleId)).toBe(1);
    });

    it('should not fail or duplicate when adding the same user to a platform group twice', async () => {
      const user = await createUser(db);
      const platformGroupId = uuidv7();
      await services.withOrigin({ type: 'auth' }).platformGroups.createPlatformGroup({ id: platformGroupId, name: 'PG idem users' });
      await services.withOrigin({ type: 'auth' }).platformGroups.addUserToPlatformGroup(platformGroupId, user.userId);
      await services.withOrigin({ type: 'auth' }).platformGroups.addUserToPlatformGroup(platformGroupId, user.userId);

      expect(await countRows('platform_group_users', 'platform_group_id', platformGroupId)).toBe(1);
    });

    it('should not fail or duplicate when adding the same role to a platform group twice', async () => {
      const platformGroupId = uuidv7();
      await services.withOrigin({ type: 'auth' }).platformGroups.createPlatformGroup({ id: platformGroupId, name: 'PG idem roles' });

      const platformRoleId = uuidv7();
      await services.withOrigin({ type: 'auth' }).platformRoles.createPlatformRole({ id: platformRoleId, name: 'PR idem' });
      await services.withOrigin({ type: 'auth' }).platformGroups.addRoleToPlatformGroup(platformGroupId, platformRoleId);
      await services.withOrigin({ type: 'auth' }).platformGroups.addRoleToPlatformGroup(platformGroupId, platformRoleId);

      expect(await countRows('platform_group_roles', 'platform_group_id', platformGroupId)).toBe(1);
    });

    it('should not fail or duplicate when adding the same capability to a platform role twice', async () => {
      const platformRoleId = uuidv7();
      await services.withOrigin({ type: 'auth' }).platformRoles.createPlatformRole({ id: platformRoleId, name: 'PR idem caps' });
      await services.withOrigin({ type: 'auth' }).platformRoles.addCapabilityToPlatformRole(platformRoleId, PlatformCapability_PlatformAccess);
      await services.withOrigin({ type: 'auth' }).platformRoles.addCapabilityToPlatformRole(platformRoleId, PlatformCapability_PlatformAccess);

      expect(await countRows('platform_role_capabilities', 'platform_role_id', platformRoleId)).toBe(1);
    });
  });

  describe('tenant cascade', () => {
    it('should cascade delete tenant_users when tenant is deleted', async () => {
      // Create a bare tenant + tenant_user via raw SQL to avoid entity-to-entity FK constraints
      // (groups, roles, etc. reference tenants without cascade, which is by design)
      const bareTenantId = uuidv7();
      await db.execute(sql`INSERT INTO tenants (id, name) VALUES (${bareTenantId}, 'Bare Tenant')`);
      await db.execute(sql`INSERT INTO tenant_users (tenant_id, user_id) VALUES (${bareTenantId}, ${adminUserId})`);

      expect(await countRows('tenant_users', 'tenant_id', bareTenantId)).toBe(1);

      await db.execute(sql`DELETE FROM tenants WHERE id = ${bareTenantId}`);

      expect(await countRows('tenant_users', 'tenant_id', bareTenantId)).toBe(0);
    });
  });
});
