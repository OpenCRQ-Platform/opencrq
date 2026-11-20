import { schema } from '@app/module';
import { editionRouter } from '@app/back/src/features/edition/edition-router';
import { protectedProcedure } from '@app/back/src/trpc';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createAdminUser, createUser } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

// The edition router is mounted by the HTTP engine, outside the test app: called directly, it still
// runs the real platform capability gate against the real database.
const callerFor = (userId: string) => editionRouter(protectedProcedure, db).createCaller(
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- only the fields the auth middleware reads are needed here
  { user: { id: userId }, session: { id: 'session-1' }, tenantId: undefined, serviceAccount: null } as never,
);

describe('edition.getInstance', () => {
  beforeEach(async () => {
    await truncateAllTables(db);
  });

  it('should give a platform administrator the id XTM One registers this instance under', async () => {
    const admin = await createAdminUser(services);

    const instance = await callerFor(admin.userId).getInstance();

    const [stored] = await db.select().from(schema.platformMetadata).where(eq(schema.platformMetadata.key, 'instance_id'));
    expect(instance).toEqual({ instanceId: stored?.value });
  });

  it('should refuse a user without the MANAGE_USERS platform capability', async () => {
    await createAdminUser(services);
    const member = await createUser(db);

    await expect(callerFor(member.userId).getInstance()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
