import { and, count, eq } from 'drizzle-orm';
import { newError } from '@app/utils';
import { defineRepository } from '../../registry';
import { orderByFolded } from '../../db/fold-text';
import { groupRoles, groups, groupUsers } from './schema';

export const groupsRepository = defineRepository({
  findAllGroups: ({ db, views }) => db.select().from(views.groups),
  findGroupListRows: async ({ db, views }) => {
    const [rows, memberCounts, serviceAccountCounts, roles] = await Promise.all([
      db.select({ id: views.groups.id, name: views.groups.name }).from(views.groups),
      db.select({ groupId: groupUsers.groupId, count: count() })
        .from(groupUsers)
        .innerJoin(views.users, eq(groupUsers.userId, views.users.id))
        .innerJoin(views.groups, eq(groupUsers.groupId, views.groups.id))
        .groupBy(groupUsers.groupId),
      db.select({ groupId: views.serviceAccountGroups.groupId, count: count() })
        .from(views.serviceAccountGroups)
        .innerJoin(views.serviceAccounts, eq(views.serviceAccountGroups.serviceAccountId, views.serviceAccounts.id))
        .groupBy(views.serviceAccountGroups.groupId),
      db.select({ groupId: groupRoles.groupId, id: views.roles.id, name: views.roles.name })
        .from(groupRoles)
        .innerJoin(views.roles, eq(groupRoles.roleId, views.roles.id))
        .innerJoin(views.groups, eq(groupRoles.groupId, views.groups.id))
        .orderBy(...orderByFolded(views.roles.nameFolded, views.roles.name, false)),
    ]);
    const memberCountByGroup = new Map(memberCounts.map((row) => [row.groupId, row.count]));
    const serviceAccountCountByGroup = new Map(serviceAccountCounts.map((row) => [row.groupId, row.count]));
    const rolesByGroup = Map.groupBy(roles, (role) => role.groupId);
    return rows.map((group) => ({
      ...group,
      memberCount: memberCountByGroup.get(group.id) ?? 0,
      serviceAccountCount: serviceAccountCountByGroup.get(group.id) ?? 0,
      roles: (rolesByGroup.get(group.id) ?? []).map(({ id, name }) => ({ id, name })),
    }));
  },
  findGroupById: async ({ db, views }, id: string) => {
    const group = await db.select().from(views.groups).where(eq(views.groups.id, id)).limit(1);
    return group.length > 0 ? group[0] : undefined;
  },
  insertGroup: ({ db }, group: typeof groups.$inferInsert) => db.insert(groups).values(group),
  updateGroup: ({ db }, id: string, values: Partial<typeof groups.$inferInsert>) => db.update(groups).set(values).where(eq(groups.id, id)),
  deleteGroup: ({ db }, id: string) => db.delete(groups).where(eq(groups.id, id)),

  addGroupUser: async ({ db, views }, groupId: string, userId: string) => {
    const group = await db.select({ id: views.groups.id }).from(views.groups).where(eq(views.groups.id, groupId)).limit(1);
    if (group.length === 0) {
      throw newError('Access Denied');
    }
    return db.insert(groupUsers).values({ groupId, userId }).onConflictDoNothing();
  },
  removeGroupUser: async ({ db, views }, groupId: string, userId: string) => {
    const group = await db.select({ id: views.groups.id }).from(views.groups).where(eq(views.groups.id, groupId)).limit(1);
    if (group.length === 0) {
      throw newError('Access Denied');
    }
    return db.delete(groupUsers).where(and(eq(groupUsers.groupId, groupId), eq(groupUsers.userId, userId)));
  },

  findGroupUsers: async ({ db, views }, groupId: string) => db.select({
    user: {
      id: views.users.id,
      email: views.users.email,
      name: views.users.name,
    },
  })
    .from(groupUsers)
    .innerJoin(views.users, eq(groupUsers.userId, views.users.id))
    .innerJoin(views.groups, eq(groupUsers.groupId, views.groups.id))
    .where(eq(groupUsers.groupId, groupId)),

  addGroupRole: async ({ db, views }, groupId: string, roleId: string) => {
    const group = await db.select({ id: views.groups.id }).from(views.groups).where(eq(views.groups.id, groupId)).limit(1);
    if (group.length === 0) {
      throw newError('Access Denied');
    }
    return db.insert(groupRoles).values({ groupId, roleId }).onConflictDoNothing();
  },
  removeGroupRole: async ({ db, views }, groupId: string, roleId: string) => {
    const group = await db.select({ id: views.groups.id }).from(views.groups).where(eq(views.groups.id, groupId)).limit(1);
    if (group.length === 0) {
      throw newError('Access Denied');
    }
    return db.delete(groupRoles).where(and(eq(groupRoles.groupId, groupId), eq(groupRoles.roleId, roleId)));
  },

  findGroupRoles: async ({ db, views }, groupId: string) => db.select({
    role: {
      id: views.roles.id,
      name: views.roles.name,
      tenantId: views.roles.tenantId,
    },
  })
    .from(groupRoles)
    .innerJoin(views.roles, eq(groupRoles.roleId, views.roles.id))
    .innerJoin(views.groups, eq(groupRoles.groupId, views.groups.id))
    .where(eq(groupRoles.groupId, groupId)),

  findGroupsByUserId: async ({ db, views }, userId: string) => db.select({
    group: {
      id: views.groups.id,
      name: views.groups.name,
      tenantId: views.groups.tenantId,
    },
  })
    .from(groupUsers)
    .innerJoin(views.groups, eq(groupUsers.groupId, views.groups.id))
    .where(eq(groupUsers.userId, userId)),
});
