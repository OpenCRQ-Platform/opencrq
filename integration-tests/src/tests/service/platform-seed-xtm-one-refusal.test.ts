import { runPlatformSeed, tenants, users } from '@app/module';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../setup/db';
import { truncateAllTables } from '../../setup/test-context';

const TEST_ADMIN_EMAIL = 'admin@test.com';
const TEST_ADMIN_PASSWORD = 'TestPass123!';

describe('Platform Seed - when XTM One refuses a user', () => {
  beforeEach(async () => {
    await truncateAllTables(db);
  });

  it('should fail with XTM One\'s reason and write no user nor tenant', async () => {
    const refusal = new Error('Creating bob@example.com in XTM One failed, XTM One answered HTTP 400');
    const seed = runPlatformSeed(db, {
      adminEmail: TEST_ADMIN_EMAIL,
      adminPassword: TEST_ADMIN_PASSWORD,
      xtmOneAccounts: (account) => (account.email === 'bob@example.com' ? Promise.reject(refusal) : Promise.resolve(`xtm-one-${account.email}`)),
    });

    await expect(seed).rejects.toThrow(refusal.message);
    expect(await db.select({ id: users.id }).from(users)).toHaveLength(0);
    expect(await db.select({ id: tenants.id }).from(tenants)).toHaveLength(0);
  });
});
