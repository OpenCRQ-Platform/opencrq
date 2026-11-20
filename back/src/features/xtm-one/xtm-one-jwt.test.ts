import { createHash, generateKeyPairSync } from 'node:crypto';
import { decodeJwt, jwtVerify, SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { XtmOneSettings } from './xtm-one-config';
import type { XtmOneKeyMaterial } from './xtm-one-keys';
import { resetXtmOneIdentities } from './xtm-one-identity';
import { issueXtmOneJwt, verifyXtmOneJwt } from './xtm-one-jwt';
import { buildJwks } from './xtm-one-keys';

const SETTINGS: XtmOneSettings = {
  url: 'https://xtm-one.example.com',
  token: 'registration-token',
  platformUrl: 'https://opencrq.example.com',
};

// XTM One in Docker: reached on its service name, public on the host port.
const PUBLIC_ISSUER = 'http://localhost:8090';

const json = (body: unknown, status = 200): Response => new Response(
  JSON.stringify(body),
  { status, headers: { 'Content-Type': 'application/json' } },
);

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  resetXtmOneIdentities();
  fetchMock.mockReset();
  // An XTM One that publishes no identity, unless a test says otherwise.
  fetchMock.mockResolvedValue(json({ detail: 'Not Found' }, 404));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const makeMaterial = (): XtmOneKeyMaterial => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' });
  const publicJwkX = String(jwk.x);
  const raw = Buffer.from(publicJwkX, 'base64url');
  const kid = createHash('sha256').update(raw).digest('base64url');
  return { privateKey, publicKey, publicJwkX, kid };
};

describe('XTM One cross-platform JWT', () => {
  it('issues an EdDSA JWT verifiable with the published JWKS key', async () => {
    const material = makeMaterial();
    const token = await issueXtmOneJwt(material, SETTINGS, {
      id: 'user-1',
      email: 'jane@example.com',
      name: 'Jane Doe',
    });

    const { payload, protectedHeader } = await jwtVerify(token, material.publicKey, {
      issuer: SETTINGS.platformUrl,
      audience: SETTINGS.url,
      algorithms: ['EdDSA'],
    });

    expect(protectedHeader.alg).toBe('EdDSA');
    expect(protectedHeader.kid).toBe(material.kid);
    expect(payload.sub).toBe('user-1');
    expect(payload.email).toBe('jane@example.com');
    expect(payload.name).toBe('Jane Doe');
    expect(payload.jti).toBeTruthy();
    // Short-lived: at most 10 minutes.
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBeLessThanOrEqual(10 * 60);
  });

  it('addresses the token to the identity XTM One publishes when it is reached internally', async () => {
    const internal = { ...SETTINGS, url: 'http://xtm-one:4000' };
    fetchMock.mockResolvedValue(json({ issuer: `${PUBLIC_ISSUER}/` }));

    const token = await issueXtmOneJwt(makeMaterial(), internal, { id: 'user-1', email: 'jane@example.com' });

    expect(decodeJwt(token).aud).toBe(PUBLIC_ISSUER);
    expect(String(fetchMock.mock.calls[0][0])).toBe('http://xtm-one:4000/xtm/auth/metadata');
  });

  it('addresses the token to the configured URL when XTM One publishes no identity', async () => {
    const token = await issueXtmOneJwt(makeMaterial(), SETTINGS, { id: 'user-1', email: 'jane@example.com' });

    expect(decodeJwt(token).aud).toBe(SETTINGS.url);
  });

  it('rejects verification with a different key pair', async () => {
    const material = makeMaterial();
    const other = makeMaterial();
    const token = await issueXtmOneJwt(material, SETTINGS, {
      id: 'user-1',
      email: 'jane@example.com',
    });
    await expect(jwtVerify(token, other.publicKey, { algorithms: ['EdDSA'] }))
      .rejects.toThrow();
  });

  describe('verifying a token XTM One minted', () => {
    // Each case its own configured URL: the remote JWKS is cached per URL.
    let caseNumber = 0;
    const internalSettings = (): XtmOneSettings => {
      caseNumber += 1;
      return { ...SETTINGS, url: `http://xtm-one-${caseNumber}:4000` };
    };

    const xtmOneSigning = () => {
      const { privateKey, publicKey } = generateKeyPairSync('ed25519');
      const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'xtm-one', alg: 'EdDSA', use: 'sig' };
      const sign = (issuer: string) => new SignJWT({ email: 'jane@example.com' })
        .setProtectedHeader({ alg: 'EdDSA', kid: 'xtm-one' })
        .setIssuer(issuer)
        .setSubject('xtm-user')
        .setAudience(SETTINGS.platformUrl)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);
      return { jwks: { keys: [jwk] }, sign };
    };

    const serveXtmOne = (settings: XtmOneSettings, jwks: unknown, issuer?: string) => {
      fetchMock.mockImplementation((input) => {
        const url = String(input);
        if (url === `${settings.url}/xtm/auth/metadata`) {
          return Promise.resolve(issuer ? json({ issuer }) : json({ detail: 'Not Found' }, 404));
        }
        if (url === `${settings.url}/xtm/auth/jwks`) {
          return Promise.resolve(json(jwks));
        }
        return Promise.resolve(json({ detail: 'unexpected' }, 500));
      });
    };

    it('trusts the published issuer and fetches the keys on the configured URL', async () => {
      const settings = internalSettings();
      const xtmOne = xtmOneSigning();
      serveXtmOne(settings, xtmOne.jwks, PUBLIC_ISSUER);

      const payload = await verifyXtmOneJwt(settings, await xtmOne.sign(PUBLIC_ISSUER));

      expect(payload?.email).toBe('jane@example.com');
      const requested = fetchMock.mock.calls.map(([input]) => String(input));
      expect(requested).toContain(`${settings.url}/xtm/auth/jwks`);
      expect(requested.every((url) => url.startsWith(settings.url))).toBe(true);
    });

    it('still trusts the configured URL as issuer', async () => {
      const settings = internalSettings();
      const xtmOne = xtmOneSigning();
      serveXtmOne(settings, xtmOne.jwks, PUBLIC_ISSUER);

      const payload = await verifyXtmOneJwt(settings, await xtmOne.sign(`${settings.url}/`));

      expect(payload?.sub).toBe('xtm-user');
    });

    it('ignores an issuer XTM One does not publish', async () => {
      const settings = internalSettings();
      const xtmOne = xtmOneSigning();
      serveXtmOne(settings, xtmOne.jwks);

      expect(await verifyXtmOneJwt(settings, await xtmOne.sign(PUBLIC_ISSUER))).toBeNull();
      expect(await verifyXtmOneJwt(settings, await xtmOne.sign('http://evil.example.com'))).toBeNull();
    });

    it('refuses a published issuer signed by a key XTM One does not serve', async () => {
      const settings = internalSettings();
      const served = xtmOneSigning();
      const forged = xtmOneSigning();
      serveXtmOne(settings, served.jwks, PUBLIC_ISSUER);

      await expect(verifyXtmOneJwt(settings, await forged.sign(PUBLIC_ISSUER))).rejects.toThrow();
    });
  });

  it('builds an OKP/Ed25519 JWKS document', () => {
    const material = makeMaterial();
    const jwks = buildJwks(material);
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]).toMatchObject({
      kty: 'OKP',
      crv: 'Ed25519',
      x: material.publicJwkX,
      kid: material.kid,
      use: 'sig',
      alg: 'EdDSA',
    });
  });
});
