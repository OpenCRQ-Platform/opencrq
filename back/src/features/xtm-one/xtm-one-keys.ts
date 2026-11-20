import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import type { DrizzleDB } from '@app/module';
import { schema } from '@app/module';
import { newError } from '@app/utils';
import { eq } from 'drizzle-orm';

/**
 * Durable Ed25519 signing key for XTM One cross-platform JWTs.
 *
 * OpenCTI and OpenAEV derive their key pair deterministically from an
 * existing platform secret. OpenCRQ has no such secret, so the key is
 * generated once and persisted (PKCS#8 PEM) in the `platform_metadata`
 * key-value table - `ON CONFLICT DO NOTHING` keeps the first-boot key for
 * the lifetime of the database, which makes the pattern HA-safe (all
 * replicas converge on the winner's key), mirroring the anonymous
 * instance-identity bootstrap.
 */
const SIGNING_KEY_METADATA_KEY = 'xtm_one_signing_key';

export interface XtmOneKeyMaterial {
  privateKey: KeyObject,
  publicKey: KeyObject,
  /** base64url public key coordinate (JWK `x`). */
  publicJwkX: string,
  /** base64url(SHA-256(raw public key)) - same convention as OpenCTI/OpenAEV. */
  kid: string,
}

let cached: XtmOneKeyMaterial | null = null;

const readPersistedPem = async (db: DrizzleDB): Promise<string | undefined> => {
  const rows = await db.select()
    .from(schema.platformMetadata)
    .where(eq(schema.platformMetadata.key, SIGNING_KEY_METADATA_KEY));
  return rows[0]?.value;
};

export const ensureSigningKey = async (db: DrizzleDB): Promise<XtmOneKeyMaterial> => {
  if (cached) {
    return cached;
  }

  // Read first: after the first boot the key already exists, so the common
  // path never pays for a key generation. Only when missing do we generate
  // and insert (ON CONFLICT DO NOTHING), then re-read so concurrent nodes
  // all converge on the winner's key.
  let pem = await readPersistedPem(db);
  if (!pem) {
    const generated = generateKeyPairSync('ed25519');
    const generatedPem = generated.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    await db.insert(schema.platformMetadata)
      .values({ key: SIGNING_KEY_METADATA_KEY, value: generatedPem })
      .onConflictDoNothing();
    pem = await readPersistedPem(db);
  }
  if (!pem) {
    throw newError('XTM One signing key is missing from platform_metadata');
  }

  const privateKey = createPrivateKey(pem);
  const publicKey = createPublicKey(privateKey);
  const jwk = publicKey.export({ format: 'jwk' });
  const publicJwkX = String(jwk.x);
  const rawPublicKey = Buffer.from(publicJwkX, 'base64url');
  const kid = createHash('sha256').update(rawPublicKey).digest('base64url');

  cached = { privateKey, publicKey, publicJwkX, kid };
  return cached;
};

/** JWKS document served at `GET /xtm/auth/jwks` (public, cacheable). */
export const buildJwks = (material: XtmOneKeyMaterial): { keys: Array<Record<string, string>> } => ({
  keys: [
    {
      kty: 'OKP',
      crv: 'Ed25519',
      x: material.publicJwkX,
      kid: material.kid,
      use: 'sig',
      alg: 'EdDSA',
    },
  ],
});
