import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { PgTransaction } from 'drizzle-orm/pg-core';
import type { Pool } from 'pg';

/*
 * Drizzle ORM's type parameters require `any` to express
 * "any database schema" without constraining callers to a specific schema.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
type DrizzleDB = NodePgDatabase<any>;
type DrizzleTx = PgTransaction<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

const WAITING_LOG_INTERVAL_MS = 10_000;

/** Transaction-scoped advisory lock, released when the transaction ends. */
export const withTransactionLock = async <T>(
  db: DrizzleDB | DrizzleTx,
  lockKey: string,
  callback: (tx: DrizzleTx) => Promise<T>,
): Promise<T> => {
  if (db instanceof PgTransaction) {
    await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
    return callback(db);
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
    return callback(tx);
  });
};

/**
 * Session-scoped advisory lock held for the whole callback. Acquisition blocks
 * until granted (no timeout); PostgreSQL releases the lock when the callback ends
 * or the connection drops (e.g. on crash). `onWaiting` fires while blocked on a
 * held lock (immediately, then every ~10s).
 */
export const withSessionLock = async <T>(
  pool: Pool,
  lockKey: string,
  callback: () => Promise<T>,
  onWaiting?: (elapsedMs: number) => void,
): Promise<T> => {
  const client = await pool.connect();
  try {
    const acquiredImmediately = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
      [lockKey],
    );

    if (!acquiredImmediately.rows[0]?.locked) {
      const startedAt = Date.now();
      let waitTimer: ReturnType<typeof setInterval> | undefined;
      if (onWaiting) {
        onWaiting(0);
        waitTimer = setInterval(() => onWaiting(Date.now() - startedAt), WAITING_LOG_INTERVAL_MS);
      }
      try {
        await client.query('SELECT pg_advisory_lock(hashtext($1))', [lockKey]);
      } finally {
        if (waitTimer) {
          clearInterval(waitTimer);
        }
      }
    }

    return await callback();
  } finally {
    let unlockFailed = false;
    try {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]);
    } catch {
      // Best-effort release: never let an unlock failure mask an error thrown by
      // the callback. Destroy the connection below so PostgreSQL frees the lock
      // when the session closes, rather than returning a still-locked client.
      unlockFailed = true;
    } finally {
      client.release(unlockFailed);
    }
  }
};
