import type { XtmOneSeedAccount } from '@app/module';
import { reconcilePlatformSeedUsers, runPlatformSeed, users } from '@app/module';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createUser } from '../../helpers/factories';
import { db } from '../../setup/db';
import { truncateAllTables } from '../../setup/test-context';

const TEST_ADMIN_EMAIL = 'admin@test.com';
const TEST_ADMIN_PASSWORD = 'TestPass123!';

const subjectOf = async (email: string) =>
  (await db.select({ xtmSubject: users.xtmSubject }).from(users).where(eq(users.email, email)))[0]?.xtmSubject;

describe('Platform Seed - tying an already-seeded database to the stack\'s XTM One', () => {
  beforeEach(async () => {
    await truncateAllTables(db);
  });

  it('should rebind the seeded users tied to no XTM One user or to one it does not hold, and leave the others', async () => {
    await runPlatformSeed(db, {
      adminEmail: TEST_ADMIN_EMAIL,
      adminPassword: TEST_ADMIN_PASSWORD,
      xtmOneAccounts: (account) => Promise.resolve(`old-${account.email}`),
    });
    await db.update(users).set({ xtmSubject: null }).where(eq(users.email, 'alice@example.com'));
    const { email: outsiderEmail } = await createUser(db);
    const provisioned: Array<XtmOneSeedAccount> = [];
    const known = new Set(['admin@test.com', 'charlie@example.com', 'eve@example.com'].map((email) => `old-${email}`));

    const rebound = await reconcilePlatformSeedUsers(db, {
      adminPassword: TEST_ADMIN_PASSWORD,
      xtmOne: {
        knownIds: () => Promise.resolve(known),
        provision: (account) => {
          provisioned.push(account);
          return Promise.resolve(`new-${account.email}`);
        },
      },
    });

    expect(rebound).toBe(2);
    expect(provisioned.map(({ email }) => email).sort()).toEqual(['alice@example.com', 'bob@example.com']);
    expect(provisioned.every(({ password, role }) => password === TEST_ADMIN_PASSWORD && role === 'user')).toBe(true);
    expect(await subjectOf('alice@example.com')).toBe('new-alice@example.com');
    expect(await subjectOf('bob@example.com')).toBe('new-bob@example.com');
    expect(await subjectOf('charlie@example.com')).toBe('old-charlie@example.com');
    expect(await subjectOf(TEST_ADMIN_EMAIL)).toBe('old-admin@test.com');
    expect(await subjectOf(outsiderEmail)).toBeNull();
    // The full seed runs inside this test: platform-seed.test.ts gives the same seed 180 s.
  }, 180_000);

  it('should ask XTM One nothing on a database the seed never ran on', async () => {
    const knownIds = vi.fn(() => Promise.resolve(new Set<string>()));

    const rebound = await reconcilePlatformSeedUsers(db, {
      adminPassword: TEST_ADMIN_PASSWORD,
      xtmOne: { knownIds, provision: () => Promise.reject(new Error('never provisioned')) },
    });

    expect(rebound).toBe(0);
    expect(knownIds).not.toHaveBeenCalled();
  });
});
