import { authService, createServices } from '@app/module';
import type { XtmSignInError } from '@app/utils';
import type { DrizzleDB } from '@app/module';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import type { XtmOneSettings } from '../xtm-one/xtm-one-config';
import { COOKIE_OPTIONS, getSessionCookieName } from '../../trpc';
import { createLogger } from '../../utils/logger';
import { openSession, XTM_SESSION_DURATION_MS } from '../auth-service/open-session';
import { buildXtmOneHeaders } from '../xtm-one/xtm-one-headers';
import { getSignInClientId, isXtmSignInReady } from './xtm-sign-in-client';
import {
  authorizationUrl,
  CALLBACK_PATH,
  decideSignIn,
  decodeSignInFlow,
  encodeSignInFlow,
  exchangeCode,
  fetchXtmOneTitle,
  findLinkedAccount,
  getXtmDiscovery,
  newSignInFlow,
  safeRedirect,
  SIGN_IN_FLOW_TTL_SECONDS,
  SIGN_IN_PATH,
  verifyIdToken,
} from './xtm-sign-in';

const { logFromError, logWarn } = createLogger({ feature: 'xtm-sign-in' });

/**
 * One flow cookie per sign-in, named after its `state`: tabs signing in at the
 * same time (a restored session, several expired tabs) each keep their own.
 * `state` is base64url, safe in a cookie name.
 */
const flowCookieName = (state: string): string => `${getSessionCookieName()}::xtm_sign_in.${state.slice(0, 16)}`;
const STATE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

/** Lax, not the session cookie's None: XTM One sends the browser back with a top-level GET. */
const FLOW_COOKIE_OPTIONS = {
  path: CALLBACK_PATH,
  secure: COOKIE_OPTIONS.secure,
  httpOnly: true,
  sameSite: 'lax' as const,
  maxAge: SIGN_IN_FLOW_TTL_SECONDS,
};

/** The login page shows why a sign-in through XTM One did not go through, and signs in again to the page it was for. */
const backToLogin = (reply: FastifyReply, reason: XtmSignInError, redirect?: string): FastifyReply => {
  const query = new URLSearchParams({ xtm_sign_in_error: reason, ...(redirect ? { redirect } : {}) });
  return reply.redirect(`/login?${query.toString()}`);
};

// What XTM One said no to: a renewal it refuses must end the session it was renewing. Any other
// failure is transient, and the session it leaves runs to its end.
const REFUSALS: ReadonlySet<XtmSignInError> = new Set(['denied', 'conflict']);

const loginQuerySchema = z.object({
  redirect: z.string().optional(),
  on_platform_url: z.string().optional(),
});
const callbackQuerySchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  iss: z.string().optional(),
  error: z.string().optional(),
});

/**
 * `GET /api/auth/xtm/login` sends the browser to XTM One;
 * `GET /api/auth/xtm/callback` takes it back, verifies the ID token, applies
 * what XTM One says about the user and opens an OpenCRQ session.
 */
