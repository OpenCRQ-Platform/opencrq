import type { EventOrigin } from '@app/module';
import { Capability_ManageSecurity } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantUser, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('Roles Service', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
  });

  describe('CRUD', () => {
    it('should create a role', async () => {
      const roleId = uuidv7();
      await services.withOrigin(adminOrigin).roles.createRole({
        id: roleId, name: 'Editor',
      });

      const role = await services.withOrigin(adminOrigin).roles.getRole(roleId);
      expect(role).toBeTruthy();
      expect(role!.name).toBe('Editor');
    });

    it('should list roles in the tenant', async () => {
      await services.withOrigin(adminOrigin).roles.createRole({
        id: uuidv7(), name: 'Role A',
      });

      // Tenant already has an 'Admin' role from createTenantWithAdmin
      const allRoles = await services.withOrigin(adminOrigin).roles.getRoles();
      expect(allRoles.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('capability management', () => {
    it('should add and remove a capability from a role', async () => {
      const roleId = uuidv7();
      await services.withOrigin(adminOrigin).roles.createRole({
        id: roleId, name: 'Custom Role',
      });

      await services.withOrigin(adminOrigin).roles.addCapabilityToRole(roleId, Capability_ManageSecurity);

      let caps = await services.withOrigin(adminOrigin).roles.getRoleCapabilities(roleId);
      expect(caps.map((c) => c.capability.id)).toContain(Capability_ManageSecurity);

      await services.withOrigin(adminOrigin).roles.removeCapabilityFromRole(roleId, Capability_ManageSecurity);

      caps = await services.withOrigin(adminOrigin).roles.getRoleCapabilities(roleId);
      expect(caps.map((c) => c.capability.id)).not.toContain(Capability_ManageSecurity);
    });
  });

  describe('list page', () => {
    it('should count each role\'s capabilities', async () => {
      const scoped = services.withOrigin(adminOrigin);
      const customId = uuidv7();
      const emptyId = uuidv7();
      await scoped.roles.createRole({ id: customId, name: 'Custom Role' });
      await scoped.roles.createRole({ id: emptyId, name: 'Empty Role' });
      await scoped.roles.addCapabilityToRole(customId, Capability_ManageSecurity);

      const rows = await scoped.roles.listRoles();

      expect(rows.find((row) => row.id === customId)).toEqual({ id: customId, name: 'Custom Role', capabilityCount: 1 });
      expect(rows.find((row) => row.id === emptyId)).toEqual({ id: emptyId, name: 'Empty Role', capabilityCount: 0 });
    });

    it('should count the same capabilities the role detail lists', async () => {
      const scoped = services.withOrigin(adminOrigin);
      const rows = await scoped.roles.listRoles();
      const admin = rows.find((row) => row.name === 'Admin')!;

      const capabilities = await scoped.roles.getRoleCapabilities(admin.id);

      expect(admin.capabilityCount).toBe(capabilities.length);
      expect(admin.capabilityCount).toBeGreaterThan(0);
    });

    it('should list nothing to a user without MANAGE_SECURITY', async () => {
      const regularUser = await createTenantUser(services, db, adminOrigin);

      const rows = await services.withOrigin(regularUser.origin).roles.listRoles();

      expect(rows).toHaveLength(0);
    });
  });

  describe('getUserRoles', () => {
    it('should return roles for a user via group membership', async () => {
      // Admin is in the 'Admin' group which has the 'Admin' role
      const userRoles = await services.withOrigin(adminOrigin).roles.getUserRoles(adminUserId);
      expect(userRoles.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('security policy', () => {
    it('should not allow a user without MANAGE_SECURITY to see roles', async () => {
      const regularUser = await createTenantUser(services, db, adminOrigin);

      const rolesSeen = await services.withOrigin(regularUser.origin).roles.getRoles();
      expect(rolesSeen).toHaveLength(0);
    });

    it('should not allow a user without MANAGE_SECURITY to create a role', async () => {
      const regularUser = await createTenantUser(services, db, adminOrigin);

      await expect(
        services.withOrigin(regularUser.origin).roles.createRole({
          id: uuidv7(), name: 'Unauthorized Role',
        }),
      ).rejects.toThrow();
    });
  });
});
