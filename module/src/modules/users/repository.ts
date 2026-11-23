import { compareText } from '@app/utils/text-fold';
import { eq } from 'drizzle-orm';
import type { SupportedLocale } from './validation';
import { defineRepository } from '../../registry';
import { orderByFolded } from '../../db/fold-text';
import { users } from './schema';

const themeValues = ['light', 'dark', 'system'] as const;
type Theme = typeof themeValues[number];
const isTheme = (value: string): value is Theme => themeValues.some((v) => v === value);
const toTheme = (value: string | null | undefined): Theme | undefined =>
  value != null && isTheme(value) ? value : undefined;

export const usersRepository = defineRepository({
  findAllUsers: ({ db, views }) => db.select().from(views.users),
  findPlatformUserListRows: async ({ db, views }) => {
    const [rows, groups, roles, memberships] = await Promise.all([
      db.select({ id: views.users.id, email: views.users.email, name: views.users.name, title: views.users.title, isSuperAdmin: views.users.isSuperAdmin })
        .from(views.users),
      db.select({ userId: views.platformGroupUsers.userId, id: views.platformGroups.id, name: views.platformGroups.name })
        .from(views.platformGroupUsers)
        .innerJoin(views.platformGroups, eq(views.platformGroupUsers.platformGroupId, views.platformGroups.id))
        .orderBy(...orderByFolded(views.platformGroups.nameFolded, views.platformGroups.name, false)),
      db.select({ userId: views.platformGroupUsers.userId, id: views.platformRoles.id, name: views.platformRoles.name })
        .from(views.platformGroupUsers)
        .innerJoin(views.platformGroupRoles, eq(views.platformGroupUsers.platformGroupId, views.platformGroupRoles.platformGroupId))
        .innerJoin(views.platformRoles, eq(views.platformGroupRoles.platformRoleId, views.platformRoles.id))
        .groupBy(views.platformGroupUsers.userId, views.platformRoles.id, views.platformRoles.name, views.platformRoles.nameFolded)
        .orderBy(...orderByFolded(views.platformRoles.nameFolded, views.platformRoles.name, false)),
      // The tenants the caller sees, so a name is never shown to someone who could not open it.
      db.select({ userId: views.tenantUsers.userId, id: views.tenants.id, name: views.tenants.name })
        .from(views.tenantUsers)
        .innerJoin(views.tenants, eq(views.tenantUsers.tenantId, views.tenants.id)),
    ]);
    const groupsByUser = Map.groupBy(groups, (group) => group.userId);
    const rolesByUser = Map.groupBy(roles, (role) => role.userId);
    const tenantsByUser = Map.groupBy(memberships, (membership) => membership.userId);
    return rows.map((user) => ({
      ...user,
      platformGroups: (groupsByUser.get(user.id) ?? []).map(({ id, name }) => ({ id, name })),
      platformRoles: (rolesByUser.get(user.id) ?? []).map(({ id, name }) => ({ id, name })),
      tenants: (tenantsByUser.get(user.id) ?? []).map(({ id, name }) => ({ id, name })).sort((first, second) => compareText(first.name, second.name)),
    }));
  },
  findUserById: async ({ db, views }, id: string) => {
    const user = await db.select().from(views.users).where(eq(views.users.id, id)).limit(1);
    return user.length > 0 ? user[0] : undefined;
  },
  getUserTheme: async ({ db, views }, id: string) => {
    if (!id) {
      return undefined;
    }
    const result = await db.select({ theme: views.users.theme }).from(views.users).where(eq(views.users.id, id)).limit(1);
    return toTheme(result?.[0]?.theme);
  },
  getUserPastelColours: async ({ db, views }, id: string) => {
    const result = await db.select({ pastelColours: views.users.pastelColours }).from(views.users).where(eq(views.users.id, id)).limit(1);
    return result[0]?.pastelColours ?? false;
  },
  getUserLocale: async ({ db, views }, id: string) => {
    if (!id) {
      return undefined;
    }
    const result = await db.select({ locale: views.users.locale }).from(views.users).where(eq(views.users.id, id)).limit(1);
    return result?.[0]?.locale ?? undefined;
  },
  getUserHomeDashboard: async ({ db, views }, id: string) => {
    const result = await db.select({ homeDashboardId: views.users.homeDashboardId }).from(views.users).where(eq(views.users.id, id)).limit(1);
    return result[0]?.homeDashboardId ?? undefined;
  },
  guardedDeleteUser: ({ db }, id: string) => db.delete(users).where(eq(users.id, id)),
  updateUser: ({ db }, id: string, data: { locale?: SupportedLocale | null, theme?: string, pastelColours?: boolean, homeDashboardId?: string | null }) =>
    db.update(users).set(data).where(eq(users.id, id)),
});
