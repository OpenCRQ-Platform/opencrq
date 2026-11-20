import { createDataChangedHub } from '@app/back/src/features/events/data-changed-hub';
import { eventsRouter } from '@app/back/src/features/events/events-router';
import { protectedProcedure } from '@app/back/src/trpc';
import { sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTenantWithAdmin, createUser } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const settle = (ms: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

describe('events.onDataChanged tenant access', () => {
  let hub: ReturnType<typeof createDataChangedHub>;
  let shutdown: AbortController;
  let tenantId: string;
  let memberId: string;
  let superAdminId: string;
  let strangerId: string;

  const streamOf = async (userId: string) => {
    const caller = eventsRouter({ protectedProcedure }, db, hub, shutdown.signal, () => ({ procedures: [], all: true }))
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- only the fields the auth middleware reads are needed here
      .createCaller({ user: { id: userId }, session: { id: uuidv7(), expiresAt: new Date(Date.now() + 3_600_000) } } as never);
    return (await caller.events.onDataChanged({ tenantId }))[Symbol.asyncIterator]();
  };

  // The stream subscribes to the hub only once the access check has passed, so ring until it answers.
  const firstDoorbell = async (stream: AsyncIterator<unknown>) => {
    let answered = false;
    const next = stream.next().finally(() => {
      answered = true;
    });
    void (async () => {
      while (!answered) {
        hub.publish(tenantId, null, null, 'risks');
        await settle(25);
      }
    })();
    return await next;
  };

  beforeEach(async () => {
    await truncateAllTables(db);
    hub = createDataChangedHub({ windowMs: 0, jobWindowMs: 0 });
    shutdown = new AbortController();
    const setup = await createTenantWithAdmin(services);
    tenantId = setup.tenantId;
    memberId = setup.userId;
    superAdminId = (await createUser(db, 'xtm-admin@example.com')).userId;
    await db.execute(sql`UPDATE users SET is_super_admin = true WHERE id = ${superAdminId}`);
    strangerId = (await createUser(db)).userId;
  });

  afterEach(() => {
    shutdown.abort();
    hub.closeAll();
  });

  it('should stream a tenant\'s doorbells to a member', async () => {
    const stream = await streamOf(memberId);

    await expect(firstDoorbell(stream)).resolves.toMatchObject({ done: false, value: { tenantId } });
    await stream.return?.();
  });

  it('should stream a tenant\'s doorbells to the super administrator, who is not a member', async () => {
    const stream = await streamOf(superAdminId);

    await expect(firstDoorbell(stream)).resolves.toMatchObject({ done: false, value: { tenantId } });
    await stream.return?.();
  });

  it('should refuse a user with no membership', async () => {
    const stream = await streamOf(strangerId);

    await expect(firstDoorbell(stream)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('should refuse the former super administrator once XTM One stops saying so', async () => {
    await db.execute(sql`UPDATE users SET is_super_admin = false WHERE id = ${superAdminId}`);
    const stream = await streamOf(superAdminId);

    await expect(firstDoorbell(stream)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
