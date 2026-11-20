import type { EventOrigin } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createAdminUser } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);
const authOrigin: EventOrigin = { type: 'auth' };

describe('Auth Service', () => {
  beforeEach(async () => {
    await truncateAllTables(db);
  });

  describe('sessions', () => {
    it('should create and validate a session', async () => {
      const { userId } = await createAdminUser(services);

      const expiresAt = new Date(Date.now() + 1000 * 60 * 60); // 1 hour
      const sessionId = await services.withOrigin(authOrigin)
        .auth.createSession(userId, expiresAt);
      expect(sessionId).toBeTruthy();

      const result = await services.withOrigin(authOrigin)
        .auth.validateSession(sessionId);
      expect(result).not.toBeNull();
      expect(result!.user.id).toBe(userId);
      expect(result!.session.id).toBe(sessionId);
    });

    it('should invalidate a session (sign out)', async () => {
      const { userId } = await createAdminUser(services);

      const expiresAt = new Date(Date.now() + 1000 * 60 * 60);
      const sessionId = await services.withOrigin(authOrigin)
        .auth.createSession(userId, expiresAt);

      await services.withOrigin(authOrigin).auth.invalidateSession(sessionId);

      const result = await services.withOrigin(authOrigin)
        .auth.validateSession(sessionId);
      expect(result).toBeNull();
    });

    it('should return null for expired session', async () => {
      const { userId } = await createAdminUser(services);

      const expiresAt = new Date(Date.now() - 1000); // Already expired
      const sessionId = await services.withOrigin(authOrigin)
        .auth.createSession(userId, expiresAt);

      const result = await services.withOrigin(authOrigin)
        .auth.validateSession(sessionId);
      expect(result).toBeNull();
    });

    it('should return null for non-existent session', async () => {
      const result = await services.withOrigin(authOrigin)
        .auth.validateSession(uuidv7());
      expect(result).toBeNull();
    });
  });
});
