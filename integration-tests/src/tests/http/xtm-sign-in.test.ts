import cookie from '@fastify/cookie';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { recordSignInClientId } from '@app/back/src/features/xtm-sign-in/xtm-sign-in-client';
import { resetXtmOneAnswering } from '@app/back/src/features/xtm-sign-in/xtm-one-live-probe';
import { resetXtmOneIdentities } from '@app/back/src/features/xtm-one/xtm-one-identity';
import { encodeSignInFlow, resetXtmDiscoveries } from '@app/back/src/features/xtm-sign-in/xtm-sign-in';
import { registerXtmSignInRoutes } from '@app/back/src/features/xtm-sign-in/xtm-sign-in-routes';
import { getSessionCookieName } from '@app/back/src/trpc';
import type * as Logger from '@app/back/src/utils/logger';
import { sql } from 'drizzle-orm';
import { fastify } from 'fastify';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUser } from '../../helpers/factories';
import { db } from '../../setup/db';
import { truncateAllTables } from '../../setup/test-context';

// Spied: a refused takeover must leave a warning, for operators to see. The sign-in's own logger only.
const logWarn = vi.hoisted(() => vi.fn());
vi.mock('@app/back/src/utils/logger', async (importOriginal) => {
  const original = await importOriginal<typeof Logger>();
  return {
    ...original,
    createLogger: (...args: Parameters<typeof original.createLogger>) => {
      const logger = original.createLogger(...args);
      const [tags] = args;
      return tags && 'feature' in tags && tags.feature === 'xtm-sign-in' ? { ...logger, logWarn } : logger;
    },
  };
});

const CLIENT_ID = 'xtm-platform-opencrq';
const PLATFORM_URL = 'https://opencrq.test';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const publicJwk = publicKey.export({ format: 'jwk' });
const KID = createHash('sha256').update(String(publicJwk.x)).digest('base64url');

const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

/** An EdDSA ID token signed by the stand-in XTM One. */
const idToken = (issuer: string, claims: Record<string, unknown>): string => {
  const now = Math.floor(Date.now() / 1000);
  const signingInput = `${b64({ alg: 'EdDSA', kid: KID })}.${b64({ iss: issuer, aud: CLIENT_ID, iat: now, exp: now + 600, ...claims })}`;
  return `${signingInput}.${sign(null, Buffer.from(signingInput), privateKey).toString('base64url')}`;
};

/**
 * XTM One as OpenCRQ reaches it: identity, discovery, keys and the token endpoint, which answers
 * the ID token the test sets. A real socket, so OpenCRQ's own requests are what is exercised.
 */
