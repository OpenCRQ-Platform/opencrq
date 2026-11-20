import { createHash, generateKeyPairSync } from 'node:crypto';
import { SignJWT } from 'jose';
import { errorToObject } from '@app/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { XtmOneSettings } from '../xtm-one/xtm-one-config';
import { resetXtmOneIdentities } from '../xtm-one/xtm-one-identity';
import {
  authorizationUrl,
  decideSignIn,
  decodeSignInFlow,
  encodeSignInFlow,
  exchangeCode,
  fetchXtmOneTitle,
  findLinkedAccount,
  getXtmDiscovery,
  isAcceptedCallback,
  newSignInFlow,
  onConfiguredUrl,
  readSignInClaims,
  resetXtmDiscoveries,
  safeRedirect,
  verifyIdToken,
} from './xtm-sign-in';

// XTM One reached on its service name, public (its issuer) on another URL.
const SETTINGS: XtmOneSettings = {
  url: 'http://xtm-one:4000',
  token: 'registration-token',
  platformUrl: 'https://opencrq.example.com',
};
const ISSUER = 'https://xtm-one.example.com';
const CLIENT_ID = 'xtm-platform-opencrq';

const DISCOVERY = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/mcp/oauth/authorize`,
  token_endpoint: `${ISSUER}/mcp/oauth/token`,
  jwks_uri: `${ISSUER}/xtm/auth/jwks`,
};

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const publicJwk = publicKey.export({ format: 'jwk' });
const KID = createHash('sha256').update(String(publicJwk.x)).digest('base64url');

const json = (body: unknown, status = 200): Response => new Response(
  JSON.stringify(body),
  { status, headers: { 'Content-Type': 'application/json' } },
);

const fetchMock = vi.fn<typeof fetch>();

/** XTM One as this platform reaches it: identity, discovery, keys, token endpoint. */
const xtmOne = (token: () => Response = () => json({ id_token: 'unused' })) => {
  fetchMock.mockImplementation((input) => {
    const url = String(input);
    if (url === `${SETTINGS.url}/xtm/auth/metadata`) {
      return Promise.resolve(json({ issuer: ISSUER }));
    }
    if (url === `${SETTINGS.url}/.well-known/openid-configuration`) {
      return Promise.resolve(json(DISCOVERY));
    }
    if (url === `${SETTINGS.url}/xtm/auth/jwks`) {
      return Promise.resolve(json({ keys: [{ ...publicJwk, kid: KID, alg: 'EdDSA', use: 'sig' }] }));
    }
    if (url === `${SETTINGS.url}/mcp/oauth/token`) {
      return Promise.resolve(token());
    }
    return Promise.resolve(json({ detail: 'Not Found' }, 404));
  });
};

beforeEach(() => {
  resetXtmOneIdentities();
  resetXtmDiscoveries();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  xtmOne();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const idToken = (
  claims: Record<string, unknown>,
  { issuer = ISSUER, audience = CLIENT_ID, expiresAt = '10m' }: { issuer?: string, audience?: string | Array<string>, expiresAt?: string } = {},
) => new SignJWT(claims)
  .setProtectedHeader({ alg: 'EdDSA', kid: KID })
  .setIssuer(issuer)
  .setAudience(audience)
  .setSubject('xtm-user-1')
  .setIssuedAt()
  .setExpirationTime(expiresAt)
  .sign(privateKey);

describe('discovery', () => {
  it('is read on the configured URL and names XTM One as issuer', async () => {
    const discovery = await getXtmDiscovery(SETTINGS);

    expect(discovery.issuer).toBe(ISSUER);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain(`${SETTINGS.url}/.well-known/openid-configuration`);
  });

  it('is refused when it names another issuer', async () => {
    fetchMock.mockImplementation((input) => Promise.resolve(String(input).endsWith('/openid-configuration')
      ? json({ ...DISCOVERY, issuer: 'https://evil.example.com' })
      : json({ issuer: ISSUER })));

    await expect(getXtmDiscovery(SETTINGS)).rejects.toThrow(/another issuer/);
  });

  it.each([
    ['a token endpoint elsewhere', { token_endpoint: 'http://169.254.169.254/latest' }],
    ['a token endpoint on a look-alike host', { token_endpoint: `${ISSUER}.evil.example/mcp/oauth/token` }],
    ['an authorization endpoint elsewhere', { authorization_endpoint: 'https://evil.example.com/authorize' }],
    ['keys elsewhere', { jwks_uri: 'https://evil.example.com/jwks' }],
  ])('is refused when it names %s', async (_case, endpoint) => {
    fetchMock.mockImplementation((input) => Promise.resolve(String(input).endsWith('/openid-configuration')
      ? json({ ...DISCOVERY, ...endpoint })
      : json({ issuer: ISSUER })));

    await expect(getXtmDiscovery(SETTINGS)).rejects.toThrow(/outside its issuer/);
  });

  it('is refused when it names no keys', async () => {
    const { jwks_uri: _keys, ...withoutKeys } = DISCOVERY;
    fetchMock.mockImplementation((input) => Promise.resolve(String(input).endsWith('/openid-configuration')
      ? json(withoutKeys)
      : json({ issuer: ISSUER })));

    await expect(getXtmDiscovery(SETTINGS)).rejects.toThrow(/jwks_uri/);
  });
});

describe('callback XTM One accepts', () => {
  it.each([
    ['https://opencrq.example.com/api/auth/xtm/callback', true],
    ['http://localhost:3100/api/auth/xtm/callback', true],
    ['http://127.0.0.1:3100/api/auth/xtm/callback', true],
    ['http://opencrq.internal:3000/api/auth/xtm/callback', false],
    ['not a url', false],
  ])('%s: %s', (callback, accepted) => {
    expect(isAcceptedCallback(callback)).toBe(accepted);
  });
});

describe('public and internal URLs', () => {
  it('moves a back-channel endpoint onto the configured URL', () => {
    expect(onConfiguredUrl(DISCOVERY.token_endpoint, DISCOVERY, SETTINGS)).toBe('http://xtm-one:4000/mcp/oauth/token');
  });

  it('refuses an endpoint outside the issuer', () => {
    expect(() => onConfiguredUrl(`${ISSUER}.evil.example/mcp/oauth/token`, DISCOVERY, SETTINGS)).toThrow(/outside its issuer/);
  });

  it('keeps the path prefix of an issuer served under one', () => {
    const prefixed = { ...DISCOVERY, issuer: `${ISSUER}/xtm-one/` };

    expect(onConfiguredUrl(`${ISSUER}/xtm-one/mcp/oauth/token`, prefixed, SETTINGS)).toBe('http://xtm-one:4000/mcp/oauth/token');
  });

  it('sends the browser to the public authorization endpoint with PKCE, state and nonce', () => {
    const flow = newSignInFlow('/');
    const url = new URL(authorizationUrl(DISCOVERY, SETTINGS, CLIENT_ID, flow));

    expect(`${url.origin}${url.pathname}`).toBe(DISCOVERY.authorization_endpoint);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: 'https://opencrq.example.com/api/auth/xtm/callback',
      scope: 'openid email profile xtm_role',
      state: flow.state,
      nonce: flow.nonce,
      code_challenge: createHash('sha256').update(flow.verifier).digest('base64url'),
      code_challenge_method: 'S256',
    });
  });
});

describe('sign-in flow cookie', () => {
  it('round-trips', () => {
    const flow = newSignInFlow('/risks');

    expect(decodeSignInFlow(encodeSignInFlow(flow))).toEqual(flow);
  });

  it('carries the token of the invitation link the sign-in started from', () => {
    const flow = newSignInFlow('/', 'a'.repeat(43));

    expect(decodeSignInFlow(encodeSignInFlow(flow))).toEqual({ ...flow, joinToken: 'a'.repeat(43) });
  });

  it('reads a flow carrying a token of another form as no flow', () => {
    const forged = encodeSignInFlow({ ...newSignInFlow('/'), joinToken: 'short' });

    expect(decodeSignInFlow(forged)).toBeNull();
  });

  it.each([undefined, '', 'not-base64-json', Buffer.from('{"state":""}').toString('base64url')])('reads %s as no flow', (value) => {
    expect(decodeSignInFlow(value)).toBeNull();
  });

  it('draws new random values each time', () => {
    const [a, b] = [newSignInFlow('/'), newSignInFlow('/')];

    expect(new Set([a.state, a.nonce, a.verifier, b.state, b.nonce, b.verifier]).size).toBe(6);
  });
});

describe('where to land', () => {
  it.each([
    [undefined, '/'],
    ['/risks?tab=open', '/risks?tab=open'],
    ['https://opencrq.example.com/risks?tab=open#top', '/risks?tab=open#top'],
    ['https://evil.example.com/risks', '/'],
    ['//evil.example.com', '/'],
    ['/\\evil.example.com', '/'],
    ['javascript:alert(1)', '/'],
    // What the browser would read as another host.
    ['/\t/evil.example.com', '/'],
    ['/\n/evil.example.com', '/'],
    ['https://opencrq.example.com//evil.example.com', '/'],
    ['/./evil.example.com', '/evil.example.com'],
  ])('%s lands on %s', (requested, expected) => {
    expect(safeRedirect(requested, SETTINGS.platformUrl)).toBe(expected);
  });
});

describe('code exchange', () => {
  it('posts the code and the PKCE verifier to the token endpoint on the configured URL', async () => {
    const flow = newSignInFlow('/');
    xtmOne(() => json({ id_token: 'the-id-token', access_token: 'a', token_type: 'bearer' }));

    expect(await exchangeCode(DISCOVERY, SETTINGS, CLIENT_ID, 'the-code', flow)).toBe('the-id-token');
    const [url, init] = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/mcp/oauth/token'))!;
    expect(String(url)).toBe('http://xtm-one:4000/mcp/oauth/token');
    expect(Object.fromEntries(new URLSearchParams(String(init?.body)))).toEqual({
      grant_type: 'authorization_code',
      code: 'the-code',
      redirect_uri: 'https://opencrq.example.com/api/auth/xtm/callback',
      client_id: CLIENT_ID,
      code_verifier: flow.verifier,
    });
  });

  it('fails when XTM One refuses the code', async () => {
    xtmOne(() => json({ error: 'invalid_grant' }, 400));

    await expect(exchangeCode(DISCOVERY, SETTINGS, CLIENT_ID, 'the-code', newSignInFlow('/'))).rejects.toThrow(/refused the code/);
  });
});

describe('ID token', () => {
  const claims = { email: 'jane@example.com', name: 'Jane Doe', xtm_role: 'admin' };

  it('is verified against the keys on the configured URL', async () => {
    const flow = newSignInFlow('/');
    const token = await idToken({ ...claims, nonce: flow.nonce });

    // Only what the sign-in reads, whatever else the token carries: `xtm_role` gives nothing.
    expect(await verifyIdToken(token, DISCOVERY, SETTINGS, CLIENT_ID, flow)).toEqual({
      sub: 'xtm-user-1',
      email: 'jane@example.com',
      name: 'Jane Doe',
      title: undefined,
      superAdmin: false,
    });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain(`${SETTINGS.url}/xtm/auth/jwks`);
  });

  it('is verified against the keys the discovery names, on the configured URL', async () => {
    const flow = newSignInFlow('/');
    const token = await idToken({ ...claims, nonce: flow.nonce });
    xtmOne();
    const served = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input, init) => (String(input) === `${SETTINGS.url}/oidc/keys`
      ? served(`${SETTINGS.url}/xtm/auth/jwks`, init)
      : served(input, init)));

    expect(await verifyIdToken(token, { ...DISCOVERY, jwks_uri: `${ISSUER}/oidc/keys` }, SETTINGS, CLIENT_ID, flow)).toMatchObject({ sub: 'xtm-user-1' });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain(`${SETTINGS.url}/oidc/keys`);
  });

  it('is refused for another sign-in flow (nonce)', async () => {
    const token = await idToken({ ...claims, nonce: 'another-flow' });

    await expect(verifyIdToken(token, DISCOVERY, SETTINGS, CLIENT_ID, newSignInFlow('/'))).rejects.toThrow(/nonce/);
  });

  it('is refused when addressed to another client', async () => {
    const flow = newSignInFlow('/');
    const token = await idToken({ ...claims, nonce: flow.nonce }, { audience: 'mcp-someone-else' });

    const error = await verifyIdToken(token, DISCOVERY, SETTINGS, CLIENT_ID, flow).catch((e: unknown) => e);

    expect(error).toMatchObject({ data: { code: 'ERR_JWT_CLAIM_VALIDATION_FAILED', claim: 'aud' } });
    // What the error log writes: what failed, never the token's claims.
    expect(JSON.stringify(errorToObject(error))).not.toContain('jane@example.com');
    expect(String(error)).not.toContain('jane@example.com');
  });

  it('is refused once expired, without its claims in the error', async () => {
    const flow = newSignInFlow('/');
    const token = await idToken({ ...claims, nonce: flow.nonce }, { expiresAt: '-1m' });

    const error = await verifyIdToken(token, DISCOVERY, SETTINGS, CLIENT_ID, flow).catch((e: unknown) => e);

    expect(error).toMatchObject({ data: { code: 'ERR_JWT_EXPIRED', claim: 'exp' } });
    expect(JSON.stringify(errorToObject(error))).not.toContain('jane@example.com');
    expect(String(error)).not.toContain('jane@example.com');
  });

  it('is refused when signed by another key', async () => {
    const flow = newSignInFlow('/');
    const forged = await new SignJWT({ ...claims, nonce: flow.nonce })
      .setProtectedHeader({ alg: 'EdDSA', kid: KID })
      .setIssuer(ISSUER)
      .setAudience(CLIENT_ID)
      .setSubject('xtm-user-1')
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(generateKeyPairSync('ed25519').privateKey);

    const error = await verifyIdToken(forged, DISCOVERY, SETTINGS, CLIENT_ID, flow).catch((e: unknown) => e);

    expect(error).toMatchObject({ code: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' });
    expect(JSON.stringify(errorToObject(error))).not.toContain('jane@example.com');
  });

  it('is refused when also addressed to another client', async () => {
    const flow = newSignInFlow('/');
    const token = await idToken({ ...claims, nonce: flow.nonce }, { audience: [CLIENT_ID, 'mcp-someone-else'] });

    await expect(verifyIdToken(token, DISCOVERY, SETTINGS, CLIENT_ID, flow)).rejects.toThrow(/not for this client alone/);
  });

  it('is refused when authorized for another client (azp)', async () => {
    const flow = newSignInFlow('/');
    const token = await idToken({ ...claims, nonce: flow.nonce, azp: 'mcp-someone-else' });

    await expect(verifyIdToken(token, DISCOVERY, SETTINGS, CLIENT_ID, flow)).rejects.toThrow(/not for this client alone/);
  });

  it('is accepted with this client as its only audience and as azp', async () => {
    const flow = newSignInFlow('/');
    const token = await idToken({ ...claims, nonce: flow.nonce, azp: CLIENT_ID }, { audience: [CLIENT_ID] });

    expect(await verifyIdToken(token, DISCOVERY, SETTINGS, CLIENT_ID, flow)).toMatchObject({ sub: 'xtm-user-1' });
  });

  it('is refused from another issuer', async () => {
    const flow = newSignInFlow('/');
    const token = await idToken({ ...claims, nonce: flow.nonce }, { issuer: 'https://evil.example.com' });

    await expect(verifyIdToken(token, DISCOVERY, SETTINGS, CLIENT_ID, flow)).rejects.toMatchObject({ data: { code: 'ERR_JWT_CLAIM_VALIDATION_FAILED', claim: 'iss' } });
  });

  it('is refused without an email', async () => {
    const flow = newSignInFlow('/');
    const token = await idToken({ nonce: flow.nonce });

    await expect(verifyIdToken(token, DISCOVERY, SETTINGS, CLIENT_ID, flow)).rejects.toThrow(/email/);
  });
});

describe('claims', () => {
  const base = { sub: 'xtm-user-1', email: 'jane@example.com' };

  it('makes a super administrator only of an explicit xtm_super_admin: true', () => {
    expect(readSignInClaims({ ...base, xtm_super_admin: true }).superAdmin).toBe(true);
    expect(readSignInClaims({ ...base, xtm_super_admin: false }).superAdmin).toBe(false);
    expect(readSignInClaims({ ...base, xtm_super_admin: 'true' }).superAdmin).toBe(false);
    expect(readSignInClaims(base).superAdmin).toBe(false);
  });

  it('gives nothing for the xtm_role claim alone', () => {
    expect(readSignInClaims({ ...base, xtm_role: 'admin' }).superAdmin).toBe(false);
  });

  it('reads the title from xtm_title when the key is there, a null one clearing it', () => {
    expect(readSignInClaims({ ...base, xtm_title: 'CISO' }).title).toBe('CISO');
    expect(readSignInClaims({ ...base, xtm_title: null }).title).toBeNull();
    expect(readSignInClaims({ ...base, xtm_title: '  ' }).title).toBeNull();
    expect(readSignInClaims(base).title).toBeUndefined();
  });

  it('reads a blank full name as none, and an absent one as nothing said', () => {
    expect(readSignInClaims({ ...base, name: 'Jane Doe' }).name).toBe('Jane Doe');
    expect(readSignInClaims({ ...base, name: '' }).name).toBeNull();
    expect(readSignInClaims(base).name).toBeUndefined();
  });
});

describe('title from XTM One', () => {
  const headers = { Authorization: 'Bearer per-user-jwt' };

  it('is read on /api/v1/auth/me on the configured URL, as the user the headers name', async () => {
    fetchMock.mockResolvedValueOnce(json({ full_name: 'Jane Doe', title: 'CISO', role: 'user' }));

    expect(await fetchXtmOneTitle(SETTINGS, headers)).toBe('CISO');
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${SETTINGS.url}/api/v1/auth/me`);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ headers });
  });

  it('is none when XTM One holds none', async () => {
    fetchMock.mockResolvedValueOnce(json({ full_name: 'Jane Doe', title: null }));

    expect(await fetchXtmOneTitle(SETTINGS, headers)).toBeNull();
  });

  it('is unknown, never an error, when XTM One does not answer', async () => {
    fetchMock.mockResolvedValueOnce(json({ detail: 'Unauthorized' }, 401));
    expect(await fetchXtmOneTitle(SETTINGS, headers)).toBeUndefined();

    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await fetchXtmOneTitle(SETTINGS, headers)).toBeUndefined();
  });
});

