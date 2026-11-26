import { uuidv7 } from 'uuidv7';
import type { XtmProfile } from './repository';
import { isUniqueViolationOf } from '../../db/pg-errors';
import { defineService } from '../../registry';
import { authRepository } from './repository';

const USERS_XTM_SUBJECT_UNIQUE = 'users_xtm_subject_unique';
const USERS_EMAIL_UNIQUE = 'users_email_unique';

export const authService = defineService(
  'auth',
  authRepository,
).implement({
  invalidateSession: ({ repo }, sessionId: string) => repo.invalidateSession(sessionId),
  // Cross-platform authentication (XTM One): the account of the XTM One user a verified JWT names (`sub`).
  getUserByXtmSubject: ({ repo }, subject: string) => repo.getUserByXtmSubject(subject),
  // Sign in with XTM One: an account is the XTM One user (`sub`) it is tied to.
  getUserIdByXtmSubject: ({ repo }, subject: string) => repo.getUserIdByXtmSubject(subject),
  isEmailTaken: ({ repo }, email: string) => repo.isEmailTaken(email),
  /**
   * The pending account holding this email, taken by the XTM One user signing in with it: `null`
   * when no pending account holds it, and for an XTM One user that already has an account.
   */
  linkPendingAccount: async ({ repo }, xtmSubject: string, email: string) => {
    try {
      return await repo.linkPendingAccount(xtmSubject, email);
    } catch (error) {
      if (isUniqueViolationOf(error, USERS_XTM_SUBJECT_UNIQUE)) {
        return null;
      }
      throw error;
    }
  },
  /**
   * The account of an XTM One user signing in for the first time, with no tenant and no password.
   * Two first sign-ins at once both end on the one account; `null` when another account took the
   * email meanwhile.
   */
  createXtmAccount: async ({ repo }, account: { id: string, xtmSubject: string, email: string, name: string | null, title: string | null }) => {
    try {
      await repo.insertXtmAccount(account);
      return account.id;
    } catch (error) {
      // A second creation for the same XTM One user can trip the email constraint first.
      if (isUniqueViolationOf(error, USERS_XTM_SUBJECT_UNIQUE) || isUniqueViolationOf(error, USERS_EMAIL_UNIQUE)) {
        return await repo.getUserIdByXtmSubject(account.xtmSubject);
      }
      throw error;
    }
  },
  /**
   * What every sign-in and renewal through XTM One applies: the super administrator status, set and
   * cleared, the profile, and the sign-in date. The email follows XTM One unless another account
   * holds it, in which case the sign-in still goes through on the old one.
   */
  applyXtmSignIn: async ({ repo }, userId: string, email: string, profile: XtmProfile) => {
    await repo.applyXtmProfile(userId, profile, new Date());
    try {
      await repo.updateEmailUnlessTaken(userId, email);
    } catch (error) {
      if (!isUniqueViolationOf(error, USERS_EMAIL_UNIQUE)) {
        throw error;
      }
    }
  },
  validateSession: ({ atomic }, sessionId: string) => atomic(async ({ repo }) => {
    const result = await repo.getSession(sessionId);
    if (!result) {
      return null;
    }
    const { user, session } = result;
    if (Date.now() >= session.expiresAt.getTime()) {
      await repo.invalidateSession(sessionId);
      return null;
    }
    return { user, session };
  }),
  createSession: async ({ repo }, userId: string, expiresAt: Date) => {
    const sessionId = uuidv7();
    await repo.createSession(sessionId, userId, expiresAt);
    return sessionId;
  },
  listActiveSessionIds: ({ repo }, sessionIds: ReadonlyArray<string>) => repo.getActiveSessionIds(sessionIds),
});
