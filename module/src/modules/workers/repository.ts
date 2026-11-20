import { gt, lt, sql } from 'drizzle-orm';
import { defineRepository } from '../../registry';
import { workers } from './schema';

/** The registry's only bound: no scheduled cleanup exists, so the heartbeat prunes on its own write. */
const ROW_RETENTION_SECONDS = 60 * 60;

export const workersRepository = defineRepository({
  heartbeat: async ({ db }, id: string, processName: string) => {
    await db.insert(workers)
      .values([{ id, processName }])
      .onConflictDoUpdate({ target: workers.id, set: { heartbeatAt: sql`now()` } });
    // eslint-disable-next-line app/no-unguarded-rewrite -- prunes the stale heartbeats of other workers, and the table has no doorbell trigger
    await db.delete(workers)
      .where(lt(workers.heartbeatAt, sql`now() - make_interval(secs => ${ROW_RETENTION_SECONDS})`));
  },

  /**
   * The window resolves in SQL: writer and reader are different processes, and a cutoff stamped by
   * one Node clock against a heartbeat stamped by another makes a live worker read as absent.
   *
   * Boolean by contract: `views.workers` applies no filter, the table declaring no policy, so a
   * row-returning method here would hand the installation's inventory to any tenant.
   */
  isAnyWorkerAlive: async ({ db, views }, staleAfterSeconds: number): Promise<boolean> => {
    const rows = await db.select({ alive: sql<number>`1` })
      .from(views.workers)
      .where(gt(views.workers.heartbeatAt, sql`now() - make_interval(secs => ${staleAfterSeconds})`))
      .limit(1);
    return rows.length > 0;
  },
});
