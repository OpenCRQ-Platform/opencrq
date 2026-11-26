import { createHash, randomBytes } from 'node:crypto';
import { errors, jwtVerify } from 'jose';
import type { JWTPayload } from 'jose';
import { z } from 'zod';
import { newError } from '@app/utils';
import type { XtmOneSettings } from '../xtm-one/xtm-one-config';
import { isXtmOneIssuer } from '../xtm-one/xtm-one-identity';
import { remoteJwks } from '../xtm-one/xtm-one-jwt';

/**
 * Sign in with XTM One: this platform is an OpenID Connect relying party of
 * XTM One (authorization code, PKCE S256, `nonce`, public client). Kept free
 * of config and logger imports so it stays unit-testable.
 *
 * Public and internal URLs: XTM One advertises its public URL (`BASE_URL`) as
 * issuer and endpoints. The browser goes to the advertised authorization
 * endpoint; this platform's own calls (token, keys) go to the configured,
 * possibly internal, XTM One URL.
 */

export const SIGN_IN_PATH = '/api/auth/xtm/login';
export const CALLBACK_PATH = '/api/auth/xtm/callback';
/**
 * The XTM One user (`sub`), their email, their full name and title (`profile`), and `xtm_role`,
 * asked only because it is the scope carrying `xtm_super_admin`: the `xtm_role` claim itself gives
 * nothing here.
 */
export const SIGN_IN_SCOPE = 'openid email profile xtm_role';
/** The sign-in round trip must finish within this, or it starts over. */
export const SIGN_IN_FLOW_TTL_SECONDS = 10 * 60;

const DISCOVERY_TTL_MS = 60 * 60_000;
const FETCH_TIMEOUT_MS = 10_000;

export const callbackUrl = (settings: XtmOneSettings): string => `${settings.platformUrl}${CALLBACK_PATH}`;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Whether XTM One accepts this callback: HTTPS, or a loopback host. Any other
 * callback makes XTM One refuse the whole registration (entitlement included),
 * so it is never sent.
 */
export const isAcceptedCallback = (callback: string): boolean => {
  try {
    const url = new URL(callback);
    return url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname));
  } catch {
    return false;
  }
};

const discoverySchema = z.object({
  issuer: z.string(),
  authorization_endpoint: z.string(),
  token_endpoint: z.string(),
  jwks_uri: z.string(),
});

export type XtmDiscovery = z.infer<typeof discoverySchema>;

const discoveries = new Map<string, { value: XtmDiscovery, expiresAt: number }>();

/** An endpoint under the issuer, at a path boundary (not `https://xtm.example.com.evil.net`). */
const isUnderIssuer = (endpoint: string, issuer: string): boolean => endpoint.startsWith(`${issuer.replace(/\/+$/, '')}/`);

/**
 * XTM One's OpenID Connect discovery document, read on the configured URL and
 * cached for an hour. Refused when its issuer is not XTM One's identity, or
 * when an endpoint it names is not under that issuer: the code and the PKCE
 * verifier only ever go to XTM One.
 */
export const getXtmDiscovery = async (settings: XtmOneSettings): Promise<XtmDiscovery> => {
  const cached = discoveries.get(settings.url);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  const response = await fetch(`${settings.url}/.well-known/openid-configuration`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw newError('XTM One OpenID Connect discovery failed', { status: response.status });
  }
  const value = discoverySchema.parse(await response.json());
  if (!(await isXtmOneIssuer(settings, value.issuer))) {
    throw newError('XTM One OpenID Connect discovery names another issuer', { issuer: value.issuer });
  }
  if (!/^https?:\/\//.test(value.issuer)
    || !isUnderIssuer(value.authorization_endpoint, value.issuer)
    || !isUnderIssuer(value.token_endpoint, value.issuer)
    || !isUnderIssuer(value.jwks_uri, value.issuer)) {
    throw newError('XTM One OpenID Connect discovery names an endpoint outside its issuer', { issuer: value.issuer });
  }
  discoveries.set(settings.url, { value, expiresAt: Date.now() + DISCOVERY_TTL_MS });
  return value;
};

/** Test hook: forget the discovery documents read so far. */
export const resetXtmDiscoveries = (): void => {
  discoveries.clear();
};

