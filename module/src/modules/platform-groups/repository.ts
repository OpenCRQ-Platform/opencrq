import { withTransactionLock } from '@app/utils';
import { and, count, eq } from 'drizzle-orm';
import { defineRepository } from '../../registry';
import { platformRoleCapabilities, platformRoles } from '../platform-roles';
import { DEFAULT_PLATFORM_ROLES } from '../platform-roles/data/default-platform-roles';
import { orderByFolded } from '../../db/fold-text';
import { DEFAULT_PLATFORM_GROUPS } from './data/default-platform-groups';
import { platformGroupRoles, platformGroups, platformGroupUsers } from './schema';

export const platformGroupsRepository = defineRepository({
  findAllPlatformGroups: ({ db, views }) => db.select().from(views.platformGroups),
  findPlatformGroupListRows: async ({ db, views }) => {
    const [rows, memberCounts, roles] = await Promise.all([
      db.select({ id: views.platformGroups.id, name: views.platformGroups.name }).from(views.platformGroups),
      db.select({ platformGroupId: views.platformGroupUsers.platformGroupId, count: count() })
        .from(views.platformGroupUsers)
        .innerJoin(views.users, eq(views.platformGroupUsers.userId, views.users.id))
        .groupBy(views.platformGroupUsers.platformGroupId),
      db.select({ platformGroupId: views.platformGroupRoles.platformGroupId, id: views.platformRoles.id, name: views.platformRoles.name })
        .from(views.platformGroupRoles)
        .innerJoin(views.platformRoles, eq(views.platformGroupRoles.platformRoleId, views.platformRoles.id))
        .orderBy(...orderByFolded(views.platformRoles.nameFolded, views.platformRoles.name, false)),
    ]);
    const memberCountByGroup = new Map(memberCounts.map((row) => [row.platformGroupId, row.count]));
    const rolesByGroup = Map.groupBy(roles, (role) => role.platformGroupId);
    return rows.map((group) => ({
      ...group,
      memberCount: memberCountByGroup.get(group.id) ?? 0,
      roles: (rolesByGroup.get(group.id) ?? []).map(({ id, name }) => ({ id, name })),
    }));
  },
  findPlatformGroupById: async ({ db, views }, id: string) => {
    const group = await db.select().from(views.platformGroups).where(eq(views.platformGroups.id, id)).limit(1);
    return group.length > 0 ? group[0] : undefined;
  },
  insertPlatformGroup: ({ db }, group: typeof platformGroups.$inferInsert) => db.insert(platformGroups).values(group),

  // eslint-disable-next-line no-restricted-syntax -- platform bootstrap: the emptiness check and the creation share one locked transaction
  createDefaultPlatformRolesAndGroupsIfNone: async ({ rawDb }): Promise<boolean> => withTransactionLock(rawDb(), 'createDefaultPlatformRolesAndGroups', async (tx) => {
    // eslint-disable-next-line app/no-raw-table-in-reads -- the check must see every platform role, whatever the origin
    const existingRoles = await tx.select({ id: platformRoles.id }).from(platformRoles).limit(1);
    // eslint-disable-next-line app/no-raw-table-in-reads -- the check must see every platform group, whatever the origin
    const existingGroups = await tx.select({ id: platformGroups.id }).from(platformGroups).limit(1);
    if (existingRoles.length > 0 || existingGroups.length > 0) {
      return false;
    }
    await tx.insert(platformRoles).values(DEFAULT_PLATFORM_ROLES.map(({ id, name }) => ({ id, name })));
    await tx.insert(platformRoleCapabilities).values(DEFAULT_PLATFORM_ROLES.flatMap((role) =>
      role.capabilityIds.map((capabilityId) => ({ platformRoleId: role.id, capabilityId }))));
    await tx.insert(platformGroups).values(DEFAULT_PLATFORM_GROUPS.map(({ id, name }) => ({ id, name })));
    await tx.insert(platformGroupRoles).values(DEFAULT_PLATFORM_GROUPS.flatMap((group) =>
      group.roleIds.map((platformRoleId) => ({ platformGroupId: group.id, platformRoleId }))));
    return true;
  }),

  updatePlatformGroup: ({ db }, id: string, values: Partial<typeof platformGroups.$inferInsert>) => db.update(platformGroups).set(values).where(eq(platformGroups.id, id)),
  guardedDeletePlatformGroup: ({ db }, id: string) => db.delete(platformGroups).where(eq(platformGroups.id, id)),

  addPlatformGroupUser: ({ db }, platformGroupId: string, userId: string) => db.insert(platformGroupUsers).values({ platformGroupId, userId }).onConflictDoNothing(),
  guardedRemovePlatformGroupUser: ({ db }, platformGroupId: string, userId: string) => db.delete(platformGroupUsers).where(and(eq(platformGroupUsers.platformGroupId, platformGroupId), eq(platformGroupUsers.userId, userId))),

  findPlatformGroupUsers: async ({ db, views }, platformGroupId: string) => db.select({
    user: {
      id: views.users.id,
      email: views.users.email,
      name: views.users.name,
    },
  })
    .from(views.platformGroupUsers)
    .innerJoin(views.users, eq(views.platformGroupUsers.userId, views.users.id))
    .where(eq(views.platformGroupUsers.platformGroupId, platformGroupId)),

  addPlatformGroupRole: ({ db }, platformGroupId: string, platformRoleId: string) => db.insert(platformGroupRoles).values({ platformGroupId, platformRoleId }).onConflictDoNothing(),
  guardedRemovePlatformGroupRole: ({ db }, platformGroupId: string, platformRoleId: string) => db.delete(platformGroupRoles).where(and(eq(platformGroupRoles.platformGroupId, platformGroupId), eq(platformGroupRoles.platformRoleId, platformRoleId))),

  findPlatformGroupRoles: async ({ db, views }, platformGroupId: string) => db.select({
    role: platformRoles,
  })
    .from(views.platformGroupRoles)
    .innerJoin(views.platformRoles, eq(views.platformGroupRoles.platformRoleId, views.platformRoles.id))
    .where(eq(views.platformGroupRoles.platformGroupId, platformGroupId)),

  findUserPlatformGroups: async ({ db, views }, userId: string) => db.select({
    group: platformGroups,
  })
    .from(views.platformGroupUsers)
    .innerJoin(views.platformGroups, eq(views.platformGroupUsers.platformGroupId, views.platformGroups.id))
    .where(eq(views.platformGroupUsers.userId, userId)),
});
