import { createRemoteJWKSet, decodeJwt, jwtVerify, SignJWT } from 'jose';
import type { JWTPayload } from 'jose';
import { uuidv7 } from 'uuidv7';
import type { XtmOneSettings } from './xtm-one-config';
import type { XtmOneKeyMaterial } from './xtm-one-keys';
import { isXtmOneIssuer, resolveXtmOneIdentity } from './xtm-one-identity';

/** Short-lived per-user JWT lifetime - matches OpenCTI/OpenAEV (<= 10 min). */
const JWT_TTL_SECONDS = 10 * 60;

export interface XtmOneUserIdentity {
  id: string,
  email: string,
  name?: string | null,
}

/**
 * Mint the outbound EdDSA JWT that authenticates the current OpenCRQ user
 * to XTM One (`iss` = this platform, `aud` = XTM One's identity, which is
 * not the configured URL when XTM One is reached internally). XTM One
 * verifies it against our public JWKS and resolves the user by the `email`
 * claim.
 */
export const issueXtmOneJwt = async (
  material: XtmOneKeyMaterial,
  settings: XtmOneSettings,
  user: XtmOneUserIdentity,
): Promise<string> => new SignJWT({
  email: user.email,
  ...(user.name ? { name: user.name } : {}),
})
  .setProtectedHeader({ alg: 'EdDSA', kid: material.kid })
  .setIssuer(settings.platformUrl)
  .setSubject(user.id)
  .setAudience(await resolveXtmOneIdentity(settings))
  .setIssuedAt()
  .setExpirationTime(Math.floor(Date.now() / 1000) + JWT_TTL_SECONDS)
  .setJti(uuidv7())
  .sign(material.privateKey);

// One remote JWKS resolver per key set URL. jose caches the
// fetched key set internally (cooldown + refetch on unknown kid), mirroring
// the 1h-cached JWKS clients in OpenCTI and OpenAEV.
const remoteJwksByUrl = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export const remoteJwks = (jwksUrl: string): ReturnType<typeof createRemoteJWKSet> => {
  let jwks = remoteJwksByUrl.get(jwksUrl);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(jwksUrl));
    remoteJwksByUrl.set(jwksUrl, jwks);
  }
  return jwks;
};

const jwksForXtmOne = (url: string): ReturnType<typeof createRemoteJWKSet> => remoteJwks(`${url}/xtm/auth/jwks`);

/**
 * Verify an inbound JWT minted by XTM One for one of its users.
 *
 * Trust model (same as OpenCTI's `verifyXtmJwt` / OpenAEV's
 * `XtmJwksExtractor`): the unverified `iss` claim must name XTM One - its
 * configured URL or the issuer it publishes at `/xtm/auth/metadata`; the
 * signature is then checked against the JWKS served on the configured URL
 * (never on a URL the token names), with `aud` pinned to this platform's
 * public URL. Returns the verified payload, or `null` for any non-XTM-One
 * token so the caller can fall through to other bearer schemes.
 */
export const verifyXtmOneJwt = async (
  settings: XtmOneSettings,
  token: string,
): Promise<JWTPayload | null> => {
  let issuer: string | undefined;
  try {
    issuer = decodeJwt(token).iss;
  } catch {
    return null;
  }
  if (!issuer || !(await isXtmOneIssuer(settings, issuer))) {
    return null;
  }
  const { payload } = await jwtVerify(token, jwksForXtmOne(settings.url), {
    issuer,
    audience: settings.platformUrl,
    algorithms: ['EdDSA'],
    // jose only validates `exp` when the claim is present - require it so a
    // signed token without an expiry can never authenticate indefinitely.
    requiredClaims: ['exp'],
  });
  return payload;
};
