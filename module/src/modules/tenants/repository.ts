import { newError, withTransactionLock } from '@app/utils';
import { and, count, eq, inArray } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { Transaction } from '../../db';
import type { SupportedLocale } from '../users/validation';
import { defineRepository } from '../../registry';
import { businessValueCategories } from '../business-value-categories/schema';
import {
  buildApplicableTechniqueRows,
  buildAttackSurfaceRows,
  toAttackSurfaceIdByCategory,
} from '../attack-surfaces/data/applicable-techniques-seed';
import { attackSurfaceMitreTechniques, attackSurfaces } from '../attack-surfaces/schema';
import { buildCountryRows } from '../countries/data';
import { countries } from '../countries/schema';
import { buildSectorRows } from '../sectors/data';
import { sectors } from '../sectors/schema';
import { CAPABILITIES } from '../capabilities';
import { groupRoles, groups, groupUsers } from '../groups';
import { buildLossActivationRows, buildLossCategoryRows, buildLossDriverRows } from '../loss-drivers/data';
import { lossCategories, lossDriverActivations, lossDrivers } from '../loss-drivers/schema';
import { roleCapabilities, roles } from '../roles';
import { buildAttackOutcomeRows, buildAttackOutcomeTechniqueRows } from '../attack-outcomes/data';
import { attackOutcomeMitreTechniques, attackOutcomes } from '../attack-outcomes/schema';
import { buildBusinessValueCategoryRows } from '../business-value-categories/data';
import { defaultThreatsSettings } from '../default-threats/schema';
import { ONBOARDING_RISK_SCOPE_NAME } from '../onboarding-wizards/constants';
import { onboardingWizards } from '../onboarding-wizards/schema';
import { organizations } from '../organizations/schema';
import { treatmentPlans } from '../treatment-plans/schema';
import { users } from '../users/schema';
import { budgetReviews } from '../budget-reviews/schema';
import { orderByFolded } from '../../db/fold-text';
import { tenants, tenantUsers } from './schema';

export interface CreateTenantOptions {
  /** Gives the tenant its first risk scope, the Get started wizard of that scope and the OpenCRQ threat set switched off. */
  readonly provisionOnboarding: boolean,
}

/** Inserts a tenant with its Admin role and group, its Connectors group and its reference data, and no member. Returns the Admin group id. */
const provisionTenant = async (tx: Transaction, tenant: typeof tenants.$inferInsert, options: CreateTenantOptions = { provisionOnboarding: false }): Promise<string> => {
  await tx.insert(tenants).values(tenant);

  const adminRoleId = uuidv7();
  await tx.insert(roles).values({ id: adminRoleId, name: 'Admin', tenantId: tenant.id });
  await tx.insert(roleCapabilities).values(CAPABILITIES.map((capability) => ({ roleId: adminRoleId, capabilityId: capability.id })));

  const adminGroupId = uuidv7();
  await tx.insert(groups).values({ id: adminGroupId, name: 'Admin', slug: 'admin', tenantId: tenant.id });
  await tx.insert(groupRoles).values({ groupId: adminGroupId, roleId: adminRoleId });

  // Every tenant gets a Connectors group for service account automation
  await tx.insert(groups).values({ id: uuidv7(), name: 'Connectors', slug: 'connectors', tenantId: tenant.id });

  const surfaceRows = buildAttackSurfaceRows(tenant.id);
  await tx.insert(attackSurfaces).values(surfaceRows).onConflictDoNothing();
  const applicableTechniqueRows = buildApplicableTechniqueRows(toAttackSurfaceIdByCategory(surfaceRows));
  if (applicableTechniqueRows.length > 0) {
    await tx.insert(attackSurfaceMitreTechniques).values(applicableTechniqueRows).onConflictDoNothing();
  }

  const GEO_CHUNK_SIZE = 1000;
  const countryRows = buildCountryRows(tenant.id);
  for (let i = 0; i < countryRows.length; i += GEO_CHUNK_SIZE) {
    await tx.insert(countries).values(countryRows.slice(i, i + GEO_CHUNK_SIZE)).onConflictDoNothing();
  }
  const sectorRows = buildSectorRows(tenant.id);
  await tx.insert(sectors).values(sectorRows).onConflictDoNothing();

  // Loss model: closed reference catalogs, rows keyed by an id derived from the catalog entry.
  // The seeder reprovisions these on every boot; the tenant bootstrap only needs them to exist.
  await tx.insert(attackOutcomes).values(buildAttackOutcomeRows(tenant.id)).onConflictDoNothing();
  await tx.insert(businessValueCategories).values(buildBusinessValueCategoryRows(tenant.id)).onConflictDoNothing();
  await tx.insert(lossCategories).values(buildLossCategoryRows(tenant.id)).onConflictDoNothing();
  await tx.insert(lossDrivers).values(buildLossDriverRows(tenant.id)).onConflictDoNothing();
  // Depends on all three catalogs above, so it comes last.
  await tx.insert(lossDriverActivations).values(buildLossActivationRows(tenant.id)).onConflictDoNothing();

  if (options.provisionOnboarding) {
    const organizationId = uuidv7();
    await tx.insert(organizations).values({ id: organizationId, tenantId: tenant.id, name: ONBOARDING_RISK_SCOPE_NAME });
    await tx.insert(onboardingWizards).values({ id: uuidv7(), tenantId: tenant.id, organizationId });
    // Loading the OpenCRQ threat set is a Get started action: the scheduler skips a tenant that switched it off.
    await tx.insert(defaultThreatsSettings).values({ id: uuidv7(), tenantId: tenant.id, enabled: false });
  }

  const outcomeTechniqueJunctions = buildAttackOutcomeTechniqueRows(tenant.id);
  if (outcomeTechniqueJunctions.length > 0) {
    await tx.insert(attackOutcomeMitreTechniques).values(outcomeTechniqueJunctions).onConflictDoNothing();
  }
  return adminGroupId;
};

