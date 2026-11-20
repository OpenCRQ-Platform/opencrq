import { beforeEach, describe, expect, it } from 'vitest';
import { signInAsFirstAdmin } from '../../helpers/sign-in';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';

describe('Input Validation (HTTP/tRPC)', () => {
  let client: ReturnType<typeof createTrpcTestClient>;

  beforeEach(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    client = createTrpcTestClient(server);
  });

  describe('error format', () => {
    it('should include zodError in BAD_REQUEST responses', async () => {
      await signInAsFirstAdmin(client);
      const res = await client.query('users.getUser', { id: 42 });

      const error = res.json.error;
      expect(error.data.code).toBe('BAD_REQUEST');
      expect(error.data.zodError).toBeTruthy();
    });

    it('should reject a missing field', async () => {
      await signInAsFirstAdmin(client);
      const res = await client.query('users.getUser', {});

      expect(res.json.error.data.code).toBe('BAD_REQUEST');
      expect(res.json.error.data.zodError).not.toBeNull();
    });

    it('should not include zodError for non-validation errors', async () => {
      const res = await client.mutation('signOut');

      const error = res.json.error;
      expect(error.data.code).toBe('UNAUTHORIZED');
      expect(error.data.zodError).toBeNull();
    });
  });
});
