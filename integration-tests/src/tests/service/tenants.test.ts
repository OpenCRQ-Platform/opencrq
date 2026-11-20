import type { EventOrigin } from '@app/module';
import { budgetReviews, Capability_ManageSecurity, createProtectedDB, groupUsers, organizations, PlatformCapability_CreateTenants, riskScenarios, TenantDeletionConflictError, TenantNotFoundError, tenants as tenantsTable, tenantUsers, treatmentPlans } from '@app/module';
import { and, eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createAdminUser, createTenant, createTenantUser, createTenantWithAdmin, createUser, grantCapability } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const sleep = async (ms: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

describe('Tenants Service', () => {
  beforeEach(async () => {
    await truncateAllTables(db);
  });

  describe('createTenant', () => {
    it('should create a tenant with admin user', async () => {
      const admin = await createAdminUser(services);
      const tenantId = await createTenant(services, admin.userId);

      const origin: EventOrigin = { type: 'client', userId: admin.userId, tenantId };
      const tenant = await services.withOrigin(origin).tenants.getTenant(tenantId);
      expect(tenant).toBeTruthy();
      expect(tenant.id).toBe(tenantId);
    });

    it('should reject tenant creation without CREATE_TENANTS capability', async () => {
      const admin = await createAdminUser(services);
      const tenantId = await createTenant(services, admin.userId);

      // Create a regular user without platform capabilities
      const user = await createUser(db);
      await services.withOrigin({ type: 'client', userId: admin.userId, tenantId })
        .tenants.addTenantUser(tenantId, user.userId);

      const userOrigin: EventOrigin = { type: 'platform', userId: user.userId };
      await expect(
        services.withOrigin(userOrigin).tenants.createTenant(
          { id: uuidv7(), name: 'Unauthorized Tenant' },
          user.userId,
        ),
      ).rejects.toThrow('You do not have permission to create tenants');
    });

    it('should create the creator as tenant user automatically', async () => {
      const admin = await createAdminUser(services);
      const tenantId = await createTenant(services, admin.userId);

      const isMember = await services.withOrigin({ type: 'client', userId: admin.userId, tenantId })
        .tenants.isTenantUser(tenantId, admin.userId);
      expect(isMember).toBe(true);
    });
  });

  describe('getTenants', () => {
    it('should list only tenants the user is a member of', async () => {
      const { tenantId, origin } = await createTenantWithAdmin(services);

      const tenants = await services.withOrigin(origin).tenants.getTenants();
      expect(tenants).toHaveLength(1);
      expect(tenants[0].id).toBe(tenantId);
    });

    it('should not list tenants the user is not a member of', async () => {
      // Admin creates a tenant
      const admin = await createAdminUser(services);
      const tenantId = await createTenant(services, admin.userId);

      // Create another user not in the tenant
      const otherUser = await createUser(db);
      const otherOrigin: EventOrigin = { type: 'client', userId: otherUser.userId, tenantId };

      const tenants = await services.withOrigin(otherOrigin).tenants.getTenants();
      expect(tenants).toHaveLength(0);
    });

  });

  describe('getTenantsWithMemberCount', () => {
    it('should report each tenant member count, from a platform origin', async () => {
      const { tenantId, origin } = await createTenantWithAdmin(services);
      const newUser = await createUser(db);
      await services.withOrigin(origin).tenants.addTenantUser(tenantId, newUser.userId);

      const platformOrigin: EventOrigin = { type: 'platform', userId: newUser.userId };
      const tenants = await services.withOrigin(platformOrigin).tenants.getTenantsWithMemberCount();

      const tenant = tenants.find((t) => t.id === tenantId);
      expect(tenant?.memberCount).toBe(2);
    });

    it('should keep the member count in sync after a user is removed', async () => {
      const { userId, tenantId, origin } = await createTenantWithAdmin(services);
      const newUser = await createUser(db);
      await services.withOrigin(origin).tenants.addTenantUser(tenantId, newUser.userId);
      await services.withOrigin(origin).tenants.removeTenantUser(tenantId, newUser.userId);

      const platformOrigin: EventOrigin = { type: 'platform', userId };
      const tenants = await services.withOrigin(platformOrigin).tenants.getTenantsWithMemberCount();

      const tenant = tenants.find((t) => t.id === tenantId);
      expect(tenant?.memberCount).toBe(1);
    });

    it('should report the member count of every tenant the caller belongs to, whichever tenant the client origin names', async () => {
      const { userId, tenantId: tenantA } = await createTenantWithAdmin(services);
      const tenantB = await createTenant(services, userId);
      const originB: EventOrigin = { type: 'client', userId, tenantId: tenantB };
      await createTenantUser(services, db, originB);
      await createTenantUser(services, db, originB);

      const originA: EventOrigin = { type: 'client', userId, tenantId: tenantA };
      const tenants = await services.withOrigin(originA).tenants.getTenantsWithMemberCount();

      expect(Object.fromEntries(tenants.map((tenant) => [tenant.id, tenant.memberCount]))).toEqual({ [tenantA]: 1, [tenantB]: 3 });
    });
  });

  describe('deleteTenants', () => {
    it('should delete a tenant together with its scopes, scenarios, primary assets, plans and budget reviews', async () => {
      const { userId, tenantId, origin } = await createTenantWithAdmin(services);
      const organizationId = uuidv7();
      await services.withOrigin(origin).organizations.createOrganizations([{ id: organizationId, name: 'Payment platform' }]);
      const [attackOutcome] = await services.withOrigin(origin).attackOutcomes.getAttackOutcomes();
      const primaryAssetId = uuidv7();
      await services.withOrigin(origin).primaryAssets.createPrimaryAsset({
        id: primaryAssetId, organizationId, name: 'Card data', description: null, ownerId: null, businessValueCategoryIds: [],
      });
      await services.withOrigin(origin).riskScenarios.createRiskScenario({
        id: uuidv7(),
        organizationId,
        name: 'Card data theft',
        description: null,
        attackOutcomeId: attackOutcome.id,
        primaryAssetIds: [primaryAssetId],
      });
      await services.withOrigin(origin).treatmentPlans.createTreatmentPlan({ organizationId, name: 'Q3 hardening' });
      const reviewId = await services.withOrigin(origin).budgetReviews.createBudgetReview({ organizationId, name: 'Exercice', periodStart: `${new Date().getUTCFullYear()}-01-01` });
      await services.withOrigin(origin).budgetReviews.createBudgetReviewLine(reviewId, { name: 'Licences', nature: 'run', amountSpent: 1, capabilityIds: [] });

      await services.withOrigin({ type: 'platform', userId }).tenants.deleteTenants([tenantId]);

      expect(await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId))).toHaveLength(0);
      expect(await db.select().from(organizations).where(eq(organizations.tenantId, tenantId))).toHaveLength(0);
      expect(await db.select().from(riskScenarios).where(eq(riskScenarios.tenantId, tenantId))).toHaveLength(0);
      expect(await db.select().from(budgetReviews).where(eq(budgetReviews.id, reviewId))).toHaveLength(0);
    });

    it('should leave a tenant the caller is not a member of untouched', async () => {
      const { userId } = await createTenantWithAdmin(services);
      const otherTenantId = await createTenant(services, userId);
      await services.withOrigin({ type: 'client', userId, tenantId: otherTenantId }).tenants.removeTenantUser(otherTenantId, userId);

      await services.withOrigin({ type: 'platform', userId }).tenants.deleteTenants([otherTenantId]);

      expect(await db.select().from(tenantsTable).where(eq(tenantsTable.id, otherTenantId))).toHaveLength(1);
    });

    it('should report a row still referencing the tenant as TenantDeletionConflictError', async () => {
      const { userId, tenantId } = await createTenantWithAdmin(services);
      await db.execute(sql`CREATE TABLE tenant_delete_blocker (tenant_id uuid NOT NULL REFERENCES tenants(id))`);
      try {
        await db.execute(sql`INSERT INTO tenant_delete_blocker VALUES (${tenantId})`);

        await expect(
          services.withOrigin({ type: 'platform', userId }).tenants.deleteTenants([tenantId]),
        ).rejects.toBeInstanceOf(TenantDeletionConflictError);
      } finally {
        await db.execute(sql`DROP TABLE tenant_delete_blocker`);
      }
    });

    it('should roll the purge back when the membership disappears before the tenant row goes', async () => {
      const { userId, tenantId, origin } = await createTenantWithAdmin(services);
      const organizationId = uuidv7();
      await services.withOrigin(origin).organizations.createOrganizations([{ id: organizationId, name: 'Payment platform' }]);
      await services.withOrigin(origin).treatmentPlans.createTreatmentPlan({ organizationId, name: 'Q3 hardening' });
      await db.execute(sql`CREATE FUNCTION drop_memberships_mid_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN DELETE FROM tenant_users; RETURN NULL; END $$`);
      await db.execute(sql`CREATE TRIGGER drop_memberships_mid_delete AFTER DELETE ON treatment_plans FOR EACH STATEMENT EXECUTE FUNCTION drop_memberships_mid_delete()`);
      try {
        await expect(
          services.withOrigin({ type: 'platform', userId }).tenants.deleteTenants([tenantId]),
        ).rejects.toBeInstanceOf(TenantDeletionConflictError);
      } finally {
        await db.execute(sql`DROP TRIGGER drop_memberships_mid_delete ON treatment_plans`);
        await db.execute(sql`DROP FUNCTION drop_memberships_mid_delete()`);
      }

      expect(await db.select().from(treatmentPlans).where(eq(treatmentPlans.organizationId, organizationId))).toHaveLength(1);
    });

    it('should reject tenant deletion without CREATE_TENANTS capability', async () => {
      const { tenantId, origin: adminOrigin } = await createTenantWithAdmin(services);
      const regularUser = await createTenantUser(services, db, adminOrigin);

      await expect(
        services.withOrigin(regularUser.origin).tenants.deleteTenants([tenantId]),
      ).rejects.toThrow('You do not have permission to delete tenants');
    });

    it('should not allow a service origin to delete a tenant', async () => {
      const { tenantId, userId } = await createTenantWithAdmin(services);
      const serviceOrigin: EventOrigin = { type: 'connector', serviceAccountId: userId, tenantId };

      await expect(
        services.withOrigin(serviceOrigin).tenants.deleteTenants([tenantId]),
      ).rejects.toThrow('You do not have permission to delete tenants');
    });
  });

  describe('renameTenant', () => {
    const nameOf = async (tenantId: string) => (await services.withOrigin({ type: 'system' }).tenants.getTenant(tenantId))?.name;

    it('should rename the tenant for a member holding CREATE_TENANTS, keeping its id', async () => {
      const { userId, tenantId } = await createTenantWithAdmin(services);

      await services.withOrigin({ type: 'platform', userId }).tenants.renameTenant(tenantId, 'Renamed Tenant');

      const tenant = await services.withOrigin({ type: 'platform', userId }).tenants.getTenant(tenantId);
      expect(tenant).toMatchObject({ id: tenantId, name: 'Renamed Tenant' });
    });

    it('should refuse a CREATE_TENANTS holder who is not a member, and leave the name unchanged', async () => {
      const { tenantId } = await createTenantWithAdmin(services);
      const before = await nameOf(tenantId);
      const outsider = await createUser(db);
      const asAuth = services.withOrigin({ type: 'auth' });
      const roleId = uuidv7();
      const groupId = uuidv7();
      await asAuth.platformRoles.createPlatformRole({ id: roleId, name: 'Tenant Manager' });
      await asAuth.platformRoles.addCapabilityToPlatformRole(roleId, PlatformCapability_CreateTenants);
      await asAuth.platformGroups.createPlatformGroup({ id: groupId, name: 'Tenant Managers' });
      await asAuth.platformGroups.addRoleToPlatformGroup(groupId, roleId);
      await asAuth.platformGroups.addUserToPlatformGroup(groupId, outsider.userId);

      await expect(
        services.withOrigin({ type: 'platform', userId: outsider.userId }).tenants.renameTenant(tenantId, 'Hijacked'),
      ).rejects.toBeInstanceOf(TenantNotFoundError);

      expect(await nameOf(tenantId)).toBe(before);
    });

    it('should refuse a member without CREATE_TENANTS, and leave the name unchanged', async () => {
      const { tenantId, origin } = await createTenantWithAdmin(services);
      const before = await nameOf(tenantId);
      const member = await createTenantUser(services, db, origin);

      await expect(
        services.withOrigin({ type: 'platform', userId: member.userId }).tenants.renameTenant(tenantId, 'Hijacked'),
      ).rejects.toThrow('You do not have permission to rename tenants');

      expect(await nameOf(tenantId)).toBe(before);
    });

    it('should refuse a member who manages the tenant security but lacks CREATE_TENANTS', async () => {
      const { tenantId, origin } = await createTenantWithAdmin(services);
      const before = await nameOf(tenantId);
      const manager = await createTenantUser(services, db, origin);
      await grantCapability(services, origin, manager.userId, Capability_ManageSecurity);

      await expect(
        services.withOrigin(manager.origin).tenants.renameTenant(tenantId, 'Hijacked'),
      ).rejects.toThrow('You do not have permission to rename tenants');

      expect(await nameOf(tenantId)).toBe(before);
    });

    it('should let the super administrator rename a tenant with no membership and no group', async () => {
      const { tenantId } = await createTenantWithAdmin(services);
      const superAdmin = await createUser(db);
      await db.execute(sql`UPDATE users SET is_super_admin = true WHERE id = ${superAdmin.userId}`);

      await services.withOrigin({ type: 'platform', userId: superAdmin.userId }).tenants.renameTenant(tenantId, 'Renamed By Super Admin');

      expect(await nameOf(tenantId)).toBe('Renamed By Super Admin');
    });

    it('should let a client origin rename another tenant it belongs to', async () => {
      const { userId, tenantId: tenantA } = await createTenantWithAdmin(services);
      const tenantB = await createTenant(services, userId);

      await services.withOrigin({ type: 'client', userId, tenantId: tenantA }).tenants.renameTenant(tenantB, 'Renamed From Another Tenant');

      expect(await nameOf(tenantB)).toBe('Renamed From Another Tenant');
      expect(await nameOf(tenantA)).not.toBe('Renamed From Another Tenant');
    });
  });

  describe('tenant user management', () => {
    it('should add a user to a tenant', async () => {
      const { tenantId, origin } = await createTenantWithAdmin(services);
      const newUser = await createUser(db);

      await services.withOrigin(origin).tenants.addTenantUser(tenantId, newUser.userId);

      const isMember = await services.withOrigin(origin)
        .tenants.isTenantUser(tenantId, newUser.userId);
      expect(isMember).toBe(true);
    });

    it('should remove a user from a tenant', async () => {
      const { tenantId, origin } = await createTenantWithAdmin(services);
      const newUser = await createUser(db);

      await services.withOrigin(origin).tenants.addTenantUser(tenantId, newUser.userId);
      await services.withOrigin(origin).tenants.removeTenantUser(tenantId, newUser.userId);

      const isMember = await services.withOrigin(origin)
        .tenants.isTenantUser(tenantId, newUser.userId);
      expect(isMember).toBe(false);
    });

    it('should remove a user from the tenant\'s groups when removing them from the tenant', async () => {
      const { tenantId, origin } = await createTenantWithAdmin(services);
      const member = await createTenantUser(services, db, origin);
      const firstGroupId = uuidv7();
      const secondGroupId = uuidv7();
      await services.withOrigin(origin).groups.createGroup({ id: firstGroupId, name: 'First' });
      await services.withOrigin(origin).groups.createGroup({ id: secondGroupId, name: 'Second' });
      await services.withOrigin(origin).groups.addUserToGroup(firstGroupId, member.userId);
      await services.withOrigin(origin).groups.addUserToGroup(secondGroupId, member.userId);

      await services.withOrigin(origin).tenants.removeTenantUser(tenantId, member.userId);

      expect(await services.withOrigin(origin).groups.getUserGroups(member.userId)).toEqual([]);
      expect(await db.select().from(groupUsers).where(eq(groupUsers.userId, member.userId))).toHaveLength(0);
    });

    it('should keep the user\'s memberships of another tenant\'s groups', async () => {
      const { userId: adminId, tenantId, origin } = await createTenantWithAdmin(services);
      const otherTenantId = await createTenant(services, adminId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminId, tenantId: otherTenantId };
      const member = await createTenantUser(services, db, origin);
      await services.withOrigin(otherOrigin).tenants.addTenantUser(otherTenantId, member.userId);
      const groupId = uuidv7();
      const otherGroupId = uuidv7();
      await services.withOrigin(origin).groups.createGroup({ id: groupId, name: 'Here' });
      await services.withOrigin(otherOrigin).groups.createGroup({ id: otherGroupId, name: 'There' });
      await services.withOrigin(origin).groups.addUserToGroup(groupId, member.userId);
      await services.withOrigin(otherOrigin).groups.addUserToGroup(otherGroupId, member.userId);

      await services.withOrigin(origin).tenants.removeTenantUser(tenantId, member.userId);

      const remaining = await db.select().from(groupUsers).where(eq(groupUsers.userId, member.userId));
      expect(remaining.map((row) => row.groupId)).toEqual([otherGroupId]);
    });

    it('should keep the other members of the tenant\'s groups', async () => {
      const { tenantId, origin } = await createTenantWithAdmin(services);
      const leaving = await createTenantUser(services, db, origin);
      const staying = await createTenantUser(services, db, origin);
      const groupId = uuidv7();
      await services.withOrigin(origin).groups.createGroup({ id: groupId, name: 'Shared' });
      await services.withOrigin(origin).groups.addUserToGroup(groupId, leaving.userId);
      await services.withOrigin(origin).groups.addUserToGroup(groupId, staying.userId);

      await services.withOrigin(origin).tenants.removeTenantUser(tenantId, leaving.userId);

      const remaining = await db.select().from(groupUsers).where(eq(groupUsers.groupId, groupId));
      expect(remaining.map((row) => row.userId)).toEqual([staying.userId]);
    });

    it('should remove an admin who removes themselves from every group of the tenant', async () => {
      const { userId, tenantId, origin } = await createTenantWithAdmin(services);
      const groupId = uuidv7();
      await services.withOrigin(origin).groups.createGroup({ id: groupId, name: 'Extra' });
      await services.withOrigin(origin).groups.addUserToGroup(groupId, userId);

      await services.withOrigin(origin).tenants.removeTenantUser(tenantId, userId);

      const remaining = await db.execute(sql`
        SELECT 1 FROM group_users INNER JOIN groups ON groups.id = group_users.group_id
        WHERE group_users.user_id = ${userId} AND groups.tenant_id = ${tenantId}
      `);
      expect(remaining.rows).toHaveLength(0);
    });

    it('should keep the member and their group grants when a plain member tries to remove them', async () => {
      const { tenantId, origin } = await createTenantWithAdmin(services);
      const member = await createTenantUser(services, db, origin);
      const plainMember = await createTenantUser(services, db, origin);
      const groupId = uuidv7();
      await services.withOrigin(origin).groups.createGroup({ id: groupId, name: 'Kept' });
      await services.withOrigin(origin).groups.addUserToGroup(groupId, member.userId);

      await expect(
        services.withOrigin(plainMember.origin).tenants.removeTenantUser(tenantId, member.userId),
      ).rejects.toThrow('could not be removed from this tenant');

      expect(await services.withOrigin(origin).tenants.isTenantUser(tenantId, member.userId)).toBe(true);
      expect(await db.select().from(groupUsers).where(eq(groupUsers.userId, member.userId))).toHaveLength(1);
    });

    it('should remove a group grant committed while the member was being removed', { timeout: 15_000 }, async () => {
      const { tenantId, origin } = await createTenantWithAdmin(services);
      const member = await createTenantUser(services, db, origin);
      const groupId = uuidv7();
      await services.withOrigin(origin).groups.createGroup({ id: groupId, name: 'Granted late' });

      let removal: Promise<unknown> = Promise.resolve();
      await db.transaction(async (tx) => {
        await createProtectedDB(tx, async (callback) => callback(tx), origin).insert(groupUsers).values({ groupId, userId: member.userId });
        removal = services.withOrigin(origin).tenants.removeTenantUser(tenantId, member.userId);
        await sleep(300);
      });
      await removal;

      expect(await db.select().from(groupUsers).where(eq(groupUsers.userId, member.userId))).toHaveLength(0);
    });

    it('should refuse a group grant made while the member is being removed', { timeout: 15_000 }, async () => {
      const { tenantId, origin } = await createTenantWithAdmin(services);
      const member = await createTenantUser(services, db, origin);
      const groupId = uuidv7();
      await services.withOrigin(origin).groups.createGroup({ id: groupId, name: 'Granted too late' });

      let grant: Promise<unknown> = Promise.resolve();
      await db.transaction(async (tx) => {
        await tx.delete(tenantUsers).where(and(eq(tenantUsers.tenantId, tenantId), eq(tenantUsers.userId, member.userId)));
        grant = services.withOrigin(origin).groups.addUserToGroup(groupId, member.userId).then(() => 'granted', (error: unknown) => error);
        await sleep(300);
      });
      const outcome = await grant;

      expect(outcome).toMatchObject({ message: 'Access Denied' });
      expect(await db.select().from(groupUsers).where(eq(groupUsers.userId, member.userId))).toHaveLength(0);
    });

    it('should refuse to add a user to a tenant other than the origin\'s', async () => {
      const { userId: adminId, tenantId, origin } = await createTenantWithAdmin(services);
      const otherTenantId = await createTenant(services, adminId);
      const newUser = await createUser(db);

      await expect(
        services.withOrigin(origin).tenants.addTenantUser(otherTenantId, newUser.userId),
      ).rejects.toThrow('Cannot create for another tenant');

      expect(await services.withOrigin({ type: 'system' }).tenants.isTenantUser(otherTenantId, newUser.userId)).toBe(false);
      expect(await services.withOrigin({ type: 'system' }).tenants.isTenantUser(tenantId, newUser.userId)).toBe(false);
    });

    it('should refuse a plain member adding a user to their tenant', async () => {
      const { tenantId, origin } = await createTenantWithAdmin(services);
      const plainMember = await createTenantUser(services, db, origin);
      const newUser = await createUser(db);

      await expect(
        services.withOrigin(plainMember.origin).tenants.addTenantUser(tenantId, newUser.userId),
      ).rejects.toThrow('Access Denied');

      expect(await services.withOrigin({ type: 'system' }).tenants.isTenantUser(tenantId, newUser.userId)).toBe(false);
    });

    it('should list tenant users', async () => {
      const { userId, tenantId, origin } = await createTenantWithAdmin(services);
      const newUser = await createUser(db);
      await services.withOrigin(origin).tenants.addTenantUser(tenantId, newUser.userId);

      const users = await services.withOrigin(origin).tenants.getTenantUsers(tenantId);
      expect(users).toHaveLength(2);
      const userIds = users.map((u) => u.userId);
      expect(userIds).toContain(userId);
      expect(userIds).toContain(newUser.userId);
    });

    it('should never return the users\' password hash', async () => {
      const { tenantId, origin } = await createTenantWithAdmin(services);

      const users = await services.withOrigin(origin).tenants.getTenantUsers(tenantId);

      expect(users.length).toBeGreaterThan(0);
      users.forEach((tenantUser) => expect(tenantUser.user).not.toHaveProperty('passwordHash'));
    });

    it('should check tenant membership', async () => {
      const { userId, tenantId, origin } = await createTenantWithAdmin(services);
      const nonMember = await createUser(db);

      expect(await services.withOrigin(origin).tenants.isTenantUser(tenantId, userId)).toBe(true);
      expect(await services.withOrigin(origin).tenants.isTenantUser(tenantId, nonMember.userId)).toBe(false);
    });
  });

  describe('tenant users list page', () => {
    it('should carry the tenant profile, the groups and the roles they grant, a role two groups share listed once', async () => {
      const { userId: adminId, tenantId, origin } = await createTenantWithAdmin(services);
      const scoped = services.withOrigin(origin);
      const member = await createUser(db);
      await scoped.tenants.addTenantUser(tenantId, member.userId);
      await scoped.tenants.updateTenantUserProfile(tenantId, member.userId, { name: 'Ada', title: 'Analyst' });
      const redId = uuidv7();
      const blueId = uuidv7();
      await scoped.groups.createGroup({ id: redId, name: 'Red team' });
      await scoped.groups.createGroup({ id: blueId, name: 'Blue team' });
      const readerId = uuidv7();
      await scoped.roles.createRole({ id: readerId, name: 'Reader' });
      await scoped.groups.addRoleToGroup(redId, readerId);
      await scoped.groups.addRoleToGroup(blueId, readerId);
      await scoped.groups.addUserToGroup(redId, member.userId);
      await scoped.groups.addUserToGroup(blueId, member.userId);

      const rows = await scoped.tenants.listTenantUsers(tenantId);

      expect(rows.map((row) => row.id).sort()).toEqual([adminId, member.userId].sort());
      expect(rows.find((row) => row.id === member.userId)).toEqual({
        id: member.userId,
        email: member.email,
        name: 'Ada',
        title: 'Analyst',
        isSuperAdmin: false,
        groups: [{ id: blueId, name: 'Blue team' }, { id: redId, name: 'Red team' }],
        roles: [{ id: readerId, name: 'Reader' }],
        hasSignedIn: false,
      });
    });

    it('should tell the members who signed in from those who never did, an invited person included', async () => {
      const { userId: adminId, tenantId, origin } = await createTenantWithAdmin(services);
      const member = await createTenantUser(services, db, origin);
      await db.execute(sql`UPDATE users SET last_signed_in_at = now() WHERE id = ${adminId}`);

      const rows = await services.withOrigin(origin).tenants.listTenantUsers(tenantId);

      expect(rows.find((row) => row.id === adminId)?.hasSignedIn).toBe(true);
      expect(rows.find((row) => row.id === member.userId)?.hasSignedIn).toBe(false);
    });

    it('should not list the members of another tenant', async () => {
      const { userId: adminId, tenantId, origin } = await createTenantWithAdmin(services);
      const tenantB = await createTenant(services, adminId);
      const outsider = await createUser(db);
      await services.withOrigin({ type: 'client', userId: adminId, tenantId: tenantB })
        .tenants.addTenantUser(tenantB, outsider.userId);

      const rows = await services.withOrigin(origin).tenants.listTenantUsers(tenantId);

      expect(rows.map((row) => row.id)).toEqual([adminId]);
    });

    it('should never nest the groups and roles of the origin\'s tenant under the members of another tenant', async () => {
      const { userId: adminId, origin } = await createTenantWithAdmin(services);
      const tenantB = await createTenant(services, adminId);
      const member = await createTenantUser(services, db, origin);
      await services.withOrigin({ type: 'client', userId: adminId, tenantId: tenantB }).tenants.addTenantUser(tenantB, member.userId);
      const scoped = services.withOrigin(origin);
      const groupId = uuidv7();
      const roleId = uuidv7();
      await scoped.groups.createGroup({ id: groupId, name: 'Tenant A group' });
      await scoped.roles.createRole({ id: roleId, name: 'Tenant A role' });
      await scoped.groups.addRoleToGroup(groupId, roleId);
      await scoped.groups.addUserToGroup(groupId, member.userId);

      const rows = await scoped.tenants.listTenantUsers(tenantB);

      const memberRow = rows.find((row) => row.id === member.userId);
      expect(memberRow).toMatchObject({ groups: [], roles: [] });
    });

    it('should list nothing for a client who is not a member of the tenant, even when its origin names that tenant', async () => {
      const { userId: adminId, origin } = await createTenantWithAdmin(services);
      const tenantB = await createTenant(services, adminId);
      const outsider = await createTenantUser(services, db, origin);
      await createTenantUser(services, db, { type: 'client', userId: adminId, tenantId: tenantB });

      const rows = await services.withOrigin({ type: 'client', userId: outsider.userId, tenantId: tenantB }).tenants.listTenantUsers(tenantB);

      expect(rows).toEqual([]);
    });
  });

  describe('tenant user profile', () => {
    it('should update and retrieve a tenant user profile', async () => {
      const { userId, tenantId, origin } = await createTenantWithAdmin(services);

      await services.withOrigin(origin).tenants.updateTenantUserProfile(tenantId, userId, {
        name: 'Tenant Display Name',
        title: 'Tenant Title',
      });

      const profile = await services.withOrigin(origin).tenants.getTenantUserProfile(tenantId, userId);
      expect(profile).toBeTruthy();
      expect(profile.name).toBe('Tenant Display Name');
      expect(profile.title).toBe('Tenant Title');
    });

    it('should allow clearing profile overrides with null', async () => {
      const { userId, tenantId, origin } = await createTenantWithAdmin(services);

      await services.withOrigin(origin).tenants.updateTenantUserProfile(tenantId, userId, {
        name: 'Override Name',
        title: 'Override Title',
      });
      await services.withOrigin(origin).tenants.updateTenantUserProfile(tenantId, userId, {
        name: null,
        title: null,
      });

      const profile = await services.withOrigin(origin).tenants.getTenantUserProfile(tenantId, userId);
      expect(profile).toBeTruthy();
      expect(profile.name).toBeNull();
      expect(profile.title).toBeNull();
    });

    it('should not affect the global user profile', async () => {
      const { userId, tenantId, origin } = await createTenantWithAdmin(services);

      // The global profile is XTM One's, written at each sign-in.
      await db.execute(sql`UPDATE users SET name = 'Global Name', title = 'Global Title' WHERE id = ${userId}`);

      // Set tenant-specific profile override
      await services.withOrigin(origin).tenants.updateTenantUserProfile(tenantId, userId, {
        name: 'Tenant Override Name',
        title: 'Tenant Override Title',
      });

      // Global profile should remain unchanged
      const globalUser = await services.withOrigin(origin).users.getUser(userId);
      expect(globalUser?.name).toBe('Global Name');
      expect(globalUser?.title).toBe('Global Title');

      // Tenant profile should have the override
      const tenantProfile = await services.withOrigin(origin).tenants.getTenantUserProfile(tenantId, userId);
      expect(tenantProfile.name).toBe('Tenant Override Name');
      expect(tenantProfile.title).toBe('Tenant Override Title');
    });

    it('should fail to update profile for a non-member', async () => {
      const { tenantId, origin } = await createTenantWithAdmin(services);
      const nonMember = await createUser(db);

      await expect(
        services.withOrigin(origin).tenants.updateTenantUserProfile(tenantId, nonMember.userId, {
          name: 'Should Fail',
        }),
      ).rejects.toThrow('could not be updated in this tenant');
    });

    describe('across tenants and members', () => {
      const setup = async () => {
        const { userId: adminId, tenantId: tenantA, origin: originA } = await createTenantWithAdmin(services);
        const tenantB = await createTenant(services, adminId);
        const originB: EventOrigin = { type: 'client', userId: adminId, tenantId: tenantB };
        const manager = await createTenantUser(services, db, originA);
        await grantCapability(services, originA, manager.userId, Capability_ManageSecurity);
        const memberOfB = await createTenantUser(services, db, originB);
        return { tenantA, tenantB, manager, memberOfB };
      };

      const profileOf = async (tenantId: string, userId: string) =>
        services.withOrigin({ type: 'system' }).tenants.getTenantUserProfile(tenantId, userId);

      it('should refuse a manager of tenant A editing a member of tenant B, and leave the profile unchanged', async () => {
        const { tenantA, tenantB, manager, memberOfB } = await setup();

        await expect(
          services.withOrigin({ type: 'client', userId: manager.userId, tenantId: tenantA })
            .tenants.updateTenantUserProfile(tenantB, memberOfB.userId, { name: 'Hijacked', title: 'Hijacked' }),
        ).rejects.toThrow('could not be updated in this tenant');

        expect(await profileOf(tenantB, memberOfB.userId)).toEqual({ name: null, title: null });
      });

      it('should refuse a manager of tenant A removing a member of tenant B, and keep the membership', async () => {
        const { tenantA, tenantB, manager, memberOfB } = await setup();

        await expect(
          services.withOrigin({ type: 'client', userId: manager.userId, tenantId: tenantA })
            .tenants.removeTenantUser(tenantB, memberOfB.userId),
        ).rejects.toThrow('could not be removed from this tenant');

        expect(await services.withOrigin({ type: 'system' }).tenants.isTenantUser(tenantB, memberOfB.userId)).toBe(true);
      });

      it('should refuse the same edit when the origin names tenant B without the caller belonging to it', async () => {
        const { tenantB, manager, memberOfB } = await setup();

        await expect(
          services.withOrigin({ type: 'client', userId: manager.userId, tenantId: tenantB })
            .tenants.updateTenantUserProfile(tenantB, memberOfB.userId, { name: 'Hijacked', title: 'Hijacked' }),
        ).rejects.toThrow('could not be updated in this tenant');

        expect(await profileOf(tenantB, memberOfB.userId)).toEqual({ name: null, title: null });
      });

      it('should refuse a plain member editing another member of their tenant', async () => {
        const { tenantId, origin } = await createTenantWithAdmin(services);
        const plainMember = await createTenantUser(services, db, origin);
        const other = await createTenantUser(services, db, origin);

        await expect(
          services.withOrigin(plainMember.origin).tenants.updateTenantUserProfile(tenantId, other.userId, { name: 'Hijacked' }),
        ).rejects.toThrow('could not be updated in this tenant');

        expect(await profileOf(tenantId, other.userId)).toEqual({ name: null, title: null });
      });

      it('should let a plain member edit their own profile', async () => {
        const { tenantId, origin } = await createTenantWithAdmin(services);
        const plainMember = await createTenantUser(services, db, origin);

        await services.withOrigin(plainMember.origin).tenants.updateTenantUserProfile(tenantId, plainMember.userId, { name: 'Me', title: 'Analyst' });

        expect(await profileOf(tenantId, plainMember.userId)).toEqual({ name: 'Me', title: 'Analyst' });
      });
    });

    it('should return undefined profile for a non-member', async () => {
      const { tenantId, origin } = await createTenantWithAdmin(services);
      const nonMember = await createUser(db);

      const profile = await services.withOrigin(origin).tenants.getTenantUserProfile(tenantId, nonMember.userId);
      expect(profile).toBeUndefined();
    });
  });
});