export const registerXtmSignInRoutes = (
  server: FastifyInstance,
  db: DrizzleDB,
  settings: XtmOneSettings,
  // Called once a session is opened, as the login form's router does (login telemetry).
  onSessionCreated?: () => void,
): void => {
  const auth = createServices([authService], db).withOrigin({ type: 'auth' }).auth;

  server.get(SIGN_IN_PATH, async (req, reply) => {
    const parsed = loginQuerySchema.safeParse(req.query);
    const query: z.infer<typeof loginQuerySchema> = parsed.success ? parsed.data : {};
    const landing = safeRedirect(query.redirect, settings.platformUrl);
    const unavailable = () => backToLogin(reply, 'unavailable', query.redirect ? landing : undefined);
    const clientId = getSignInClientId();
    if (!clientId || !(await isXtmSignInReady(settings.url))) {
      return unavailable();
    }
    try {
      // The flow cookie lands on this host, and XTM sends the browser back to the
      // platform URL's: start over there first (a DNS alias, 127.0.0.1 for
      // localhost). Once only: behind a proxy that rewrites the host this host
      // never matches, and the browser is on the platform URL by then anyway.
      if (req.host !== new URL(settings.platformUrl).host && query.on_platform_url !== '1') {
        const again = new URLSearchParams({ redirect: landing, on_platform_url: '1' });
        return reply.redirect(`${settings.platformUrl}${SIGN_IN_PATH}?${again.toString()}`);
      }
      const discovery = await getXtmDiscovery(settings);
      const flow = newSignInFlow(landing);
      reply.setCookie(flowCookieName(flow.state), encodeSignInFlow(flow), FLOW_COOKIE_OPTIONS);
      return reply.redirect(authorizationUrl(discovery, settings, clientId, flow));
    } catch (error) {
      logFromError(error, 'Sign-in with XTM One could not start');
      return unavailable();
    }
  });

  server.get(CALLBACK_PATH, async (req, reply) => {
    const query = callbackQuerySchema.safeParse(req.query);
    const state = query.success ? query.data.state : undefined;
    if (!query.success || !state || !STATE_PATTERN.test(state)) {
      return backToLogin(reply, 'expired');
    }
    const flow = decodeSignInFlow(req.cookies[flowCookieName(state)]);
    reply.clearCookie(flowCookieName(state), { path: CALLBACK_PATH });
    const clientId = getSignInClientId();
    if (!flow || !clientId || state !== flow.state) {
      return backToLogin(reply, 'expired');
    }
    // Past this point the browser started the flow itself, so a refusal may end the session it holds.
    const refuse = async (reason: XtmSignInError) => {
      const sessionId = req.cookies[getSessionCookieName()];
      if (sessionId && REFUSALS.has(reason)) {
        await auth.invalidateSession(sessionId);
        reply.clearCookie(getSessionCookieName());
      }
      return backToLogin(reply, reason, flow.redirect);
    };
    if (query.data.error || !query.data.code) {
      return refuse(query.data.error === 'access_denied' ? 'denied' : 'failed');
    }
    try {
      const discovery = await getXtmDiscovery(settings);
      // RFC 9207: the response names the issuer that sent it. XTM One always
      // does, and says so in its discovery, so a response without it is refused.
      if (query.data.iss !== discovery.issuer) {
        return refuse('failed');
      }
      const idToken = await exchangeCode(discovery, settings, clientId, query.data.code, flow);
      const claims = await verifyIdToken(idToken, discovery, settings, clientId, flow);

      const linkedUserId = await findLinkedAccount(auth, claims);
      // Past a pending account, the email only matters to an XTM One user OpenCRQ does not know yet.
      const emailTaken = linkedUserId ? false : await auth.isEmailTaken(claims.email);
      const decision = decideSignIn({ linkedUserId, emailTaken });
      if (decision.action === 'refuse') {
        // A warning, not a trace: what a takeover attempt looks like, for operators to see.
        logWarn('Sign-in with XTM One refused: email of another account', { sub: claims.sub });
        return refuse(decision.reason);
      }
      const accountId = decision.action === 'sign-in' ? decision.userId : uuidv7();
      const title = claims.title !== undefined
        ? claims.title
        : await fetchXtmOneTitle(settings, await buildXtmOneHeaders(settings, db, { id: accountId, email: claims.email, name: claims.name }));
      const userId = decision.action === 'create'
        ? await auth.createXtmAccount({ id: accountId, xtmSubject: claims.sub, email: claims.email, name: claims.name ?? null, title: title ?? null })
        : accountId;
      if (!userId) {
        logWarn('Sign-in with XTM One refused: email of another account', { sub: claims.sub });
        return refuse('conflict');
      }
      await auth.applyXtmSignIn(userId, claims.email, { name: claims.name, title, isSuperAdmin: claims.superAdmin });

      // A renewal replaces the session it renews, which would otherwise stay valid beside it.
      const renewedSessionId = req.cookies[getSessionCookieName()];
      if (renewedSessionId) {
        await auth.invalidateSession(renewedSessionId);
      }
      const { sessionId, expiresAt } = await openSession(auth, userId, onSessionCreated, XTM_SESSION_DURATION_MS);
      reply.setCookie(getSessionCookieName(), sessionId, { ...COOKIE_OPTIONS, expires: expiresAt });
      // Checked again here: the flow cookie is this browser's, not necessarily what this platform wrote.
      return reply.redirect(safeRedirect(flow.redirect, settings.platformUrl));
    } catch (error) {
      logFromError(error, 'Sign-in with XTM One failed');
      return refuse('failed');
    }
  });
};
