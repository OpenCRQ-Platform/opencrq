import type { EventOrigin } from '@app/module';
import {
  Capability_ManageSecurity,
  LastPlatformAdminError,
  PlatformCapability_CreateTenants,
  PlatformCapability_ManageUsers,
  PlatformCapability_PlatformAccess,
} from '@app/module';
import { sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createAdminUser, createTenant, createTenantUser, createUser } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const PLATFORM_CAPABILITIES = [PlatformCapability_CreateTenants, PlatformCapability_ManageUsers, PlatformCapability_PlatformAccess];

const setSuperAdmin = async (userId: string, isSuperAdmin: boolean) => {
  await db.execute(sql`UPDATE users SET is_super_admin = ${isSuperAdmin} WHERE id = ${userId}`);
};

/**
 * XTM One's platform administrator holds every right in every tenant and on the platform, through
 * the security predicates and with no membership; everyone else keeps exactly the rights they had.
 */
describe('Super administrator', () => {
  let adminId: string;
  let tenantA: string;
  let tenantB: string;
  let memberA: { userId: string, origin: EventOrigin };
  let superAdminId: string;
  let strangerId: string;

  const inTenant = (userId: string, tenantId: string): EventOrigin => ({ type: 'client', userId, tenantId });
  const onPlatform = (userId: string): EventOrigin => ({ type: 'platform', userId });

  /** Everything the bypass opens, read as `userId` in tenant A or on the platform. */
  const reach = async (userId: string) => {
    const scoped = services.withOrigin(inTenant(userId, tenantA));
    const platform = services.withOrigin(onPlatform(userId));
    const platformCapabilities = await Promise.all(PLATFORM_CAPABILITIES.map((id) => platform.platformCapabilities.hasPlatformCapability(id)));
    return {
      organizations: (await scoped.organizations.getOrganizations()).map((organization) => organization.name),
      members: (await scoped.tenants.listTenantUsers(tenantA)).map((member) => member.id).sort(),
      tenants: (await platform.tenants.getTenants()).map((tenant) => tenant.id).sort(),
      manageSecurity: await scoped.capabilities.hasManageSecurity(),
      platformCapabilities,
    };
  };

  beforeEach(async () => {
    await truncateAllTables(db);
    adminId = (await createAdminUser(services)).userId;
    tenantA = await createTenant(services, adminId);
    tenantB = await createTenant(services, adminId);
    memberA = await createTenantUser(services, db, inTenant(adminId, tenantA));
    await services.withOrigin(memberA.origin).organizations.createOrganizations([{ id: uuidv7(), name: 'Scope A' }]);
    await services.withOrigin(inTenant(adminId, tenantB)).organizations.createOrganizations([{ id: uuidv7(), name: 'Scope B' }]);
    superAdminId = (await createUser(db, 'xtm-admin@example.com')).userId;
    await setSuperAdmin(superAdminId, true);
    strangerId = (await createUser(db, 'stranger@example.com')).userId;
  });

  describe('granted', () => {
    it('should read every tenant, its rows and its members, with no membership, listed among them as super administrator', async () => {
      expect(await reach(superAdminId)).toEqual({
        organizations: ['Scope A'],
        members: [adminId, memberA.userId, superAdminId].sort(),
        tenants: [tenantA, tenantB].sort(),
        manageSecurity: true,
        platformCapabilities: [true, true, true],
      });
      expect((await db.execute(sql`SELECT 1 FROM tenant_users WHERE user_id = ${superAdminId}`)).rows).toHaveLength(0);
    });

    it('should write the rows of a tenant and of its children', async () => {
      const scoped = services.withOrigin(inTenant(superAdminId, tenantB));
      const organizationId = uuidv7();
      await scoped.organizations.createOrganizations([{ id: organizationId, name: 'Created by the super administrator' }]);
      const primaryAssetId = uuidv7();
      await scoped.primaryAssets.createPrimaryAsset({
        id: primaryAssetId, organizationId, name: 'Payments', description: null, ownerId: null, businessValueCategoryIds: [],
      });
      await scoped.organizations.updateOrganization(organizationId, { name: 'Renamed' });

      const seenByAdmin = services.withOrigin(inTenant(adminId, tenantB));
      expect((await seenByAdmin.organizations.getOrganization(organizationId))?.name).toBe('Renamed');
      expect((await seenByAdmin.primaryAssets.getPrimaryAsset(primaryAssetId))?.name).toBe('Payments');

      await scoped.primaryAssets.deletePrimaryAssets([primaryAssetId]);
      expect(await seenByAdmin.primaryAssets.getPrimaryAsset(primaryAssetId)).toBeUndefined();
    });

    it('should manage the members of a tenant', async () => {
      const scoped = services.withOrigin(inTenant(superAdminId, tenantA));
      await scoped.tenants.addTenantUser(tenantA, strangerId);
      await scoped.tenants.updateTenantUserProfile(tenantA, strangerId, { name: 'Renamed here' });
      expect((await scoped.tenants.listTenantUsers(tenantA)).find((member) => member.id === strangerId)?.name).toBe('Renamed here');

      await scoped.tenants.removeTenantUser(tenantA, strangerId);
      expect(await services.withOrigin(inTenant(adminId, tenantA)).tenants.isTenantUser(tenantA, strangerId)).toBe(false);
    });

    it('should hold every tenant capability, as the effective capabilities say too', async () => {
      const capabilities = await services.withOrigin(inTenant(adminId, tenantA)).capabilities.getUserCapabilities(superAdminId);

      expect(capabilities.map((capability) => capability.id)).toContain(Capability_ManageSecurity);
    });

    it('should show every tenant and platform capability in the effective permissions, granted as super administrator rather than by a group', async () => {
      const scoped = services.withOrigin(inTenant(adminId, tenantA));
      const platform = services.withOrigin(onPlatform(adminId));
      const tenantCapabilityIds = (await scoped.capabilities.getCapabilities()).map((capability) => capability.id).sort();
      const platformCapabilityIds = (await platform.platformCapabilities.getPlatformCapabilities()).map((capability) => capability.id).sort();

      const tenantGrants = await scoped.capabilities.getUserEffectivePermissions(superAdminId);
      const platformGrants = await platform.platformCapabilities.getUserPlatformEffectivePermissions(superAdminId);

      expect(tenantGrants.map((grant) => grant.capabilityId).sort()).toEqual(tenantCapabilityIds);
      expect(platformGrants.map((grant) => grant.capabilityId).sort()).toEqual(platformCapabilityIds);
      for (const grant of [...tenantGrants, ...platformGrants]) {
        expect(grant).toMatchObject({ grantedBy: 'super_administrator', roleId: null, roleName: null, groupId: null, groupName: null });
      }
    });

    it('should manage the platform groups and create a tenant it is not a member of', async () => {
      const platform = services.withOrigin(onPlatform(superAdminId));
      const groupId = uuidv7();
      await platform.platformGroups.createPlatformGroup({ id: groupId, name: 'Auditors' });
      await platform.platformGroups.addUserToPlatformGroup(groupId, strangerId);
      expect((await platform.platformGroups.getPlatformGroupUsers(groupId)).map((row) => row.user.id)).toEqual([strangerId]);

      const tenantId = uuidv7();
      await platform.tenants.createTenant({ id: tenantId, name: 'Fresh' }, superAdminId);
      expect(await services.withOrigin(inTenant(superAdminId, tenantId)).capabilities.hasManageSecurity()).toBe(true);
      expect((await db.execute(sql`SELECT 1 FROM tenant_users WHERE tenant_id = ${tenantId}`)).rows).toHaveLength(0);
      expect((await db.execute(sql`SELECT 1 FROM group_users WHERE user_id = ${superAdminId}`)).rows).toHaveLength(0);
    });

    it('should show as the super administrator in the platform users list', async () => {
      const rows = await services.withOrigin(onPlatform(superAdminId)).users.listPlatformUsers();

      expect(rows.find((row) => row.id === superAdminId)).toMatchObject({ isSuperAdmin: true, platformGroups: [], tenants: [] });
      expect(rows.find((row) => row.id === adminId)).toMatchObject({ isSuperAdmin: false });
    });
  });

  describe('cleared', () => {
    it('should lose every right it held only as super administrator', async () => {
      await setSuperAdmin(superAdminId, false);

      expect(await reach(superAdminId)).toEqual({
        organizations: [],
        members: [],
        tenants: [],
        manageSecurity: false,
        platformCapabilities: [false, false, false],
      });
      await expect(services.withOrigin(inTenant(superAdminId, tenantA)).organizations.createOrganizations([{ id: uuidv7(), name: 'Refused' }]))
        .rejects.toThrow();
    });
  });

  describe('nobody else', () => {
    it('should give a user with no membership nothing, while a super administrator exists', async () => {
      expect(await reach(strangerId)).toEqual({
        organizations: [],
        members: [],
        tenants: [],
        manageSecurity: false,
        platformCapabilities: [false, false, false],
      });
      await expect(services.withOrigin(inTenant(strangerId, tenantA)).organizations.createOrganizations([{ id: uuidv7(), name: 'Refused' }]))
        .rejects.toThrow();
      await expect(services.withOrigin(inTenant(strangerId, tenantA)).tenants.addTenantUser(tenantA, strangerId)).rejects.toThrow();
    });

    it('should keep a member of tenant A out of tenant B, its members and its capabilities', async () => {
      const intoB = services.withOrigin(inTenant(memberA.userId, tenantB));

      expect(await intoB.organizations.getOrganizations()).toEqual([]);
      expect(await intoB.tenants.listTenantUsers(tenantB)).toEqual([]);
      expect(await intoB.capabilities.hasManageSecurity()).toBe(false);
      expect((await services.withOrigin(onPlatform(memberA.userId)).tenants.getTenants()).map((tenant) => tenant.id)).toEqual([tenantA]);
      await expect(intoB.organizations.createOrganizations([{ id: uuidv7(), name: 'Refused' }])).rejects.toThrow();
    });

    it('should show an ordinary user only the capabilities its groups grant, and a user with none nothing', async () => {
      const scoped = services.withOrigin(inTenant(adminId, tenantA));
      const platform = services.withOrigin(onPlatform(adminId));

      const adminTenantGrants = await scoped.capabilities.getUserEffectivePermissions(adminId);
      const adminPlatformGrants = await platform.platformCapabilities.getUserPlatformEffectivePermissions(adminId);

      expect(adminTenantGrants.map((grant) => grant.capabilityId)).toContain(Capability_ManageSecurity);
      expect(adminPlatformGrants.map((grant) => grant.capabilityId)).toContain(PlatformCapability_ManageUsers);
      for (const grant of [...adminTenantGrants, ...adminPlatformGrants]) {
        expect(grant.grantedBy).toBe('group');
        expect(grant.groupId).toEqual(expect.any(String));
        expect(grant.roleId).toEqual(expect.any(String));
      }
      expect(await scoped.capabilities.getUserEffectivePermissions(strangerId)).toEqual([]);
      expect(await platform.platformCapabilities.getUserPlatformEffectivePermissions(strangerId)).toEqual([]);
    });

    it('should leave the users list and the platform groups to their holders', async () => {
      const platform = services.withOrigin(onPlatform(strangerId));

      expect((await platform.users.getUsers()).map((user) => user.id)).toEqual([strangerId]);
      await expect(platform.platformGroups.createPlatformGroup({ id: uuidv7(), name: 'Refused' })).rejects.toThrow();
    });

    it('should never count the super administrator as the last platform administrator', async () => {
      const platform = services.withOrigin(onPlatform(superAdminId));
      const [adminGroup] = await services.withOrigin(onPlatform(adminId)).platformGroups.getUserPlatformGroups(adminId);

      await expect(platform.platformGroups.removeUserFromPlatformGroup(adminGroup.group.id, adminId)).rejects.toThrow(LastPlatformAdminError);
    });
  });
});
