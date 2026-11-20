import { authService, createServices } from '@app/module';
import type { DrizzleDB } from '@app/module';

/** Synthetic session id marking XTM-One-JWT-authenticated requests. */
export const XTM_ONE_SESSION_ID = 'xtm-one-jwt';

const authServices = (db: DrizzleDB) => createServices([authService], db).withOrigin({ type: 'auth' });

export interface XtmOneAuthenticated {
  user: NonNullable<Awaited<ReturnType<ReturnType<typeof authServices>['auth']['getUserByXtmSubject']>>>,
  expiresAt: Date,
}

/** Quick shape check so non-JWT bearer tokens skip verification entirely. */
export const looksLikeJwt = (token: string): boolean => token.split('.').length === 3;

/**
 * Authenticate a bearer JWT minted by XTM One: verify signature/issuer/
 * audience against the XTM One JWKS, then resolve the local account of the
 * XTM One user it names (`sub`, the account's `xtm_subject`), never by its
 * `email`, which an XTM One user can change. Returns `null` when XTM One is
 * not configured, the token is not an XTM One token, or no account matches.
 *
 * The config/JWT modules are imported lazily: `trpc.ts` sits in the import
 * graph of config-free unit tests, and the platform config module parses
 * the process configuration at import time.
 */
export const authenticateXtmOneJwt = async (
  db: DrizzleDB,
  token: string,
): Promise<XtmOneAuthenticated | null> => {
  let settings;
  try {
    const { getXtmOneSettings } = await import('./xtm-one-config');
    settings = getXtmOneSettings();
  } catch {
    // config() throws outside a managed process (e.g. config-free test
    // contexts importing trpc.ts) - treat as "XTM One not configured" so
    // auth resolution degrades to the other schemes instead of a 500.
    return null;
  }
  if (!settings) {
    return null;
  }
  const { verifyXtmOneJwt } = await import('./xtm-one-jwt');
  let payload;
  try {
    payload = await verifyXtmOneJwt(settings, token);
  } catch {
    // Invalid signature / expired / wrong audience - not authenticated.
    return null;
  }
  if (!payload) {
    return null;
  }
  const subject = typeof payload.sub === 'string' ? payload.sub : '';
  if (!subject) {
    return null;
  }
  // `exp` is a required claim (enforced by verifyXtmOneJwt) - reject rather
  // than fall back if it is somehow absent, so a token can never
  // authenticate without a bounded lifetime.
  if (typeof payload.exp !== 'number') {
    return null;
  }
  const user = await authServices(db).auth.getUserByXtmSubject(subject);
  if (!user) {
    return null;
  }
  return { user, expiresAt: new Date(payload.exp * 1000) };
};
