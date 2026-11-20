import type { EventOrigin } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantUser, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('Service Accounts Service', () => {
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
    it('should create and retrieve a service account', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({
        id, name: 'My Bot',
      });

      const sa = await services.withOrigin(adminOrigin).serviceAccounts.getServiceAccount(id);
      expect(sa).toBeTruthy();
      expect(sa!.name).toBe('My Bot');
      expect(sa!.active).toBe(true);
      expect(sa!.tenantId).toBe(tenantId);
    });

    it('should create and retrieve a service account with a description', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({
        id, name: 'Described Bot', description: 'Handles external feed sync',
      });

      const sa = await services.withOrigin(adminOrigin).serviceAccounts.getServiceAccount(id);
      expect(sa!.description).toBe('Handles external feed sync');
    });

    it('should update the description of a service account', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id, name: 'Bot' });

      await services.withOrigin(adminOrigin).serviceAccounts.updateServiceAccount(id, {
        description: 'Updated description',
      });

      const sa = await services.withOrigin(adminOrigin).serviceAccounts.getServiceAccount(id);
      expect(sa!.description).toBe('Updated description');
    });

    it('should list service accounts in the tenant', async () => {
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: uuidv7(), name: 'SA 1' });
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: uuidv7(), name: 'SA 2' });

      const list = await services.withOrigin(adminOrigin).serviceAccounts.getServiceAccounts();
      expect(list.length).toBeGreaterThanOrEqual(2);
    });

    it('should update name and active status', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id, name: 'Old Name' });

      await services.withOrigin(adminOrigin).serviceAccounts.updateServiceAccount(id, {
        name: 'New Name',
        active: false,
      });

      const sa = await services.withOrigin(adminOrigin).serviceAccounts.getServiceAccount(id);
      expect(sa!.name).toBe('New Name');
      expect(sa!.active).toBe(false);
    });

    it('should disable a service account (soft-delete: remains visible but inactive)', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id, name: 'To Disable' });

      await services.withOrigin(adminOrigin).serviceAccounts.updateServiceAccount(id, { active: false });

      const sa = await services.withOrigin(adminOrigin).serviceAccounts.getServiceAccount(id);
      expect(sa).toBeDefined();
      expect(sa!.active).toBe(false);
    });
  });

  describe('group management', () => {
    it('should add and remove a group from a service account', async () => {
      const saId = uuidv7();
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: saId, name: 'SA Bot' });

      const groupId = uuidv7();
      await services.withOrigin(adminOrigin).groups.createGroup({ id: groupId, name: 'Connectors' });

      await services.withOrigin(adminOrigin).serviceAccounts.addGroupToServiceAccount(saId, groupId);

      let saGroups = await services.withOrigin(adminOrigin).serviceAccounts.getServiceAccountGroups(saId);
      expect(saGroups.map((g) => g.group.id)).toContain(groupId);

      await services.withOrigin(adminOrigin).serviceAccounts.removeGroupFromServiceAccount(saId, groupId);

      saGroups = await services.withOrigin(adminOrigin).serviceAccounts.getServiceAccountGroups(saId);
      expect(saGroups.map((g) => g.group.id)).not.toContain(groupId);
    });
  });

  describe('list page', () => {
    it('should carry each account\'s groups and the roles they grant, a role two groups share listed once', async () => {
      const scoped = services.withOrigin(adminOrigin);
      const saId = uuidv7();
      await scoped.serviceAccounts.createServiceAccount({ id: saId, name: 'Feed Bot' });
      const ingestId = uuidv7();
      const exportId = uuidv7();
      await scoped.groups.createGroup({ id: ingestId, name: 'Ingest' });
      await scoped.groups.createGroup({ id: exportId, name: 'Export' });
      const sharedRoleId = uuidv7();
      const exportRoleId = uuidv7();
      await scoped.roles.createRole({ id: sharedRoleId, name: 'Reader' });
      await scoped.roles.createRole({ id: exportRoleId, name: 'Exporter' });
      await scoped.groups.addRoleToGroup(ingestId, sharedRoleId);
      await scoped.groups.addRoleToGroup(exportId, sharedRoleId);
      await scoped.groups.addRoleToGroup(exportId, exportRoleId);
      await scoped.serviceAccounts.addGroupToServiceAccount(saId, ingestId);
      await scoped.serviceAccounts.addGroupToServiceAccount(saId, exportId);

      const rows = await scoped.serviceAccounts.listServiceAccounts();

      expect(rows.find((row) => row.id === saId)).toEqual({
        id: saId,
        name: 'Feed Bot',
        active: true,
        groups: [{ id: exportId, name: 'Export' }, { id: ingestId, name: 'Ingest' }],
        roles: [{ id: exportRoleId, name: 'Exporter' }, { id: sharedRoleId, name: 'Reader' }],
      });
    });

    it('should carry no groups and no roles for an account in no group', async () => {
      const saId = uuidv7();
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: saId, name: 'Idle Bot' });

      const rows = await services.withOrigin(adminOrigin).serviceAccounts.listServiceAccounts();

      expect(rows.find((row) => row.id === saId)).toEqual({ id: saId, name: 'Idle Bot', active: true, groups: [], roles: [] });
    });

    it('should not list another tenant\'s accounts', async () => {
      const tenantB = await createTenant(services, adminUserId);
      const originB: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenantB };
      const saBId = uuidv7();
      await services.withOrigin(originB).serviceAccounts.createServiceAccount({ id: saBId, name: 'SA B' });

      const rows = await services.withOrigin(adminOrigin).serviceAccounts.listServiceAccounts();

      expect(rows.map((row) => row.id)).not.toContain(saBId);
    });
  });

  describe('tenant isolation', () => {
    it('should not expose service accounts from another tenant', async () => {
      // Reuse the admin already created in beforeEach, createAdminUser can only be called once.
      // adminOrigin is always { type: 'client', userId, tenantId } here.
      const tenantB = await createTenant(services, adminUserId);
      const originB: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenantB };

      // Create SA in tenant A
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: uuidv7(), name: 'SA A' });
      // Create SA in tenant B
      await services.withOrigin(originB).serviceAccounts.createServiceAccount({ id: uuidv7(), name: 'SA B' });

      const listA = await services.withOrigin(adminOrigin).serviceAccounts.getServiceAccounts();
      const listB = await services.withOrigin(originB).serviceAccounts.getServiceAccounts();

      expect(listA.every((sa) => sa.tenantId === tenantId)).toBe(true);
      expect(listB.every((sa) => sa.tenantId === tenantB)).toBe(true);
    });
  });

  describe('security policy', () => {
    it('should not allow a user without MANAGE_SECURITY to read service accounts', async () => {
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: uuidv7(), name: 'SA' });

      const regularUser = await createTenantUser(services, db, adminOrigin);
      const list = await services.withOrigin(regularUser.origin).serviceAccounts.getServiceAccounts();
      expect(list).toHaveLength(0);
    });

    it('should not allow a user without MANAGE_SECURITY to create a service account', async () => {
      const regularUser = await createTenantUser(services, db, adminOrigin);

      await expect(
        services.withOrigin(regularUser.origin).serviceAccounts.createServiceAccount({
          id: uuidv7(), name: 'Unauthorized SA',
        }),
      ).rejects.toThrow();
    });
  });

});
