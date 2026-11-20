import type { EventOrigin } from '@app/module';
import { schema } from '@app/module';
import { eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);
const SYSTEM_ORIGIN: EventOrigin = { type: 'system' };

const workers = () => services.withOrigin(SYSTEM_ORIGIN).workers;

const ageHeartbeat = async (id: string, ms: number) => {
  await db.update(schema.workers)
    .set({ heartbeatAt: sql`now() - make_interval(secs => ${ms / 1000})` })
    .where(eq(schema.workers.id, id));
};

const countRows = async (): Promise<number> => {
  const rows = await db.select({ total: sql<number>`count(*)` }).from(schema.workers);
  return Number(rows[0]?.total ?? 0);
};

describe('worker registry', () => {
  beforeEach(async () => {
    await truncateAllTables(db);
  });

  it('reads dead on an empty registry', async () => {
    expect(await workers().isAnyWorkerAlive(30)).toBe(false);
  });

  it('reads alive on a fresh heartbeat', async () => {
    await workers().heartbeat(uuidv7(), 'worker');
    expect(await workers().isAnyWorkerAlive(30)).toBe(true);
  });

  it('reads dead once every heartbeat has aged past the window', async () => {
    const id = uuidv7();
    await workers().heartbeat(id, 'worker');
    await ageHeartbeat(id, 60_000);
    expect(await workers().isAnyWorkerAlive(30)).toBe(false);
  });

  it('reads alive while one of several processes still answers', async () => {
    const stale = uuidv7();
    await workers().heartbeat(stale, 'worker-a');
    await ageHeartbeat(stale, 60_000);
    await workers().heartbeat(uuidv7(), 'worker-b');
    expect(await workers().isAnyWorkerAlive(30)).toBe(true);
  });

  it('refreshes its own row rather than adding one', async () => {
    const id = uuidv7();
    await workers().heartbeat(id, 'worker');
    const [first] = await db.select().from(schema.workers).where(eq(schema.workers.id, id));
    await ageHeartbeat(id, 5_000);
    await workers().heartbeat(id, 'worker');
    const [second] = await db.select().from(schema.workers).where(eq(schema.workers.id, id));

    expect(await countRows()).toBe(1);
    expect(second.heartbeatAt.getTime()).toBeGreaterThan(first.heartbeatAt.getTime());
    expect(second.startedAt.getTime()).toBe(first.startedAt.getTime());
  });

  it('prunes rows left behind by earlier process lifetimes', async () => {
    const abandoned = uuidv7();
    await workers().heartbeat(abandoned, 'worker');
    await ageHeartbeat(abandoned, 2 * 60 * 60 * 1000);

    await workers().heartbeat(uuidv7(), 'worker');

    expect(await countRows()).toBe(1);
  });
});