/** An endpoint XTM One advertises on its public URL, moved onto the URL this platform reaches it on. */
export const onConfiguredUrl = (endpoint: string, discovery: XtmDiscovery, settings: XtmOneSettings): string => {
  const issuer = discovery.issuer.replace(/\/+$/, '');
  if (!isUnderIssuer(endpoint, issuer)) {
    throw newError('XTM One endpoint outside its issuer', { endpoint });
  }
  return `${settings.url}${endpoint.slice(issuer.length)}`;
};

export interface SignInFlow {
  state: string,
  nonce: string,
  verifier: string,
  /** Where to land once signed in: a path on this platform. */
  redirect: string,
}

const randomToken = (): string => randomBytes(32).toString('base64url');

export const newSignInFlow = (redirect: string): SignInFlow => ({
  state: randomToken(),
  nonce: randomToken(),
  verifier: randomToken(),
  redirect,
});

const flowSchema = z.object({
  state: z.string().min(1),
  nonce: z.string().min(1),
  verifier: z.string().min(1),
  redirect: z.string(),
});

/** The flow travels in a short-lived HttpOnly cookie: random values only this browser holds. */
export const encodeSignInFlow = (flow: SignInFlow): string => Buffer.from(JSON.stringify(flow)).toString('base64url');

export const decodeSignInFlow = (value: string | undefined): SignInFlow | null => {
  if (!value) {
    return null;
  }
  try {
    const parsed = flowSchema.safeParse(JSON.parse(Buffer.from(value, 'base64url').toString()));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

/**
 * Where to land after signing in: a path on this platform only. The request is
 * resolved against the platform URL, the way the browser will read it (tabs and
 * newlines dropped, a backslash read as `/`), and kept only on the platform origin and when
 * its path does not start with `//`; anything else lands on `/`.
 */
export const safeRedirect = (requested: string | undefined, platformUrl: string): string => {
  if (!requested) {
    return '/';
  }
  try {
    const platform = new URL(platformUrl);
    const target = new URL(requested, platform);
    const path = `${target.pathname}${target.search}${target.hash}`;
    return target.origin === platform.origin && !path.startsWith('//') ? path : '/';
  } catch {
    return '/';
  }
};

export const authorizationUrl = (
  discovery: XtmDiscovery,
  settings: XtmOneSettings,
  clientId: string,
  flow: SignInFlow,
): string => {
  const url = new URL(discovery.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: callbackUrl(settings),
    scope: SIGN_IN_SCOPE,
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: createHash('sha256').update(flow.verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }).toString();
  return url.href;
};

const tokenResponseSchema = z.object({ id_token: z.string() });

/** Exchange the code on XTM One's token endpoint (configured URL) for the ID token. */
export const exchangeCode = async (
  discovery: XtmDiscovery,
  settings: XtmOneSettings,
  clientId: string,
  code: string,
  flow: SignInFlow,
): Promise<string> => {
  const response = await fetch(onConfiguredUrl(discovery.token_endpoint, discovery, settings), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: callbackUrl(settings),
      client_id: clientId,
      code_verifier: flow.verifier,
    }),
    redirect: 'manual',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw newError('XTM One token endpoint refused the code', { status: response.status });
  }
  return tokenResponseSchema.parse(await response.json()).id_token;
};

export interface XtmSignInClaims {
  sub: string,
  email: string,
  /** `undefined` when XTM One did not send the claim, which leaves the stored value as it is. */
  name: string | null | undefined,
  /** `undefined` when XTM One did not send `xtm_title`: it is then read from `GET /api/v1/auth/me`. */
  title: string | null | undefined,
  /** True only on an explicit `xtm_super_admin: true`: an XTM One that does not send it designates nobody. */
  superAdmin: boolean,
}

const optionalText = z.string().nullable().optional().catch(undefined);

const claimsSchema = z.object({
  sub: z.string().min(1),
  email: z.email(),
  name: optionalText,
  xtm_title: optionalText,
  xtm_super_admin: z.unknown().optional(),
});

/** A blank value is no value: XTM One sends `""` for a full name never filled in. */
const textClaim = (value: string | null | undefined): string | null | undefined => (
  value === undefined ? undefined : (value?.trim() || null)
);

export const readSignInClaims = (payload: JWTPayload): XtmSignInClaims => {
  const claims = claimsSchema.parse(payload);
  return {
    sub: claims.sub,
    email: claims.email,
    name: textClaim(claims.name),
    title: 'xtm_title' in payload ? textClaim(claims.xtm_title) ?? null : undefined,
    superAdmin: claims.xtm_super_admin === true,
  };
};

