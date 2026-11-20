import { runPlatformSeed, tenants, users } from '@app/module';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);
const ROTATED_ADMIN_EMAIL = 'rotated-admin@test.com';
const TEST_ADMIN_PASSWORD = 'TestPass123!';

describe('Platform Seed - on a platform that already has users', () => {
  beforeEach(async () => {
    await truncateAllTables(db);
    await createTenantWithAdmin(services);
  });

  it('should skip, not fail, when the configured admin email matches none of the existing users', async () => {
    await expect(runPlatformSeed(db, { adminEmail: ROTATED_ADMIN_EMAIL, adminPassword: TEST_ADMIN_PASSWORD })).resolves.toBeUndefined();
  });

  it('should write nothing when it skips', async () => {
    const usersBefore = await db.select({ id: users.id }).from(users);
    const tenantsBefore = await db.select({ id: tenants.id }).from(tenants);

    await runPlatformSeed(db, { adminEmail: ROTATED_ADMIN_EMAIL, adminPassword: TEST_ADMIN_PASSWORD });

    expect(await db.select({ id: users.id }).from(users)).toHaveLength(usersBefore.length);
    expect(await db.select({ id: tenants.id }).from(tenants)).toHaveLength(tenantsBefore.length);
    expect(await db.select({ id: users.id }).from(users).where(eq(users.email, ROTATED_ADMIN_EMAIL))).toHaveLength(0);
  });
});