const startXtmOne = async () => {
  let tokenAnswer: Record<string, unknown> = {};
  let meTitle: string | null = null;
  let discoveryAnswered = true;
  const meCalls: Array<string | undefined> = [];
  const server: Server = createServer((req, res) => {
    const json = (body: unknown, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const path = (req.url ?? '').split('?')[0];
    if (path === '/xtm/auth/metadata') {
      return json({ issuer });
    }
    if (path === '/.well-known/openid-configuration') {
      if (!discoveryAnswered) {
        return json({ detail: 'Service Unavailable' }, 503);
      }
      return json({
        issuer,
        authorization_endpoint: `${issuer}/mcp/oauth/authorize`,
        token_endpoint: `${issuer}/mcp/oauth/token`,
        jwks_uri: `${issuer}/xtm/auth/jwks`,
      });
    }
    if (path === '/xtm/auth/jwks') {
      return json({ keys: [{ ...publicJwk, kid: KID, alg: 'EdDSA', use: 'sig' }] });
    }
    if (path === '/mcp/oauth/token' && req.method === 'POST') {
      req.resume();
      return req.on('end', () => json(tokenAnswer));
    }
    if (path === '/api/v1/auth/me') {
      meCalls.push(req.headers.authorization);
      return json({ full_name: 'From XTM One', title: meTitle, role: 'user' });
    }
    return json({ detail: 'Not Found' }, 404);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- a listening TCP server always reports an AddressInfo
  const issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    issuer,
    answerToken: (answer: Record<string, unknown>) => {
      tokenAnswer = answer;
    },
    answerTitle: (title: string | null) => {
      meTitle = title;
    },
    answerDiscovery: (answered: boolean) => {
      discoveryAnswered = answered;
    },
    meCalls,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
};

const cookieValue = (setCookie: string | Array<string> | undefined, name: string): string | undefined => [setCookie ?? []]
  .flat()
  .map((c) => c.split(';')[0])
  .find((c) => c.startsWith(`${name}=`))
  ?.slice(name.length + 1);

type Account = {
  id: string,
  email: string,
  name: string | null,
  title: string | null,
  xtm_subject: string | null,
  password_hash: string | null,
  is_super_admin: boolean,
  last_signed_in_at: Date | null,
};

describe('Sign in with XTM One (HTTP)', () => {
  let xtmOne: Awaited<ReturnType<typeof startXtmOne>>;
  let app: FastifyInstance;
  const onSessionCreated = vi.fn();

  beforeAll(async () => {
    xtmOne = await startXtmOne();
    app = fastify();
    await app.register(cookie, { hook: 'onRequest' });
    registerXtmSignInRoutes(app, db, { url: xtmOne.issuer, token: 'registration-token', platformUrl: PLATFORM_URL }, onSessionCreated);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await xtmOne.close();
    recordSignInClientId(null);
  });

  beforeEach(async () => {
    await truncateAllTables(db);
    xtmOne.answerTitle(null);
    xtmOne.meCalls.length = 0;
    resetXtmOneIdentities();
    resetXtmDiscoveries();
    resetXtmOneAnswering();
    xtmOne.answerDiscovery(true);
    recordSignInClientId(CLIENT_ID);
    onSessionCreated.mockClear();
    logWarn.mockClear();
  });

  // The browser is on the platform URL's host, as XTM sends it back there.
  const PLATFORM_HOST = new URL(PLATFORM_URL).host;

  const flowCookieName = (state: string) => `${getSessionCookieName()}::xtm_sign_in.${state.slice(0, 16)}`;

  /** The login route: where it sends the browser, and the flow cookie it leaves. */
  const startSignIn = async (redirect = '/risks') => {
    const query = new URLSearchParams({ redirect });
    const login = await app.inject({ method: 'GET', url: `/api/auth/xtm/login?${query}`, headers: { host: PLATFORM_HOST } });
    const authorize = new URL(String(login.headers.location));
    const state = String(authorize.searchParams.get('state'));
    return { authorize, state, flow: cookieValue(login.headers['set-cookie'], flowCookieName(state)) };
  };

  /** XTM One sends the browser back with a code: the callback, with the flow cookie. */
  const finishSignIn = async (
    started: Awaited<ReturnType<typeof startSignIn>>,
    claims: Record<string, unknown>,
    { tamper, flow = started.flow, session }: { tamper?: (query: URLSearchParams) => void, flow?: string, session?: string } = {},
  ) => {
    xtmOne.answerToken({ id_token: idToken(xtmOne.issuer, { nonce: started.authorize.searchParams.get('nonce'), ...claims }), access_token: 'a', token_type: 'bearer' });
    const query = new URLSearchParams({ code: 'the-code', state: started.state, iss: xtmOne.issuer });
    tamper?.(query);
    const callback = await app.inject({ method: 'GET', url: `/api/auth/xtm/callback?${query}`, headers: { host: PLATFORM_HOST }, cookies: {
      ...(flow ? { [flowCookieName(started.state)]: flow } : {}),
      ...(session ? { [getSessionCookieName()]: session } : {}),
    } });
    return {
      status: callback.statusCode,
      location: String(callback.headers.location),
      session: cookieValue(callback.headers['set-cookie'], getSessionCookieName()),
    };
  };

  /** The round trip: the login route, XTM One (stood in for), then the callback with the flow cookie. */
  const signIn = async (
    claims: Record<string, unknown>,
    { redirect = '/risks', tamper }: { redirect?: string, tamper?: (query: URLSearchParams) => void } = {},
  ) => {
    const started = await startSignIn(redirect);
    return { authorize: started.authorize, ...(await finishSignIn(started, claims, { tamper })) };
  };

  const accountOf = async (subject: string): Promise<Account | undefined> => {
    const rows = await db.execute<Account>(sql`SELECT id, email, name, title, xtm_subject, password_hash, is_super_admin, last_signed_in_at FROM users WHERE xtm_subject = ${subject}`);
    return rows.rows[0];
  };

  const countOf = async (table: 'users' | 'tenant_users' | 'platform_group_users'): Promise<number> => {
    const rows = await db.execute<{ count: string }>(sql`SELECT count(*) AS count FROM ${sql.identifier(table)}`);
    return Number(rows.rows[0].count);
  };

  const linkedUser = async (email: string, subject: string) => {
    const { userId } = await createUser(db, email);
    await db.execute(sql`UPDATE users SET xtm_subject = ${subject} WHERE id = ${userId}`);
    return userId;
  };

  it('should send the browser to XTM One with PKCE, state, nonce and the scopes carrying the profile and the super administrator', async () => {
    const { authorize } = await signIn({ sub: 'xtm-user-1', email: 'jane@example.com' });

    expect(`${authorize.origin}${authorize.pathname}`).toBe(`${xtmOne.issuer}/mcp/oauth/authorize`);
    expect(authorize.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorize.searchParams.get('redirect_uri')).toBe(`${PLATFORM_URL}/api/auth/xtm/callback`);
    expect(authorize.searchParams.get('scope')).toBe('openid email profile xtm_role');
  });

  describe('account by XTM One id', () => {
    it('should create the account of an XTM One user it does not know, with no password and no tenant', async () => {
      await createUser(db, 'admin@test.com');

      const result = await signIn({ sub: 'xtm-user-1', email: 'jane@example.com', name: 'Jane Doe', xtm_title: 'CISO' });

      expect(result.location).toBe('/risks');
      expect(result.session).toBeTruthy();
      expect(await accountOf('xtm-user-1')).toMatchObject({
        email: 'jane@example.com',
        name: 'Jane Doe',
        title: 'CISO',
        password_hash: null,
        is_super_admin: false,
      });
      expect(await countOf('tenant_users')).toBe(0);
      expect(logWarn).not.toHaveBeenCalled();
    });

    it('should create the account of the first XTM One user on an empty platform', async () => {
      const result = await signIn({ sub: 'xtm-admin', email: 'admin@example.com', xtm_super_admin: true });

      expect(result.session).toBeTruthy();
      expect(await accountOf('xtm-admin')).toMatchObject({ email: 'admin@example.com', is_super_admin: true });
    });

    it('should sign in the account of this XTM One user whatever its email has become, and take the new one', async () => {
      const userId = await linkedUser('jane@example.com', 'xtm-user-1');

      const result = await signIn({ sub: 'xtm-user-1', email: 'jane.new@example.com' });

      expect(result.session).toBeTruthy();
      expect(await accountOf('xtm-user-1')).toMatchObject({ id: userId, email: 'jane.new@example.com' });
      expect(await countOf('users')).toBe(1);
    });

    it('should never take an account tied to another XTM One user by its email: an unknown XTM One user with that email is refused', async () => {
      const userId = await linkedUser('Jane@Example.com', 'xtm-user-1');

      const result = await signIn({ sub: 'xtm-user-2', email: 'jane@example.com' });

      expect(result.status).toBe(302);
      expect(result.location).toBe('/login?xtm_sign_in_error=conflict&redirect=%2Frisks');
      expect(result.session).toBeUndefined();
      expect(await accountOf('xtm-user-2')).toBeUndefined();
      expect(await accountOf('xtm-user-1')).toMatchObject({ id: userId });
      expect(logWarn).toHaveBeenCalledWith(expect.stringMatching(/email of another account/), { sub: 'xtm-user-2' });
    });

    it('should keep the email while another account holds the new one, and still sign in', async () => {
      await createUser(db, 'taken@example.com');
      const userId = await linkedUser('jane@example.com', 'xtm-user-1');

      const result = await signIn({ sub: 'xtm-user-1', email: 'Taken@Example.com' });

      expect(result.session).toBeTruthy();
      expect(await accountOf('xtm-user-1')).toMatchObject({ id: userId, email: 'jane@example.com' });
    });

    it('should open no session when the account cannot be created', async () => {
      try {
        await db.execute(sql.raw("CREATE OR REPLACE FUNCTION test_xtm_create_fails() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'create fails' USING ERRCODE = 'serialization_failure'; END $$"));
        await db.execute(sql.raw('CREATE TRIGGER test_xtm_create_fails BEFORE INSERT ON users FOR EACH ROW EXECUTE FUNCTION test_xtm_create_fails()'));

        const result = await signIn({ sub: 'xtm-user-1', email: 'jane@example.com' });

        expect(result.location).toBe('/login?xtm_sign_in_error=failed&redirect=%2Frisks');
        expect(result.session).toBeUndefined();
      } finally {
        await db.execute(sql.raw('DROP TRIGGER IF EXISTS test_xtm_create_fails ON users'));
        await db.execute(sql.raw('DROP FUNCTION IF EXISTS test_xtm_create_fails()'));
      }
    });

    it('should open a session of about an hour and stamp the sign-in', async () => {
      const before = Date.now();

      const result = await signIn({ sub: 'xtm-user-1', email: 'jane@example.com' });

      const session = await db.execute<{ expires_at: Date }>(sql`SELECT expires_at FROM sessions WHERE id = ${result.session}`);
      const expiresIn = new Date(session.rows[0].expires_at).getTime() - before;
      expect(expiresIn).toBeGreaterThan(55 * 60_000);
      expect(expiresIn).toBeLessThanOrEqual(61 * 60_000);
      expect(new Date(String((await accountOf('xtm-user-1'))?.last_signed_in_at)).getTime()).toBeGreaterThanOrEqual(before - 1_000);
    });
  });

  describe('profile from XTM One', () => {
    it('should store the full name and title XTM One sends at each sign-in, a null title clearing it', async () => {
      await linkedUser('jane@example.com', 'xtm-user-1');

      await signIn({ sub: 'xtm-user-1', email: 'jane@example.com', name: 'Jane Doe', xtm_title: 'CISO' });
      expect(await accountOf('xtm-user-1')).toMatchObject({ name: 'Jane Doe', title: 'CISO' });

      await signIn({ sub: 'xtm-user-1', email: 'jane@example.com', name: 'Jane Martin', xtm_title: null });
      expect(await accountOf('xtm-user-1')).toMatchObject({ name: 'Jane Martin', title: null });
      expect(xtmOne.meCalls).toHaveLength(0);
    });

    it('should read the title on XTM One, as the user signing in, when the ID token carries no xtm_title', async () => {
      await linkedUser('jane@example.com', 'xtm-user-1');
      xtmOne.answerTitle('Risk analyst');

      await signIn({ sub: 'xtm-user-1', email: 'jane@example.com', name: 'Jane Doe' });

      expect(await accountOf('xtm-user-1')).toMatchObject({ title: 'Risk analyst' });
      expect(xtmOne.meCalls).toHaveLength(1);
      const [, payload] = String(xtmOne.meCalls[0]).replace('Bearer ', '').split('.');
      expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toMatchObject({ email: 'jane@example.com' });
    });
  });

  describe('super administrator', () => {
    it('should set the super administrator at a sign-in with xtm_super_admin, and clear it at the next one without', async () => {
      await linkedUser('admin@example.com', 'xtm-admin');

      await signIn({ sub: 'xtm-admin', email: 'admin@example.com', xtm_super_admin: true });
      expect((await accountOf('xtm-admin'))?.is_super_admin).toBe(true);

      await signIn({ sub: 'xtm-admin', email: 'admin@example.com', xtm_super_admin: false });
      expect((await accountOf('xtm-admin'))?.is_super_admin).toBe(false);

      await signIn({ sub: 'xtm-admin', email: 'admin@example.com', xtm_super_admin: true });
      await signIn({ sub: 'xtm-admin', email: 'admin@example.com' });
      expect((await accountOf('xtm-admin'))?.is_super_admin).toBe(false);
    });

    it('should give nothing for xtm_role: admin, and change no platform group at any sign-in', async () => {
      await signIn({ sub: 'xtm-user-1', email: 'jane@example.com', xtm_role: 'admin', xtm_super_admin: false });

      expect((await accountOf('xtm-user-1'))?.is_super_admin).toBe(false);
      expect(await countOf('platform_group_users')).toBe(0);
    });
  });

  describe('pending account', () => {
    /** An account with no XTM One id: someone XTM One invited, or an account from before sign-in through XTM One. */
    const pendingAccount = async (email: string) => {
      const { userId } = await createUser(db, email);
      await db.execute(sql`UPDATE users SET password_hash = NULL WHERE id = ${userId}`);
      return userId;
    };

    it('should give the pending account the XTM One id of the first sign-in with its email, whatever its case', async () => {
      const userId = await pendingAccount('jane@acme.com');

      const result = await signIn({ sub: 'xtm-jane', email: 'Jane@acme.com', name: 'Jane Martin' });

      expect(result.session).toBeTruthy();
      expect(result.location).toBe('/risks');
      expect(await accountOf('xtm-jane')).toMatchObject({ id: userId, name: 'Jane Martin' });
      expect(await countOf('users')).toBe(1);
      expect(logWarn).not.toHaveBeenCalled();
    });

    it('should link it once: another XTM One user signing in with its email later is refused', async () => {
      const userId = await pendingAccount('jane@acme.com');
      await signIn({ sub: 'xtm-jane', email: 'jane@acme.com' });

      const again = await signIn({ sub: 'xtm-other', email: 'jane@acme.com' });

      expect(new URL(again.location, PLATFORM_URL).searchParams.get('xtm_sign_in_error')).toBe('conflict');
      expect(await accountOf('xtm-jane')).toMatchObject({ id: userId });
      expect(await accountOf('xtm-other')).toBeUndefined();
    });

    it('should let two tabs of the same person sign in to it, the second finding the account the first linked', async () => {
      const userId = await pendingAccount('jane@acme.com');
      const first = await startSignIn('/risks');
      const second = await startSignIn('/assets');

      const a = await finishSignIn(first, { sub: 'xtm-jane', email: 'jane@acme.com' });
      const b = await finishSignIn(second, { sub: 'xtm-jane', email: 'jane@acme.com' });

      expect(a.session && b.session).toBeTruthy();
      expect(await accountOf('xtm-jane')).toMatchObject({ id: userId });
      expect(await countOf('users')).toBe(1);
    });

    it('should sign in an XTM One user who already has an account as that account, leaving a pending account with their new email alone', async () => {
      const linkedId = await linkedUser('marc@acme.com', 'xtm-marc');
      const pendingId = await pendingAccount('jane@acme.com');

      const result = await signIn({ sub: 'xtm-marc', email: 'jane@acme.com' });

      expect(result.session).toBeTruthy();
      expect(await accountOf('xtm-marc')).toMatchObject({ id: linkedId, email: 'marc@acme.com' });
      expect((await db.execute<{ xtm_subject: string | null }>(sql`SELECT xtm_subject FROM users WHERE id = ${pendingId}`)).rows[0].xtm_subject).toBeNull();
    });
  });

  it.each([
    // Not a cookie name: refused before any cookie is looked up or cleared.
    ['a malformed state', (query: URLSearchParams) => query.set('state', 'a;'.repeat(10)), 'expired'],
    // Same 16-character prefix: finds the flow cookie, so the state comparison itself refuses it.
    ['another state', (query: URLSearchParams) => query.set('state', `${String(query.get('state')).slice(0, 16)}${'x'.repeat(27)}`), 'expired'],
    ['no issuer (RFC 9207)', (query: URLSearchParams) => query.delete('iss'), 'failed'],
    ['another issuer', (query: URLSearchParams) => query.set('iss', 'https://evil.example.com'), 'failed'],
  ])('should refuse a callback with %s', async (_case, tamper, reason) => {
    const result = await signIn({ sub: 'xtm-user-1', email: 'jane@example.com' }, { tamper });

    // A failed `onSend` (a cookie it cannot write) turns the redirect into a 500 that keeps its `location`.
    expect(result.status).toBe(302);
    expect(new URL(result.location, PLATFORM_URL).searchParams.get('xtm_sign_in_error')).toBe(reason);
    expect(result.session).toBeUndefined();
  });

  it('should refuse a callback without its flow cookie, as once the round trip has expired', async () => {
    const started = await startSignIn();

    const result = await finishSignIn(started, { sub: 'xtm-user-1', email: 'jane@example.com' }, { flow: '' });

    expect(result.location).toBe('/login?xtm_sign_in_error=expired');
    expect(result.session).toBeUndefined();
  });

  it('should land on this platform only', async () => {

    const result = await signIn({ sub: 'xtm-user-1', email: 'jane@example.com' }, { redirect: '/\t/evil.example.com' });

    expect(result.location).toBe('/');
  });

  it('should land on this platform only, whatever the flow cookie says', async () => {
    const started = await startSignIn();
    const forged = encodeSignInFlow({
      state: started.state,
      nonce: String(started.authorize.searchParams.get('nonce')),
      verifier: 'v',
      redirect: '//evil.example.com',
    });

    const result = await finishSignIn(started, { sub: 'xtm-user-1', email: 'jane@example.com' }, { flow: forged });

    expect(result.location).toBe('/');
  });

  it('should let several tabs sign in at the same time', async () => {
    const first = await startSignIn('/risks');
    const second = await startSignIn('/assets');

    const a = await finishSignIn(first, { sub: 'xtm-user-1', email: 'jane@example.com' });
    const b = await finishSignIn(second, { sub: 'xtm-user-1', email: 'jane@example.com' });

    expect([a.location, b.location]).toEqual(['/risks', '/assets']);
    expect(a.session && b.session).toBeTruthy();
  });

  it('should count the sign-in', async () => {

    await signIn({ sub: 'xtm-user-1', email: 'jane@example.com' });

    expect(onSessionCreated).toHaveBeenCalledOnce();
  });

  it('should tell a sign-in cancelled in XTM One', async () => {
    const started = await startSignIn();

    const result = await finishSignIn(started, {}, { tamper: (query) => {
      query.delete('code');
      query.set('error', 'access_denied');
    } });

    expect(result.location).toBe('/login?xtm_sign_in_error=denied&redirect=%2Frisks');
  });

  it('should end the session a refused renewal was renewing, so the login page shows the refusal', async () => {
    const signedIn = await signIn({ sub: 'xtm-user-1', email: 'jane@example.com' });
    const started = await startSignIn();

    const result = await finishSignIn(started, {}, { session: signedIn.session, tamper: (query) => {
      query.delete('code');
      query.set('error', 'access_denied');
    } });

    expect(result.location).toBe('/login?xtm_sign_in_error=denied&redirect=%2Frisks');
    expect((await db.execute(sql`SELECT id FROM sessions WHERE id = ${signedIn.session}`)).rows).toHaveLength(0);
  });

  it('should keep the session on a transient failure, and sign in again to the page it was for', async () => {
    const signedIn = await signIn({ sub: 'xtm-user-1', email: 'jane@example.com' });
    const started = await startSignIn();

    const result = await finishSignIn(started, {}, { session: signedIn.session, tamper: (query) => {
      query.delete('code');
      query.set('error', 'server_error');
    } });

    expect(result.location).toBe('/login?xtm_sign_in_error=failed&redirect=%2Frisks');
    expect((await db.execute(sql`SELECT id FROM sessions WHERE id = ${signedIn.session}`)).rows).toHaveLength(1);
  });

  it('should end the session a renewal replaces', async () => {
    const signedIn = await signIn({ sub: 'xtm-user-1', email: 'jane@example.com' });
    const started = await startSignIn();

    const renewed = await finishSignIn(started, { sub: 'xtm-user-1', email: 'jane@example.com' }, { session: signedIn.session });

    expect(renewed.session).toBeTruthy();
    expect((await db.execute(sql`SELECT id FROM sessions WHERE id = ${signedIn.session}`)).rows).toHaveLength(0);
  });

  it('should leave the session alone on a callback this browser did not start', async () => {
    const signedIn = await signIn({ sub: 'xtm-user-1', email: 'jane@example.com' });
    const started = await startSignIn();

    const result = await finishSignIn(started, {}, { flow: '', session: signedIn.session, tamper: (query) => {
      query.delete('code');
      query.set('error', 'access_denied');
    } });

    expect(result.location).toBe('/login?xtm_sign_in_error=expired');
    expect((await db.execute(sql`SELECT id FROM sessions WHERE id = ${signedIn.session}`)).rows).toHaveLength(1);
  });

  it('should say signing in is unavailable before XTM One answered a client', async () => {
    recordSignInClientId(null);

    const login = await app.inject({ method: 'GET', url: '/api/auth/xtm/login', headers: { host: PLATFORM_HOST } });

    expect(login.headers.location).toBe('/login?xtm_sign_in_error=unavailable');
  });

  it('should start over on the platform URL when the browser is on another host', async () => {
    const login = await app.inject({ method: 'GET', url: '/api/auth/xtm/login?redirect=%2Frisks', headers: { host: '127.0.0.1:4500' } });

    expect(login.headers.location).toBe(`${PLATFORM_URL}/api/auth/xtm/login?redirect=%2Frisks&on_platform_url=1`);
    expect(login.headers['set-cookie']).toBeUndefined();
  });

  it('should start over only once, whatever the host it sees', async () => {
    const login = await app.inject({ method: 'GET', url: '/api/auth/xtm/login?redirect=%2Frisks&on_platform_url=1', headers: { host: 'internal:3000' } });

    expect(String(login.headers.location)).toContain(`${xtmOne.issuer}/mcp/oauth/authorize`);
  });

  it('should say signing in is unavailable while XTM One does not answer', async () => {
    xtmOne.answerDiscovery(false);

    const login = await app.inject({ method: 'GET', url: '/api/auth/xtm/login', headers: { host: PLATFORM_HOST } });

    expect(login.headers.location).toBe('/login?xtm_sign_in_error=unavailable');
  });

  it('should keep the page a sign-in was for when XTM One does not answer', async () => {
    xtmOne.answerDiscovery(false);

    const login = await app.inject({ method: 'GET', url: '/api/auth/xtm/login?redirect=%2Frisks', headers: { host: PLATFORM_HOST } });

    expect(login.headers.location).toBe('/login?xtm_sign_in_error=unavailable&redirect=%2Frisks');
  });
});
