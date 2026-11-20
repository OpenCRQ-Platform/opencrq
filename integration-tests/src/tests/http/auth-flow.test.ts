import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createUser } from '../../helpers/factories';
import { signInAsFirstAdmin } from '../../helpers/sign-in';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';

const ADMIN_EMAIL = 'admin@test.com';

describe('Auth Flow (HTTP/tRPC)', () => {
  let client: ReturnType<typeof createTrpcTestClient>;

  beforeEach(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    client = createTrpcTestClient(server);
  });

  describe('no password', () => {
    // A user an operator would have known the password of: nothing may take it.
    it.each([
      ['login', { email: ADMIN_EMAIL, password: 'SecurePass123!' }],
      ['createInitialAdminAccount', { id: uuidv7(), email: ADMIN_EMAIL, password: 'SecurePass123!' }],
      ['registerAndAcceptInvitation', { token: 'a-token', password: 'SecurePass123!' }],
    ])('should serve no %s procedure', async (path, input) => {
      await createUser(db, ADMIN_EMAIL);

      const res = await client.mutation(path, input);

      expect(res.status).toBe(404);
      expect(res.json.error.data.code).toBe('NOT_FOUND');
      expect(res.headers['set-cookie']).toBeUndefined();
      expect((await db.execute('SELECT 1 FROM sessions')).rows).toHaveLength(0);
      expect((await db.execute('SELECT 1 FROM users')).rows).toHaveLength(1);
    });

    it('should tell the browser whether XTM One can sign anyone in, and no longer whether the platform is set up', async () => {
      const res = await client.query('authStatus');

      expect(res.status).toBe(200);
      expect(res.json.result.data).toHaveProperty('xtmSignIn');
      expect(res.json.result.data).not.toHaveProperty('initialized');
    });
  });

  describe('getMe (authenticated request)', () => {
    beforeEach(async () => {
      await signInAsFirstAdmin(client, { id: uuidv7(), email: ADMIN_EMAIL });
    });

    it('should return current user when authenticated', async () => {
      const res = await client.query('getMe');

      expect(res.status).toBe(200);
      expect(res.json.result.data.email).toBe(ADMIN_EMAIL);
      expect(res.json.result.data.id).toBeTruthy();
    });

    it('should return UNAUTHORIZED when not authenticated', async () => {
      client.clearCookies();
      const res = await client.query('getMe');

      expect(res.json.error.data.code).toBe('UNAUTHORIZED');
    });

    it('should say when the session ends, and whether XTM One renews it', async () => {
      const res = await client.query('isLoggedIn');

      expect(res.json.result.data).toMatchObject({ email: ADMIN_EMAIL, renewsThroughXtmOne: false });
      expect(res.json.result.data.sessionExpiresInMs).toBeGreaterThan(0);
    });
  });

  describe('signOut', () => {
    beforeEach(async () => {
      await signInAsFirstAdmin(client, { id: uuidv7(), email: ADMIN_EMAIL });
    });

    it('should sign out and clear session cookie', async () => {
      const meRes = await client.query('getMe');
      expect(meRes.status).toBe(200);

      const signOutRes = await client.mutation('signOut');
      expect(signOutRes.status).toBe(200);
      expect(signOutRes.json.result.data).toEqual({ success: true });

      const afterRes = await client.query('getMe');
      expect(afterRes.json.error.data.code).toBe('UNAUTHORIZED');
    });
  });

  describe('session persistence', () => {
    it('should maintain session across multiple requests', async () => {
      await signInAsFirstAdmin(client, { id: uuidv7(), email: ADMIN_EMAIL });

      const res1 = await client.query('getMe');
      expect(res1.status).toBe(200);

      const res2 = await client.query('getMe');
      expect(res2.status).toBe(200);

      const res3 = await client.query('health');
      expect(res3.status).toBe(200);
    });
  });
});
