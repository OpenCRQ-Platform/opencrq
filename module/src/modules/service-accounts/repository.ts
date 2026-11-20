import { and, eq, inArray } from 'drizzle-orm';
import { newError } from '@app/utils';
import { defineRepository } from '../../registry';
import { groupRoles } from '../schema';
import { orderByFolded } from '../../db/fold-text';
import { serviceAccountGroups, serviceAccounts } from './schema';

export const serviceAccountsRepository = defineRepository({
  findAllServiceAccounts: ({ db, views }) => db.select().from(views.serviceAccounts),
  findServiceAccountListRows: async ({ db, views }) => {
    const [rows, groups, roles] = await Promise.all([
      db.select({ id: views.serviceAccounts.id, name: views.serviceAccounts.name, active: views.serviceAccounts.active })
        .from(views.serviceAccounts),
      db.select({ serviceAccountId: views.serviceAccountGroups.serviceAccountId, id: views.groups.id, name: views.groups.name })
        .from(views.serviceAccountGroups)
        .innerJoin(views.groups, eq(views.serviceAccountGroups.groupId, views.groups.id))
        .orderBy(...orderByFolded(views.groups.nameFolded, views.groups.name, false)),
      db.select({ serviceAccountId: views.serviceAccountGroups.serviceAccountId, id: views.roles.id, name: views.roles.name })
        .from(views.serviceAccountGroups)
        .innerJoin(groupRoles, eq(views.serviceAccountGroups.groupId, groupRoles.groupId))
        .innerJoin(views.roles, eq(groupRoles.roleId, views.roles.id))
        .groupBy(views.serviceAccountGroups.serviceAccountId, views.roles.id, views.roles.name, views.roles.nameFolded)
        .orderBy(...orderByFolded(views.roles.nameFolded, views.roles.name, false)),
    ]);
    const groupsByAccount = Map.groupBy(groups, (group) => group.serviceAccountId);
    const rolesByAccount = Map.groupBy(roles, (role) => role.serviceAccountId);
    return rows.map((account) => ({
      ...account,
      groups: (groupsByAccount.get(account.id) ?? []).map(({ id, name }) => ({ id, name })),
      roles: (rolesByAccount.get(account.id) ?? []).map(({ id, name }) => ({ id, name })),
    }));
  },
  findServiceAccountNamesByIds: async ({ db, views }, ids: Array<string>) => {
    if (ids.length === 0) {
      return [];
    }
    return db
      .select({ id: views.serviceAccounts.id, name: views.serviceAccounts.name })
      .from(views.serviceAccounts)
      .where(inArray(views.serviceAccounts.id, ids));
  },
  findServiceAccountById: async ({ db, views }, id: string) => {
    const result = await db.select().from(views.serviceAccounts).where(eq(views.serviceAccounts.id, id)).limit(1);
    return result.length > 0 ? result[0] : undefined;
  },
  insertServiceAccount: ({ db }, serviceAccount: typeof serviceAccounts.$inferInsert) =>
    db.insert(serviceAccounts).values(serviceAccount),
  updateServiceAccount: ({ db }, id: string, values: Partial<typeof serviceAccounts.$inferInsert>) =>
    db.update(serviceAccounts).set(values).where(eq(serviceAccounts.id, id)),

  addServiceAccountGroup: async ({ db, views }, serviceAccountId: string, groupId: string) => {
    const [account, group] = await Promise.all([
      db.select({ id: views.serviceAccounts.id }).from(views.serviceAccounts).where(eq(views.serviceAccounts.id, serviceAccountId)).limit(1),
      db.select({ id: views.groups.id }).from(views.groups).where(eq(views.groups.id, groupId)).limit(1),
    ]);
    if (account.length === 0 || group.length === 0) {
      throw newError('Access Denied');
    }
    return db.insert(serviceAccountGroups).values({ serviceAccountId, groupId }).onConflictDoNothing();
  },
  removeServiceAccountGroup: async ({ db, views }, serviceAccountId: string, groupId: string) => {
    const [account, group] = await Promise.all([
      db.select({ id: views.serviceAccounts.id }).from(views.serviceAccounts).where(eq(views.serviceAccounts.id, serviceAccountId)).limit(1),
      db.select({ id: views.groups.id }).from(views.groups).where(eq(views.groups.id, groupId)).limit(1),
    ]);
    if (account.length === 0 || group.length === 0) {
      throw newError('Access Denied');
    }
    return db.delete(serviceAccountGroups).where(and(eq(serviceAccountGroups.serviceAccountId, serviceAccountId), eq(serviceAccountGroups.groupId, groupId)));
  },

  findServiceAccountRoles: async ({ db, views }, serviceAccountId: string) => db.selectDistinct({
    id: views.roles.id,
    name: views.roles.name,
    tenantId: views.roles.tenantId,
  })
    .from(views.serviceAccountGroups)
    .innerJoin(groupRoles, eq(views.serviceAccountGroups.groupId, groupRoles.groupId))
    .innerJoin(views.roles, eq(groupRoles.roleId, views.roles.id))
    .innerJoin(views.serviceAccounts, eq(views.serviceAccountGroups.serviceAccountId, views.serviceAccounts.id))
    .where(eq(views.serviceAccountGroups.serviceAccountId, serviceAccountId)),

  findServiceAccountGroups: async ({ db, views }, serviceAccountId: string) => db.select({
    group: {
      id: views.groups.id,
      name: views.groups.name,
      tenantId: views.groups.tenantId,
    },
  })
    .from(views.serviceAccountGroups)
    .innerJoin(views.groups, eq(views.serviceAccountGroups.groupId, views.groups.id))
    .innerJoin(views.serviceAccounts, eq(views.serviceAccountGroups.serviceAccountId, views.serviceAccounts.id))
    .where(eq(views.serviceAccountGroups.serviceAccountId, serviceAccountId)),

  findGroupServiceAccounts: async ({ db, views }, groupId: string) => db.select({
    serviceAccount: {
      id: views.serviceAccounts.id,
      name: views.serviceAccounts.name,
      tenantId: views.serviceAccounts.tenantId,
    },
  })
    .from(views.serviceAccountGroups)
    .innerJoin(views.serviceAccounts, eq(views.serviceAccountGroups.serviceAccountId, views.serviceAccounts.id))
    .where(eq(views.serviceAccountGroups.groupId, groupId)),
});
