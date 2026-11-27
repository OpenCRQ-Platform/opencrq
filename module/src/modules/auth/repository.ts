import { and, eq, gt, inArray, isNull, ne, notExists, sql } from 'drizzle-orm';
import { defineGlobalRepository } from '../../registry';
import { users } from '../users';
import { sessions } from './schema';

// Authenticated-user projection: what flows into `req.authUser` (session cookies and XTM One JWTs
// alike), never a whole row.
const authUserColumns = {
  id: users.id,
  email: users.email,
  name: users.name,
  title: users.title,
  locale: users.locale,
  theme: users.theme,
  xtmSubject: users.xtmSubject,
};

/** What XTM One says about one of its users at a sign-in; `undefined` leaves the stored value as it is. */
export interface XtmProfile {
  name?: string | null,
  title?: string | null,
  isSuperAdmin: boolean,
}

export const authRepository = defineGlobalRepository({
  invalidateSession: async ({ db }, sessionId: string) => db.delete(sessions).where(eq(sessions.id, sessionId)),
  getUserByXtmSubject: async ({ db }, subject: string) => {
    const user = await db.select(authUserColumns).from(users).where(eq(users.xtmSubject, subject)).limit(1);
    return user.length > 0 ? user[0] : null;
  },
  getUserIdByXtmSubject: async ({ db }, subject: string) => {
    const user = await db.select({ id: users.id }).from(users).where(eq(users.xtmSubject, subject)).limit(1);
    return user.length > 0 ? user[0].id : null;
  },
  // Case-insensitive: XTM One stores emails lowercased, accounts here keep the case they were created with.
  isEmailTaken: async ({ db }, email: string) => {
    const holders = await db.select({ id: users.id }).from(users).where(eq(sql`lower(${users.email})`, email.toLowerCase())).limit(1);
    return holders.length > 0;
  },
  /**
   * One conditional update, so two sign-ins racing cannot both take the account: the pending
   * account (no XTM One id) whose email is the ID token's, whatever its case, takes the `sub`.
   */
  linkPendingAccount: async ({ db }, xtmSubject: string, email: string) => {
    const linked = await db.update(users)
      .set({ xtmSubject })
      .where(and(
        isNull(users.xtmSubject),
        eq(sql`lower(${users.email})`, email.toLowerCase()),
      ))
      .returning({ id: users.id });
    return linked[0]?.id ?? null;
  },
  insertXtmAccount: async ({ db }, account: { id: string, xtmSubject: string, email: string, name: string | null, title: string | null }) => {
    await db.insert(users).values(account);
  },
  applyXtmProfile: async ({ db }, userId: string, profile: XtmProfile, signedInAt: Date) => {
    await db.update(users)
      .set({
        isSuperAdmin: profile.isSuperAdmin,
        lastSignedInAt: signedInAt,
        ...(profile.name !== undefined && { name: profile.name }),
        ...(profile.title !== undefined && { title: profile.title }),
      })
      .where(eq(users.id, userId));
  },
  // Left unchanged while another account holds the email, whatever its case.
  updateEmailUnlessTaken: async ({ db }, userId: string, email: string) => {
    const others = db.select({ id: users.id }).from(users).where(and(
      eq(sql`lower(${users.email})`, email.toLowerCase()),
      ne(users.id, userId),
    ));
    await db.update(users)
      .set({ email })
      .where(and(eq(users.id, userId), ne(users.email, email), notExists(others)));
  },
  getSession: async ({ db }, sessionId: string) => {
    const result = await db
      .select({ user: authUserColumns, session: sessions })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(eq(sessions.id, sessionId))
      .limit(1);
    if (result.length < 1) {
      return null;
    } else {
      return result[0];
    }
  },
  createSession: async ({ db }, sessionId: string, userId: string, expiresAt: Date) => {
    await db.insert(sessions).values({ id: sessionId, userId, expiresAt });
  },
  getActiveSessionIds: async ({ db }, sessionIds: ReadonlyArray<string>) => {
    if (sessionIds.length === 0) {
      return [];
    }
    const rows = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(inArray(sessions.id, [...sessionIds]), gt(sessions.expiresAt, new Date())));
    return rows.map((row) => row.id);
  },
});