describe('who signs in', () => {
  it('signs in the account of this XTM One user, whatever its email now', () => {
    expect(decideSignIn({ linkedUserId: 'u-1', emailTaken: true })).toEqual({ action: 'sign-in', userId: 'u-1' });
  });

  it('creates an account for an XTM One user OpenCRQ does not know', () => {
    expect(decideSignIn({ linkedUserId: null, emailTaken: false })).toEqual({ action: 'create' });
  });

  it('never finds or takes over an account by its email', () => {
    expect(decideSignIn({ linkedUserId: null, emailTaken: true })).toEqual({ action: 'refuse', reason: 'conflict' });
  });
});

describe('account of the XTM One user', () => {
  const CLAIMS = { sub: 'xtm-jane', email: 'jane@acme.com' };

  it('finds the account of this XTM One id without spending a join link', async () => {
    const linkPendingAccount = vi.fn();

    expect(await findLinkedAccount({ getUserIdByXtmSubject: () => Promise.resolve('u-1'), linkPendingAccount }, CLAIMS, 'token')).toBe('u-1');
    expect(linkPendingAccount).not.toHaveBeenCalled();
  });

  it('links the pending account its join link names', async () => {
    const linkPendingAccount = vi.fn().mockResolvedValue('u-pending');

    expect(await findLinkedAccount({ getUserIdByXtmSubject: () => Promise.resolve(null), linkPendingAccount }, CLAIMS, 'token')).toBe('u-pending');
    expect(linkPendingAccount).toHaveBeenCalledWith('xtm-jane', 'token', 'jane@acme.com');
  });

  it('finds the account another callback of the same join link linked meanwhile, rather than none', async () => {
    const getUserIdByXtmSubject = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('u-pending');

    expect(await findLinkedAccount({ getUserIdByXtmSubject, linkPendingAccount: () => Promise.resolve(null) }, CLAIMS, 'token')).toBe('u-pending');
  });

  it('finds none for an unknown XTM One user, with or without a join link that links nothing', async () => {
    const lookups = { getUserIdByXtmSubject: () => Promise.resolve(null), linkPendingAccount: () => Promise.resolve(null) };

    expect(await findLinkedAccount(lookups, CLAIMS, undefined)).toBeNull();
    expect(await findLinkedAccount(lookups, CLAIMS, 'token')).toBeNull();
  });
});