export const tenantsRepository = defineRepository({
  findAllTenants: ({ db, views }) => db.select().from(views.tenants),
  findAllTenantsWithMemberCount: async ({ db, views }) => {
    const allTenants = await db.select().from(views.tenants);
    if (allTenants.length === 0) {
      return [];
    }
    // A MANAGE_USERS holder's view spans every tenant: bound the aggregate to the visible ones.
    const memberCounts = await db.select({
      tenantId: views.tenantUsers.tenantId,
      memberCount: count(views.tenantUsers.userId),
    }).from(views.tenantUsers)
      .where(inArray(views.tenantUsers.tenantId, allTenants.map((tenant) => tenant.id)))
      .groupBy(views.tenantUsers.tenantId);
    const memberCountByTenantId = new Map(memberCounts.map(({ tenantId, memberCount }) => [tenantId, memberCount]));
    return allTenants.map((tenant) => ({
      ...tenant,
      memberCount: memberCountByTenantId.get(tenant.id) ?? 0,
    }));
  },
  findTenantById: async ({ db, views }, id: string) => {
    const result = await db.select().from(views.tenants).where(eq(views.tenants.id, id)).limit(1);
    return result[0];
  },
  updateDefaultLocale: ({ db }, tenantId: string, defaultLocale: SupportedLocale | null) =>
    db.update(tenants).set({ defaultLocale }).where(eq(tenants.id, tenantId)),
  renameTenant: async ({ db }, id: string, name: string): Promise<boolean> => {
    const renamed = await db.update(tenants).set({ name }).where(eq(tenants.id, id)).returning();
    return renamed.length > 0;
  },
  // eslint-disable-next-line no-restricted-syntax -- tenant bootstrap: atomic creation of tenant + admin role/group + seed data in a single locked transaction
  createTenantWithAdmin: async ({ rawDb }, tenant: typeof tenants.$inferInsert, creatorUserId: string, options: CreateTenantOptions = { provisionOnboarding: false }) => withTransactionLock(rawDb(), `createTenant_${tenant.id}`, async (tx) => {
    const adminGroupId = await provisionTenant(tx, tenant, options);
    // The super administrator reaches every tenant without a membership, and is listed in none.
    // eslint-disable-next-line app/no-raw-table-in-reads -- the bootstrap transaction is on the raw handle, which has no views; it reads the creator only
    const [creator] = await tx.select({ isSuperAdmin: users.isSuperAdmin }).from(users).where(eq(users.id, creatorUserId));
    if (!creator?.isSuperAdmin) {
      await tx.insert(tenantUsers).values({ tenantId: tenant.id, userId: creatorUserId });
      await tx.insert(groupUsers).values({ groupId: adminGroupId, userId: creatorUserId });
    }
  }),
  // eslint-disable-next-line no-restricted-syntax -- tenant bootstrap: the existence check and the creation share one locked transaction
  createInitialTenantIfNone: async ({ rawDb }, tenant: { id: string, name: string }, options: CreateTenantOptions = { provisionOnboarding: false }): Promise<boolean> => withTransactionLock(rawDb(), 'createInitialTenant', async (tx) => {
    // eslint-disable-next-line app/no-raw-table-in-reads -- the check must see every tenant, whatever the origin
    const existing = await tx.select({ id: tenants.id }).from(tenants).limit(1);
    if (existing.length > 0) {
      return false;
    }
    await provisionTenant(tx, tenant, options);
    return true;
  }),
  // Treatment plans and budget reviews reach their tenant only through an organization FK that
  // does not cascade, so the tenant's own cascade cannot take them.
  // Returns false when a membership removed concurrently spared a tenant whose children are
  // already purged, which the caller must roll back.
  deleteTenants: async ({ db, rawDb, views }, ids: Array<string>): Promise<boolean> => {
    const deletableIds = (await db.select({ id: views.tenants.id }).from(views.tenants).where(inArray(views.tenants.id, ids)))
      .map((tenant) => tenant.id);
    if (deletableIds.length === 0) {
      return true;
    }
    // eslint-disable-next-line no-restricted-syntax -- the organization-scoped policies refuse every platform origin, and the caller's membership of each tenant was proved just above
    const raw = rawDb();
    // eslint-disable-next-line app/no-raw-table-in-reads -- views.organizations is empty for a platform origin
    const scopeIds = raw.select({ id: organizations.id }).from(organizations).where(inArray(organizations.tenantId, deletableIds));
    await raw.delete(treatmentPlans).where(inArray(treatmentPlans.organizationId, scopeIds));
    await raw.delete(budgetReviews).where(inArray(budgetReviews.organizationId, scopeIds));
    const deleted = await db.delete(tenants).where(inArray(tenants.id, deletableIds)).returning();
    return deleted.length === deletableIds.length;
  },
  addTenantUser: async ({ db }, tenantId: string, userId: string) => {
    await db.insert(tenantUsers).values({ tenantId, userId });
  },
  removeTenantUser: async ({ db, rawDb }, tenantId: string, userId: string) => {
    // Deleted first: it waits for a concurrent grant's lock on this row, so the `group_users`
    // delete below runs on a fresh snapshot that sees that grant.
    const removed = await db.delete(tenantUsers)
      .where(and(eq(tenantUsers.tenantId, tenantId), eq(tenantUsers.userId, userId)))
      .returning();
    // A policy-filtered delete touches no row rather than failing.
    if (removed.length === 0) {
      throw newError('The member could not be removed from this tenant', { tenantId, userId });
    }
    // eslint-disable-next-line no-restricted-syntax -- the groups of the tenant being left are read whatever the caller's own group visibility
    const tenantGroupIds = rawDb().select({ id: groups.id }).from(groups).where(eq(groups.tenantId, tenantId));
    await db.delete(groupUsers).where(and(eq(groupUsers.userId, userId), inArray(groupUsers.groupId, tenantGroupIds)));
    // The delete is policy-filtered: a caller it filters out fails here rather than leaving the
    // grants to revive when the member is added again.
    const [{ remaining }] = await db.select({ remaining: count() }).from(groupUsers)
      .where(and(eq(groupUsers.userId, userId), inArray(groupUsers.groupId, tenantGroupIds)));
    if (remaining > 0) {
      throw newError('The member\'s group memberships of this tenant could not be removed', { tenantId, userId });
    }
  },
  getTenantUsers: ({ db, views }, tenantId: string) => db.select({
    tenantId: views.tenantUsers.tenantId,
    userId: views.tenantUsers.userId,
    tenantName: views.tenantUsers.name,
    tenantTitle: views.tenantUsers.title,
    user: {
      id: views.users.id,
      email: views.users.email,
      name: views.users.name,
      title: views.users.title,
      locale: views.users.locale,
      theme: views.users.theme,
    },
  })
    .from(views.tenantUsers)
    .innerJoin(views.users, eq(views.tenantUsers.userId, views.users.id))
    .where(eq(views.tenantUsers.tenantId, tenantId)),
  findTenantUserListRows: async ({ db, views }, tenantId: string) => {
    const [rows, superAdministrators, userGroups, userRoles] = await Promise.all([
      db.select({
        id: views.tenantUsers.userId,
        email: views.users.email,
        tenantName: views.tenantUsers.name,
        tenantTitle: views.tenantUsers.title,
        userName: views.users.name,
        userTitle: views.users.title,
        lastSignedInAt: views.users.lastSignedInAt,
      })
        .from(views.tenantUsers)
        .innerJoin(views.users, eq(views.tenantUsers.userId, views.users.id))
        .where(eq(views.tenantUsers.tenantId, tenantId)),
      // Listed in every tenant with no membership, which the users read rule shows.
      db.select({ id: views.users.id, email: views.users.email, name: views.users.name, title: views.users.title, lastSignedInAt: views.users.lastSignedInAt })
        .from(views.users)
        .where(eq(views.users.isSuperAdmin, true)),
      db.select({ userId: groupUsers.userId, id: views.groups.id, name: views.groups.name })
        .from(groupUsers)
        .innerJoin(views.groups, eq(groupUsers.groupId, views.groups.id))
        .where(eq(views.groups.tenantId, tenantId))
        .orderBy(...orderByFolded(views.groups.nameFolded, views.groups.name, false)),
      db.select({ userId: groupUsers.userId, id: views.roles.id, name: views.roles.name })
        .from(groupUsers)
        .innerJoin(groupRoles, eq(groupUsers.groupId, groupRoles.groupId))
        .innerJoin(views.roles, eq(groupRoles.roleId, views.roles.id))
        .where(eq(views.roles.tenantId, tenantId))
        .groupBy(groupUsers.userId, views.roles.id, views.roles.name, views.roles.nameFolded)
        .orderBy(...orderByFolded(views.roles.nameFolded, views.roles.name, false)),
    ]);
    const groupsByUser = Map.groupBy(userGroups, (group) => group.userId);
    const rolesByUser = Map.groupBy(userRoles, (role) => role.userId);
    const superAdministratorIds = new Set(superAdministrators.map(({ id }) => id));
    const memberIds = new Set(rows.map(({ id }) => id));
    return [
      ...rows.map((row) => ({
        id: row.id,
        email: row.email,
        name: row.tenantName ?? row.userName,
        title: row.tenantTitle ?? row.userTitle,
        isSuperAdmin: superAdministratorIds.has(row.id),
        groups: (groupsByUser.get(row.id) ?? []).map(({ id, name }) => ({ id, name })),
        roles: (rolesByUser.get(row.id) ?? []).map(({ id, name }) => ({ id, name })),
        hasSignedIn: row.lastSignedInAt !== null,
      })),
      ...superAdministrators.filter(({ id }) => !memberIds.has(id)).map(({ lastSignedInAt, ...user }) => ({
        ...user,
        isSuperAdmin: true,
        groups: [],
        roles: [],
        hasSignedIn: lastSignedInAt !== null,
      })),
    ];
  },
  getTenantUserNamesByIds: async ({ db, views }, tenantId: string, ids: Array<string>) => {
    if (ids.length === 0) {
      return [];
    }
    const rows = await db.select({
      userId: views.tenantUsers.userId,
      name: views.users.name,
      email: views.users.email,
    })
      .from(views.tenantUsers)
      .innerJoin(views.users, eq(views.tenantUsers.userId, views.users.id))
      .where(and(eq(views.tenantUsers.tenantId, tenantId), inArray(views.tenantUsers.userId, ids)));
    // A super administrator writes in every tenant as a member of none.
    const superAdministrators = await db.select({ userId: views.users.id, name: views.users.name, email: views.users.email })
      .from(views.users)
      .where(and(eq(views.users.isSuperAdmin, true), inArray(views.users.id, ids)));
    const members = new Set(rows.map(({ userId }) => userId));
    return [...rows, ...superAdministrators.filter(({ userId }) => !members.has(userId))]
      .map((row) => ({ id: row.userId, name: row.name || row.email }));
  },
  getTenantUserProfile: async ({ db, views }, tenantId: string, userId: string) => {
    const result = await db.select({
      name: views.tenantUsers.name,
      title: views.tenantUsers.title,
    }).from(views.tenantUsers)
      .where(and(eq(views.tenantUsers.tenantId, tenantId), eq(views.tenantUsers.userId, userId)))
      .limit(1);
    return result[0] ?? undefined;
  },
  updateTenantUserProfile: async ({ db }, tenantId: string, userId: string, data: { name?: string | null, title?: string | null }) => {
    const updated = await db.update(tenantUsers)
      .set(data)
      .where(and(eq(tenantUsers.tenantId, tenantId), eq(tenantUsers.userId, userId)))
      .returning();
    // Also empty when the update policy filtered the row out.
    if (updated.length === 0) {
      throw newError('The member\'s profile could not be updated in this tenant', { tenantId, userId });
    }
  },
  isTenantUser: async ({ db, views }, tenantId: string, userId: string) => {
    const result = await db.select().from(views.tenantUsers).where(and(eq(views.tenantUsers.tenantId, tenantId), eq(views.tenantUsers.userId, userId))).limit(1);
    return result.length > 0;
  },
});