/**
 * jose's claim errors carry the whole token (`payload`, the email included),
 * which the error log would write out: only what failed is kept.
 */
const withoutClaims = (error: unknown): unknown => (
  error instanceof errors.JWTClaimValidationFailed || error instanceof errors.JWTExpired
    ? newError('ID token refused', { code: error.code, claim: error.claim, reason: error.reason })
    : error
);

/**
 * Verify the ID token: EdDSA signature against the discovered keys (configured
 * URL), issuer = the discovered issuer, audience = this platform's client only
 * (OpenID Connect Core 3.1.3.7: no other audience, `azp` when sent is this
 * client too), `nonce` = this browser's flow.
 */
export const verifyIdToken = async (
  idToken: string,
  discovery: XtmDiscovery,
  settings: XtmOneSettings,
  clientId: string,
  flow: SignInFlow,
): Promise<XtmSignInClaims> => {
  const { payload } = await jwtVerify(idToken, remoteJwks(onConfiguredUrl(discovery.jwks_uri, discovery, settings)), {
    issuer: discovery.issuer,
    audience: clientId,
    algorithms: ['EdDSA'],
    requiredClaims: ['exp', 'iat', 'sub'],
  }).catch((error: unknown) => {
    throw withoutClaims(error);
  });
  const { aud, azp, nonce } = payload as JWTPayload & { azp?: unknown, nonce?: unknown };
  if ((Array.isArray(aud) && aud.length !== 1) || (azp !== undefined && azp !== clientId)) {
    throw newError('ID token not for this client alone');
  }
  if (nonce !== flow.nonce) {
    throw newError('ID token nonce does not match the sign-in flow');
  }
  return readSignInClaims(payload);
};

const meSchema = z.object({ title: z.string().nullable().optional() });

/**
 * The title XTM One holds, for an XTM One that does not send `xtm_title` yet, read on
 * `GET /api/v1/auth/me` as the user the per-user JWT in `headers` names. `undefined` when it cannot
 * be read: the sign-in goes on and the stored title stays.
 */
export const fetchXtmOneTitle = async (settings: XtmOneSettings, headers: Record<string, string>): Promise<string | null | undefined> => {
  try {
    const response = await fetch(`${settings.url}/api/v1/auth/me`, {
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      return undefined;
    }
    const me = meSchema.safeParse(await response.json());
    return me.success ? textClaim(me.data.title ?? null) : undefined;
  } catch {
    return undefined;
  }
};

export type SignInRefusal = 'conflict';

export type SignInDecision =
  | { action: 'sign-in', userId: string }
  | { action: 'create' }
  | { action: 'refuse', reason: SignInRefusal };

export interface LocalAccounts {
  /** The account of this XTM One user (`sub`), the pending account they just took included. */
  linkedUserId: string | null,
  /** Whether an account tied to another XTM One user holds the ID token's email, case-insensitive. */
  emailTaken: boolean,
}

export interface AccountLookups {
  getUserIdByXtmSubject: (xtmSubject: string) => Promise<string | null>,
  linkPendingAccount: (xtmSubject: string, email: string) => Promise<string | null>,
}

/**
 * The account of the XTM One user `sub`, else the pending account holding their email, which it
 * then holds. A pending account that links nothing is read again by `sub`: two first callbacks of
 * one person (two tabs) both find no account first, and the one that links second must find the
 * account the first linked.
 */
export const findLinkedAccount = async (
  auth: AccountLookups,
  claims: { sub: string, email: string },
): Promise<string | null> => (
  await auth.getUserIdByXtmSubject(claims.sub)
  ?? await auth.linkPendingAccount(claims.sub, claims.email)
  ?? await auth.getUserIdByXtmSubject(claims.sub)
);

/**
 * Who the verified XTM One user is here: the account tied to their `sub`. An XTM One user OpenCRQ
 * does not know gets an account, with access to nothing, unless their email belongs to an account
 * tied to another XTM One user.
 */
export const decideSignIn = ({ linkedUserId, emailTaken }: LocalAccounts): SignInDecision => {
  if (linkedUserId) {
    return { action: 'sign-in', userId: linkedUserId };
  }
  return emailTaken ? { action: 'refuse', reason: 'conflict' } : { action: 'create' };
};
