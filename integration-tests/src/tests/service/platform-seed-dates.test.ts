import { budgetReviews, seedPlatformAt, tenants, users } from '@app/module';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const TEST_ADMIN_EMAIL = 'admin@test.com';
const TEST_ADMIN_PASSWORD = 'TestPass123!';

/**
 * A day the closed review reads the CRM scenario just inside its tolerance when the scenario's
 * history `startFactor` is 1.0. Today's seed passes on most days whatever that margin, so only a seed
 * at this date fails when it is lost.
 */
const MARGINLESS_DAY = new Date('2026-10-24T10:00:00Z');

describe('Platform Seed - at a past date, with no XTM One', () => {
  beforeAll(async () => {
    await truncateAllTables(db);
    // Not `runPlatformSeed`: it dates the seed from the transaction's clock, which a test cannot move.
    await db.transaction((tx) => seedPlatformAt(tx, { adminEmail: TEST_ADMIN_EMAIL, adminPassword: TEST_ADMIN_PASSWORD }, MARGINLESS_DAY));
  }, 180_000);

  it('should seed every user with no password and, without an XTM One administrator, no XTM One account', async () => {
    const allUsers = await db.select({ xtmSubject: users.xtmSubject, passwordHash: users.passwordHash }).from(users);
    expect(allUsers).toHaveLength(5);
    for (const user of allUsers) {
      expect(user.xtmSubject).toBeNull();
      expect(user.passwordHash).toBeNull();
    }
  });

  it('should seed the closed review with every scenario outside its tolerance at the closing', async () => {
    const [acme] = await db.select().from(tenants).where(eq(tenants.name, 'Acme Bank'));
    const [admin] = await db.select().from(users).where(eq(users.email, TEST_ADMIN_EMAIL));
    const [closed] = await db.select().from(budgetReviews).where(eq(budgetReviews.status, 'closed'));
    const service = createTestServices(db).withOrigin({ type: 'client', userId: admin.id, tenantId: acme.id }).budgetReviews;

    const tolerance = await service.getBudgetReviewTolerance(closed.id);
    expect(tolerance!.scenarios).toHaveLength(2);
    for (const { reference, tolerance: scope } of tolerance!.scenarios) {
      expect(reference!.beyondTail).toBe(false);
      expect(reference!.probability).toBeGreaterThan(scope!.maxExceedanceProbability);
    }
  });
});
