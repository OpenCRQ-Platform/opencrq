import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { newError, SERVICE_ACCOUNT_TOKEN_PREFIX } from '@app/utils';
import { uuidv7 } from 'uuidv7';
import { defineService } from '../../registry';
import { requireTenantId } from '../../security';
import { serviceAccountTokensRepository } from './repository';

const TOKEN_ID_LENGTH = 12;
const TOKEN_SECRET_LENGTH = 40;
const BASE62_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * Generates a cryptographically secure random string of `length` characters
 * from the base62 alphabet [0-9A-Za-z].
 *
 * Uses `crypto.randomInt(0, 62)` which performs rejection sampling internally,
 * so there is no modulo bias. The standard library handles entropy refilling.
 */
const generateBase62String = (length: number): string => {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += BASE62_CHARS[randomInt(0, 62)];
  }
  return result;
};

const hashToken = (plainToken: string): string =>
  createHash('sha256').update(plainToken).digest('hex');

const generateTokenParts = () => {
  const tokenIdPart = generateBase62String(TOKEN_ID_LENGTH);
  const plainToken = `${SERVICE_ACCOUNT_TOKEN_PREFIX}${tokenIdPart}${generateBase62String(TOKEN_SECRET_LENGTH)}`;
  return { tokenIdPart, plainToken, tokenHash: hashToken(plainToken) };
};

const DEFAULT_EXPIRY_MS = 24 * 60 * 60 * 1000;

export const serviceAccountTokensService = defineService('serviceAccountTokens', serviceAccountTokensRepository).implement({

  generateToken: async ({ repo, eventOrigin }, params: { serviceAccountId: string, name: string, expiresAt?: Date | null }) => {
    const tenantId = requireTenantId(eventOrigin);

    const saTenantId = await repo.findServiceAccountTenantId(params.serviceAccountId);
    if (saTenantId !== tenantId) {
      throw newError('service account does not belong to this tenant');
    }

    const { tokenIdPart, plainToken, tokenHash } = generateTokenParts();

    const expiresAt = params.expiresAt === null
      ? null
      : (params.expiresAt ?? new Date(Date.now() + DEFAULT_EXPIRY_MS));

    const id = uuidv7();
    await repo.insertToken({
      id,
      serviceAccountId: params.serviceAccountId,
      tenantId,
      name: params.name,
      tokenId: tokenIdPart,
      tokenHash,
      expiresAt,
    });

    return { id, plainToken };
  },

  rotateToken: async ({ repo, eventOrigin }, tokenId: string) => {
    const tenantId = requireTenantId(eventOrigin);

    const existing = await repo.findTokenById(tokenId);
    if (!existing) {
      throw newError('token not found');
    }
    if (existing.tenantId !== tenantId) {
      throw newError('token does not belong to this tenant');
    }

    await repo.revokeToken(tokenId);

    const { tokenIdPart, plainToken, tokenHash } = generateTokenParts();

    const id = uuidv7();
    await repo.insertToken({
      id,
      serviceAccountId: existing.serviceAccountId,
      tenantId: existing.tenantId,
      name: existing.name,
      tokenId: tokenIdPart,
      tokenHash,
      expiresAt: existing.expiresAt != null ? new Date(Date.now() + DEFAULT_EXPIRY_MS) : undefined,
    });

    return { id, plainToken };
  },

  /**
   * Replaces the token named `name` of an account the deployment provisioned: the live ones under
   * that name are revoked and one that never expires is issued, so a sibling product re-provisioned
   * holds exactly one working token. System origin only: the caller is the deployment, not a tenant.
   */
  replaceProvisionedToken: async ({ atomic, eventOrigin }, params: { serviceAccountId: string, tenantId: string, name: string }) => {
    if (eventOrigin.type !== 'system') {
      throw newError('System origin required');
    }
    return atomic(async ({ repo }) => {
      await repo.revokeTokensByName(params.serviceAccountId, params.name);
      const { tokenIdPart, plainToken, tokenHash } = generateTokenParts();
      await repo.insertToken({
        id: uuidv7(),
        serviceAccountId: params.serviceAccountId,
        tenantId: params.tenantId,
        name: params.name,
        tokenId: tokenIdPart,
        tokenHash,
        expiresAt: null,
      });
      return { plainToken };
    });
  },

  /** Revokes the live tokens named `name` of a provisioned account; answers how many. System origin only. */
  revokeProvisionedTokens: async ({ repo, eventOrigin }, serviceAccountId: string, name: string) => {
    if (eventOrigin.type !== 'system') {
      throw newError('System origin required');
    }
    return repo.revokeTokensByName(serviceAccountId, name);
  },

  revokeToken: async ({ repo }, tokenId: string) =>
    repo.revokeToken(tokenId),

  listTokens: async ({ repo }, serviceAccountId: string) =>
    repo.findTokensByServiceAccountId(serviceAccountId),

  validateToken: async ({ repo }, rawToken: string): Promise<{ serviceAccountId: string, tenantId: string } | null> => {
    if (!rawToken.startsWith(SERVICE_ACCOUNT_TOKEN_PREFIX) || rawToken.length !== SERVICE_ACCOUNT_TOKEN_PREFIX.length + TOKEN_ID_LENGTH + TOKEN_SECRET_LENGTH) {
      return null;
    }

    const tokenIdPart = rawToken.slice(SERVICE_ACCOUNT_TOKEN_PREFIX.length, SERVICE_ACCOUNT_TOKEN_PREFIX.length + TOKEN_ID_LENGTH);
    const record = await repo.findTokenForValidation(tokenIdPart);

    if (!record) {
      return null;
    }

    if (!record.saActive) {
      return null;
    }

    if (record.expiresAt && record.expiresAt < new Date()) {
      return null;
    }

    const expectedHash = hashToken(rawToken);
    if (!timingSafeEqual(Buffer.from(expectedHash, 'hex'), Buffer.from(record.tokenHash, 'hex'))) {
      return null;
    }

    // Fire-and-forget last used update: do not await to avoid blocking the request
    void Promise.resolve(repo.updateLastUsed(record.id)).catch(() => undefined);

    return { serviceAccountId: record.serviceAccountId, tenantId: record.tenantId };
  },
});
