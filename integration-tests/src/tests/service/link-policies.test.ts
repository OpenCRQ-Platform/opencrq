import type { EventOrigin } from '@app/module';
import {
  Capability_ManageSecurity,
  createProtectedDB,
  groupRoles,
  groupUsers,
  roleCapabilities,
  serviceAccountGroups,
} from '@app/module';
import { and, eq, inArray } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantUser, createTenantWithAdmin, createUser } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const protectedDbFor = (origin: EventOrigin) => createProtectedDB(db, (callback) => db.transaction(callback), origin);

describe('Link policies', () => {
  let adminOrigin: EventOrigin;
  let otherAdminOrigin: EventOrigin;
  let otherTenantId: string;
  let groupId: string;
  let otherGroupId: string;
  let roleId: string;
  let otherRoleId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    otherTenantId = await createTenant(services, setup.userId);
    otherAdminOrigin = { type: 'client', userId: setup.userId, tenantId: otherTenantId };
    groupId = uuidv7();
    otherGroupId = uuidv7();
    await services.withOrigin(adminOrigin).groups.createGroup({ id: groupId, name: 'Group of A' });
    await services.withOrigin(otherAdminOrigin).groups.createGroup({ id: otherGroupId, name: 'Group of B' });
    roleId = uuidv7();
    otherRoleId = uuidv7();
    await services.withOrigin(adminOrigin).roles.createRole({ id: roleId, name: 'Role of A' });
    await services.withOrigin(otherAdminOrigin).roles.createRole({ id: otherRoleId, name: 'Role of B' });
  });

  describe('group_users', () => {
    it('should refuse a user who is not a member of the tenant', async () => {
      const stranger = await createUser(db);

      await expect(
        protectedDbFor(adminOrigin).insert(groupUsers).values({ groupId, userId: stranger.userId }),
      ).rejects.toThrow('Access Denied');
    });

    it('should refuse a group of another tenant for a user who is a member of both', async () => {
      const member = await createTenantUser(services, db, adminOrigin);
      await services.withOrigin(otherAdminOrigin).tenants.addTenantUser(otherTenantId, member.userId);

      await expect(
        protectedDbFor(adminOrigin).insert(groupUsers).values({ groupId: otherGroupId, userId: member.userId }),
      ).rejects.toThrow('Access Denied');
    });

    it('should leave the memberships of another tenant\'s group untouched on delete', async () => {
      const member = await createTenantUser(services, db, otherAdminOrigin);
      await db.insert(groupUsers).values({ groupId: otherGroupId, userId: member.userId });

      await protectedDbFor(adminOrigin).delete(groupUsers)
        .where(and(eq(groupUsers.groupId, otherGroupId), eq(groupUsers.userId, member.userId)));

      expect(await db.select().from(groupUsers).where(eq(groupUsers.groupId, otherGroupId))).toHaveLength(1);
    });

    it('should refuse a member without MANAGE_SECURITY', async () => {
      const member = await createTenantUser(services, db, adminOrigin);

      await expect(
        protectedDbFor(member.origin).insert(groupUsers).values({ groupId, userId: member.userId }),
      ).rejects.toThrow('Access Denied');
    });
  });

  describe('group_roles', () => {
    it('should refuse a role of another tenant', async () => {
      await expect(
        protectedDbFor(adminOrigin).insert(groupRoles).values({ groupId, roleId: otherRoleId }),
      ).rejects.toThrow('Access Denied');
    });

    it('should refuse a group of another tenant', async () => {
      await expect(
        protectedDbFor(adminOrigin).insert(groupRoles).values({ groupId: otherGroupId, roleId: otherRoleId }),
      ).rejects.toThrow('Access Denied');
    });

    it('should leave the roles of another tenant\'s group untouched on delete', async () => {
      await db.insert(groupRoles).values({ groupId: otherGroupId, roleId: otherRoleId });

      await protectedDbFor(adminOrigin).delete(groupRoles)
        .where(and(eq(groupRoles.groupId, otherGroupId), eq(groupRoles.roleId, otherRoleId)));

      expect(await db.select().from(groupRoles).where(eq(groupRoles.groupId, otherGroupId))).toHaveLength(1);
    });
  });

  describe('role_capabilities', () => {
    it('should refuse a role of another tenant', async () => {
      await expect(
        protectedDbFor(adminOrigin).insert(roleCapabilities).values({ roleId: otherRoleId, capabilityId: Capability_ManageSecurity }),
      ).rejects.toThrow('Access Denied');
    });

    it('should leave the capabilities of another tenant\'s role untouched on delete', async () => {
      await db.insert(roleCapabilities).values({ roleId: otherRoleId, capabilityId: Capability_ManageSecurity });

      await protectedDbFor(adminOrigin).delete(roleCapabilities).where(eq(roleCapabilities.roleId, otherRoleId));

      expect(await db.select().from(roleCapabilities).where(eq(roleCapabilities.roleId, otherRoleId))).toHaveLength(1);
    });
  });

  describe('service_account_groups', () => {
    let serviceAccountId: string;
    let otherServiceAccountId: string;

    beforeEach(async () => {
      serviceAccountId = uuidv7();
      otherServiceAccountId = uuidv7();
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'Bot of A' });
      await services.withOrigin(otherAdminOrigin).serviceAccounts.createServiceAccount({ id: otherServiceAccountId, name: 'Bot of B' });
    });

    it('should refuse a group of another tenant', async () => {
      await expect(
        protectedDbFor(adminOrigin).insert(serviceAccountGroups).values({ serviceAccountId, groupId: otherGroupId }),
      ).rejects.toThrow('Access Denied');
    });

    it('should refuse a service account of another tenant', async () => {
      await expect(
        protectedDbFor(adminOrigin).insert(serviceAccountGroups).values({ serviceAccountId: otherServiceAccountId, groupId }),
      ).rejects.toThrow('Access Denied');
    });

    it('should leave the service accounts of another tenant\'s group untouched on delete', async () => {
      await db.insert(serviceAccountGroups).values({ serviceAccountId: otherServiceAccountId, groupId: otherGroupId });

      await protectedDbFor(adminOrigin).delete(serviceAccountGroups).where(eq(serviceAccountGroups.groupId, otherGroupId));

      expect(await db.select().from(serviceAccountGroups).where(eq(serviceAccountGroups.groupId, otherGroupId))).toHaveLength(1);
    });
  });

  describe('update', () => {
    type Probe = { update: () => Promise<unknown>, rows: () => Promise<Array<unknown>> };

    it.each<[string, () => Promise<Probe>]>([
      ['group_users', async () => {
        const member = await createTenantUser(services, db, adminOrigin);
        const secondGroupId = uuidv7();
        await services.withOrigin(adminOrigin).groups.createGroup({ id: secondGroupId, name: 'Second group of A' });
        await db.insert(groupUsers).values({ groupId, userId: member.userId });
        return {
          update: async () => protectedDbFor(adminOrigin).update(groupUsers).set({ groupId: secondGroupId }).where(eq(groupUsers.userId, member.userId)),
          rows: async () => db.select().from(groupUsers).where(eq(groupUsers.userId, member.userId)),
        };
      }],
      ['group_roles', async () => {
        const secondRoleId = uuidv7();
        await services.withOrigin(adminOrigin).roles.createRole({ id: secondRoleId, name: 'Second role of A' });
        await db.insert(groupRoles).values({ groupId, roleId });
        return {
          update: async () => protectedDbFor(adminOrigin).update(groupRoles).set({ roleId: secondRoleId }).where(eq(groupRoles.groupId, groupId)),
          rows: async () => db.select().from(groupRoles).where(eq(groupRoles.groupId, groupId)),
        };
      }],
      ['role_capabilities', async () => {
        const secondRoleId = uuidv7();
        await services.withOrigin(adminOrigin).roles.createRole({ id: secondRoleId, name: 'Second role of A' });
        await db.insert(roleCapabilities).values({ roleId, capabilityId: Capability_ManageSecurity });
        return {
          update: async () => protectedDbFor(adminOrigin).update(roleCapabilities).set({ roleId: secondRoleId }).where(eq(roleCapabilities.roleId, roleId)),
          rows: async () => db.select().from(roleCapabilities).where(inArray(roleCapabilities.roleId, [roleId, secondRoleId])),
        };
      }],
      ['service_account_groups', async () => {
        const serviceAccountId = uuidv7();
        const secondGroupId = uuidv7();
        await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'Bot of A' });
        await services.withOrigin(adminOrigin).groups.createGroup({ id: secondGroupId, name: 'Second group of A' });
        await db.insert(serviceAccountGroups).values({ serviceAccountId, groupId });
        return {
          update: async () => protectedDbFor(adminOrigin).update(serviceAccountGroups).set({ groupId: secondGroupId })
            .where(eq(serviceAccountGroups.serviceAccountId, serviceAccountId)),
          rows: async () => db.select().from(serviceAccountGroups).where(eq(serviceAccountGroups.serviceAccountId, serviceAccountId)),
        };
      }],
    ])('should leave a row of the caller\'s own tenant unchanged on %s', async (_table, prepare) => {
      const { update, rows } = await prepare();
      const before = await rows();
      expect(before).toHaveLength(1);

      await update();

      expect(await rows()).toEqual(before);
    });
  });

  describe('every link table', () => {
    type Member = Awaited<ReturnType<typeof createTenantUser>>;

    it.each<[string, (member: Member) => Promise<unknown>]>([
      ['group_users', async (member) => protectedDbFor(member.origin).insert(groupUsers).values({ groupId, userId: member.userId })],
      ['group_roles', async (member) => protectedDbFor(member.origin).insert(groupRoles).values({ groupId, roleId })],
      ['role_capabilities', async (member) => protectedDbFor(member.origin).insert(roleCapabilities)
        .values({ roleId, capabilityId: Capability_ManageSecurity })],
      ['service_account_groups', async (member) => {
        const serviceAccountId = uuidv7();
        await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'Bot of A' });
        return protectedDbFor(member.origin).insert(serviceAccountGroups).values({ serviceAccountId, groupId });
      }],
    ])('should refuse a member without MANAGE_SECURITY on %s', async (_table, insertAsMember) => {
      const member = await createTenantUser(services, db, adminOrigin);

      await expect(insertAsMember(member)).rejects.toThrow('Access Denied');
    });
  });
});
