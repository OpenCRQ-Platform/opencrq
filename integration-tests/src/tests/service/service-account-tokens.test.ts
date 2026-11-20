import type { EventOrigin } from '@app/module';
import { SERVICE_ACCOUNT_TOKEN_PREFIX } from '@app/utils';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);
const systemOrigin: EventOrigin = { type: 'system' };

describe('Service Account Tokens', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let tenantId: string;
  let saId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    tenantId = setup.tenantId;

    saId = uuidv7();
    await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({
      id: saId,
      name: 'Test Bot',
    });
  });

  describe('generateToken + validateToken', () => {
    it('should generate a token and validate it successfully', async () => {
      const { id: _id, plainToken } = await services.withOrigin(adminOrigin)
        .serviceAccountTokens.generateToken({ serviceAccountId: saId, name: 'ci-token' });

      const result = await services.withOrigin(systemOrigin)
        .serviceAccountTokens.validateToken(plainToken);

      expect(result).not.toBeNull();
      expect(result!.serviceAccountId).toBe(saId);
      expect(result!.tenantId).toBe(tenantId);
    });

    it('should return null for a token with an invalid format', async () => {
      const result = await services.withOrigin(systemOrigin)
        .serviceAccountTokens.validateToken('not-a-valid-token');

      expect(result).toBeNull();
    });

    it('should return null for an unknown token', async () => {
      const fakeToken = `${SERVICE_ACCOUNT_TOKEN_PREFIX}${'A'.repeat(52)}`;
      const result = await services.withOrigin(systemOrigin)
        .serviceAccountTokens.validateToken(fakeToken);

      expect(result).toBeNull();
    });

    it('should not expose the token hash in listTokens', async () => {
      await services.withOrigin(adminOrigin)
        .serviceAccountTokens.generateToken({ serviceAccountId: saId, name: 'ci-token' });

      const tokens = await services.withOrigin(adminOrigin)
        .serviceAccountTokens.listTokens(saId);

      expect(tokens.length).toBe(1);
      // The returned object must not contain tokenHash
      expect(Object.keys(tokens[0])).not.toContain('tokenHash');
    });
  });

  describe('revokeToken', () => {
    it('should revoke a token and make it invalid', async () => {
      const { id: tokenId, plainToken } = await services.withOrigin(adminOrigin)
        .serviceAccountTokens.generateToken({ serviceAccountId: saId, name: 'to-revoke' });

      await services.withOrigin(adminOrigin)
        .serviceAccountTokens.revokeToken(tokenId);

      const result = await services.withOrigin(systemOrigin)
        .serviceAccountTokens.validateToken(plainToken);

      expect(result).toBeNull();
    });

    it('should mark the token as revoked in the list', async () => {
      const { id: tokenId } = await services.withOrigin(adminOrigin)
        .serviceAccountTokens.generateToken({ serviceAccountId: saId, name: 'to-revoke' });

      await services.withOrigin(adminOrigin).serviceAccountTokens.revokeToken(tokenId);

      const tokens = await services.withOrigin(adminOrigin).serviceAccountTokens.listTokens(saId);
      const token = tokens.find((t) => t.id === tokenId);
      expect(token).toBeDefined();
      expect(token!.revokedAt).not.toBeNull();
    });
  });

  describe('token expiry', () => {
    it('should return null for an expired token', async () => {
      // Generate token with an expiry date in the past
      const pastExpiry = new Date(Date.now() - 1000);
      const { plainToken } = await services.withOrigin(adminOrigin)
        .serviceAccountTokens.generateToken({
          serviceAccountId: saId,
          name: 'expired-token',
          expiresAt: pastExpiry,
        });

      const result = await services.withOrigin(systemOrigin)
        .serviceAccountTokens.validateToken(plainToken);

      expect(result).toBeNull();
    });

    it('should validate a token without expiry (null = never expires)', async () => {
      const { plainToken } = await services.withOrigin(adminOrigin)
        .serviceAccountTokens.generateToken({
          serviceAccountId: saId,
          name: 'permanent-token',
          expiresAt: null,
        });

      const result = await services.withOrigin(systemOrigin)
        .serviceAccountTokens.validateToken(plainToken);

      expect(result).not.toBeNull();
    });
  });

  describe('inactive service account', () => {
    it('should return null when the service account is disabled', async () => {
      const { plainToken } = await services.withOrigin(adminOrigin)
        .serviceAccountTokens.generateToken({ serviceAccountId: saId, name: 'bot-token' });

      // Disable the service account
      await services.withOrigin(adminOrigin).serviceAccounts.updateServiceAccount(saId, { active: false });

      const result = await services.withOrigin(systemOrigin)
        .serviceAccountTokens.validateToken(plainToken);

      expect(result).toBeNull();
    });
  });

  describe('rotateToken', () => {
    it('should create a new token and invalidate the old one', async () => {
      const { id: oldId, plainToken: oldPlain } = await services.withOrigin(adminOrigin)
        .serviceAccountTokens.generateToken({ serviceAccountId: saId, name: 'rotate-me' });

      const { id: newId, plainToken: newPlain } = await services.withOrigin(adminOrigin)
        .serviceAccountTokens.rotateToken(oldId);

      expect(newId).not.toBe(oldId);
      expect(newPlain).not.toBe(oldPlain);

      // Old token is now invalid (revoked by rotation)
      const oldResult = await services.withOrigin(systemOrigin)
        .serviceAccountTokens.validateToken(oldPlain);
      expect(oldResult).toBeNull();

      // New token is valid
      const newResult = await services.withOrigin(systemOrigin)
        .serviceAccountTokens.validateToken(newPlain);
      expect(newResult).not.toBeNull();
      expect(newResult!.serviceAccountId).toBe(saId);
    });
  });

  describe('tenant isolation', () => {
    it('should not allow validating a token with a different tenant context', async () => {
      const tenantB = await createTenant(services, adminUserId);
      const originB: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenantB };

      // Create SA in tenant B and generate a token for it
      const saBId = uuidv7();
      await services.withOrigin(originB).serviceAccounts.createServiceAccount({
        id: saBId,
        name: 'SA Tenant B',
      });
      const { plainToken: tokenB } = await services.withOrigin(originB)
        .serviceAccountTokens.generateToken({ serviceAccountId: saBId, name: 'token-b' });

      // listTokens from tenant A cannot see tenant B tokens
      const tokensA = await services.withOrigin(adminOrigin)
        .serviceAccountTokens.listTokens(saBId);
      expect(tokensA).toHaveLength(0);

      // Token B is valid for its own tenant (validateToken uses rawDb and checks SA active status)
      const resultB = await services.withOrigin(systemOrigin)
        .serviceAccountTokens.validateToken(tokenB);
      expect(resultB).not.toBeNull();
      expect(resultB!.tenantId).toBe(tenantB);
      // The tenantId in the result must NOT be tenant A
      expect(resultB!.tenantId).not.toBe(tenantId);
    });
  });
});
