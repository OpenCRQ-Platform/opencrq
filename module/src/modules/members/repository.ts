import { and, eq, exists, inArray, isNull, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { defineRepository } from '../../registry';
import { groupUsers } from '../groups/schema';
import { platformGroupUsers } from '../platform-groups/schema';
import { tenantUsers } from '../tenants/schema';
import { users } from '../users/schema';

const accountColumns = { id: users.id, email: users.email, xtmSubject: users.xtmSubject, isSuperAdmin: users.isSuperAdmin };

export type MemberAccount = { id: string, email: string, xtmSubject: string | null, isSuperAdmin: boolean };

const sameEmail = (email: string): SQL => eq(sql`lower(${users.email})`, email.toLowerCase());

type AccountColumns = { email: PgColumn, xtmSubject: PgColumn };

/** The accounts among these emails or XTM One ids, for the directory to mark those already in the scope. */
const accountsAmong = (columns: AccountColumns, emails: Array<string>, xtmSubjects: Array<string>): SQL | undefined => or(
  emails.length > 0 ? inArray(sql`lower(${columns.email})`, emails.map((email) => email.toLowerCase())) : undefined,
  xtmSubjects.length > 0 ? inArray(columns.xtmSubject, xtmSubjects) : undefined,
);

export const membersRepository = defineRepository({
  // The person is usually in none of the caller's tenants yet, so their account is looked up across all of them.
  findAccountByEmail: async ({ rawDb }, email: string): Promise<MemberAccount | null> => {
    // eslint-disable-next-line no-restricted-syntax -- an account is found whatever tenant it belongs to, if any
    const rows = await rawDb().select(accountColumns).from(users).where(sameEmail(email)).limit(1);
    return rows[0] ?? null;
  },
  findAccountByXtmSubject: async ({ rawDb }, xtmSubject: string): Promise<MemberAccount | null> => {
    // eslint-disable-next-line no-restricted-syntax -- an account is found whatever tenant it belongs to, if any
    const rows = await rawDb().select(accountColumns).from(users).where(eq(users.xtmSubject, xtmSubject)).limit(1);
    return rows[0] ?? null;
  },
  /** `false` when another account took the email or the XTM One id meanwhile. */
  insertAccount: async ({ db }, account: { id: string, email: string, xtmSubject: string | null, name: string | null }) =>
    (await db.insert(users).values(account).onConflictDoNothing().returning()).length > 0,
  /** On a pending account only, so one an XTM One user already took keeps its id: `false` when none was tied. */
  linkPendingAccount: async ({ rawDb }, userId: string, xtmSubject: string) => {
    // eslint-disable-next-line no-restricted-syntax -- the pending account is not the caller's own row, which the users policy alone lets a client update
    const linked = await rawDb().update(users).set({ xtmSubject }).where(and(eq(users.id, userId), isNull(users.xtmSubject))).returning({ id: users.id });
    return linked.length > 0;
  },
  findTenantName: async ({ db, views }, tenantId: string) => {
    const rows = await db.select({ name: views.tenants.name }).from(views.tenants).where(eq(views.tenants.id, tenantId)).limit(1);
    return rows[0]?.name ?? null;
  },
  countTenantGroups: async ({ db, views }, tenantId: string, groupIds: Array<string>) => (groupIds.length === 0
    ? 0
    : (await db.select({ id: views.groups.id }).from(views.groups)
      .where(and(eq(views.groups.tenantId, tenantId), inArray(views.groups.id, groupIds)))).length),
  findPlatformGroupNames: async ({ db, views }, platformGroupIds: Array<string>) => (platformGroupIds.length === 0
    ? []
    : (await db.select({ name: views.platformGroups.name }).from(views.platformGroups)
      .where(inArray(views.platformGroups.id, platformGroupIds))).map(({ name }) => name)),
  findActorName: async ({ rawDb }, userId: string) => {
    // eslint-disable-next-line no-restricted-syntax -- the caller's own row, which the tenant view hides from the super administrator, a member of no tenant
    const rows = await rawDb().select({ name: users.name, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    return rows[0] ? (rows[0].name ?? rows[0].email) : null;
  },
  addTenantMembership: async ({ db }, tenantId: string, userId: string) => {
    await db.insert(tenantUsers).values({ tenantId, userId }).onConflictDoNothing();
  },
  addGroupMemberships: async ({ db }, groupIds: Array<string>, userId: string) => {
    if (groupIds.length > 0) {
      await db.insert(groupUsers).values(groupIds.map((groupId) => ({ groupId, userId }))).onConflictDoNothing();
    }
  },
  addPlatformGroupMemberships: async ({ db }, platformGroupIds: Array<string>, userId: string) => {
    if (platformGroupIds.length > 0) {
      await db.insert(platformGroupUsers).values(platformGroupIds.map((platformGroupId) => ({ platformGroupId, userId }))).onConflictDoNothing();
    }
  },
  findTenantMembersAmong: async ({ db, views }, tenantId: string, emails: Array<string>, xtmSubjects: Array<string>): Promise<Array<MemberAccount>> => {
    const among = accountsAmong(views.users, emails, xtmSubjects);
    if (!among) {
      return [];
    }
    // The super administrator reaches every tenant with no membership, which the users read rule shows.
    return db.select({ id: views.users.id, email: views.users.email, xtmSubject: views.users.xtmSubject, isSuperAdmin: views.users.isSuperAdmin }).from(views.users)
      .where(and(among, or(
        eq(views.users.isSuperAdmin, true),
        exists(db.select({ userId: views.tenantUsers.userId }).from(views.tenantUsers)
          .where(and(eq(views.tenantUsers.tenantId, tenantId), eq(views.tenantUsers.userId, views.users.id)))),
      )));
  },
  /** Holding a platform group is what being a member of the platform means; the super administrator holds every right without one. */
  findPlatformMembersAmong: async ({ db, views }, emails: Array<string>, xtmSubjects: Array<string>): Promise<Array<MemberAccount>> => {
    const among = accountsAmong(views.users, emails, xtmSubjects);
    if (!among) {
      return [];
    }
    return db.select({ id: views.users.id, email: views.users.email, xtmSubject: views.users.xtmSubject, isSuperAdmin: views.users.isSuperAdmin }).from(views.users).where(and(among, or(
      eq(views.users.isSuperAdmin, true),
      exists(db.select({ userId: views.platformGroupUsers.userId }).from(views.platformGroupUsers).where(eq(views.platformGroupUsers.userId, views.users.id))),
    )));
  },
});
