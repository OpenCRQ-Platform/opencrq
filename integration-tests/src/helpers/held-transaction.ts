import { sql } from 'drizzle-orm';
import { db } from '../setup/db';

export type HeldTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Runs `write` in a transaction left open until `commit()` is called. A statement meant to contend
 * with the write must await `locked` before it starts: side by side the two reach the row in either
 * order, and when the contender gets there first nothing ever blocks.
 */
export const holdWriteOpen = (write: (tx: HeldTx) => Promise<unknown>) => {
  let commit = (): void => {};
  const held = new Promise<void>((resolve) => {
    commit = resolve;
  });
  let lock = (): void => {};
  const locked = new Promise<void>((resolve) => {
    lock = resolve;
  });
  const done = db.transaction(async (tx) => {
    try {
      await write(tx);
    } finally {
      lock();
    }
    await held;
  });
  return { locked, commit, done };
};

/**
 * Whether some statement is held up by another backend rather than merely slow, polled for up to
 * five seconds: what tells a contender that waits on a held lock from one that never needed it.
 */
export const waitUntilBlockedByAnotherBackend = async (): Promise<boolean> => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const { rows } = await db.execute<{ blocked: number }>(sql`
      SELECT count(*)::int AS blocked
      FROM pg_stat_activity
      WHERE datname = current_database() AND cardinality(pg_blocking_pids(pid)) > 0
    `);
    if ((rows[0]?.blocked ?? 0) > 0) {
      return true;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });
  }
  return false;
};
