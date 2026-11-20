import { sql } from 'drizzle-orm';
import { db } from '../setup/db';

export type OverlappingTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const BLOCKED_WAIT_MS = 5_000;
const POLL_MS = 20;

export const backendPid = async (tx: OverlappingTransaction): Promise<number> => {
  const { rows } = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
  return rows[0].pid;
};

/**
 * Resolves with `true` once the backend `waiter` waits on a lock `holder` holds, or with `false` as
 * soon as `finished()` says the waiter is done without having waited. Throws past the wait it allows.
 */
export const untilBlockedOn = async (
  waiter: () => number | undefined,
  holder: number,
  finished: () => boolean = () => false,
): Promise<boolean> => {
  const deadline = Date.now() + BLOCKED_WAIT_MS;
  while (Date.now() < deadline) {
    if (finished()) {
      return false;
    }
    const waiterPid = waiter();
    if (waiterPid !== undefined) {
      const { rows } = await db.execute<{ waiting: boolean }>(sql`
        select ${holder}::int = any(pg_blocking_pids(${waiterPid}::int)) as waiting
      `);
      if (rows[0].waiting) {
        return true;
      }
    }
    await new Promise((resolve) => {
      setTimeout(resolve, POLL_MS);
    });
  }
  throw new Error(`Backend ${waiter() ?? '(not started)'} never waited on ${holder}`);
};

/**
 * Runs `second` in its own transaction while `first`'s is written and still open, and commits
 * `first` once `second` waits on it, which is the interleaving a stored value kept by a trigger has
 * to survive: each side derives it from a log that does not hold the other's row yet. Throws when
 * `second` never waits, since the test would then have run the two writes one after the other.
 */
export const overlappingWrites = async (
  first: (tx: OverlappingTransaction) => Promise<unknown>,
  second: (tx: OverlappingTransaction) => Promise<unknown>,
): Promise<void> => {
  let commitFirst!: () => void;
  let firstWritten!: () => void;
  let firstPid!: number;
  const mayCommit = new Promise<void>((resolve) => {
    commitFirst = resolve;
  });
  const written = new Promise<void>((resolve) => {
    firstWritten = resolve;
  });

  const firstTransaction = db.transaction(async (tx) => {
    firstPid = await backendPid(tx);
    await first(tx);
    firstWritten();
    await mayCommit;
  });
  await written;

  let secondPid: number | undefined;
  let secondDone = false;
  const secondTransaction = db.transaction(async (tx) => {
    secondPid = await backendPid(tx);
    await second(tx);
  });
  const markDone = () => {
    secondDone = true;
  };
  secondTransaction.then(markDone, markDone);

  let secondWaited = false;
  try {
    secondWaited = await untilBlockedOn(() => secondPid, firstPid, () => secondDone);
  } finally {
    commitFirst();
    await Promise.allSettled([firstTransaction, secondTransaction]);
  }
  await Promise.all([firstTransaction, secondTransaction]);
  if (!secondWaited) {
    throw new Error('The second writer never waited on the first, so the writes did not overlap');
  }
};
