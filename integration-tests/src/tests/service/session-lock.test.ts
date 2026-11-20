import { withSessionLock } from '@app/utils';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { pool } from '../../setup/db';
import { getWorkerDbName, pgConfig } from '../../setup/pg-config';

const sleep = (ms: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, ms);
});

const waitFor = async (condition: () => boolean, maxMs = 2_000) => {
  const deadline = Date.now() + maxMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error('waitFor timeout');
    }
    await sleep(10);
  }
};

const makeGate = () => {
  let open = () => undefined as void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
};

describe('withSessionLock', () => {
  it('serializes concurrent holders of the same key', async () => {
    const order: Array<string> = [];
    const gate = makeGate();

    const first = withSessionLock(pool, 'test_lock_serialize', async () => {
      order.push('first:start');
      await gate.opened;
      order.push('first:end');
    });

    await waitFor(() => order.includes('first:start'));

    const second = withSessionLock(pool, 'test_lock_serialize', () => {
      order.push('second:start');
      return Promise.resolve();
    });

    await sleep(200); // `second` must still be blocked while `first` holds the lock
    expect(order).toEqual(['first:start']);

    gate.open();
    await Promise.all([first, second]);

    expect(order).toEqual(['first:start', 'first:end', 'second:start']);
  });

  it('releases the lock after the callback so a later acquire succeeds', async () => {
    await withSessionLock(pool, 'test_lock_release', () => Promise.resolve());
    const result = await withSessionLock(pool, 'test_lock_release', () => Promise.resolve('acquired'));
    expect(result).toBe('acquired');
  });

  it('does not block acquisitions on a different key', async () => {
    const gate = makeGate();
    let holderAcquired = false;
    const holder = withSessionLock(pool, 'test_lock_key_a', async () => {
      holderAcquired = true;
      await gate.opened;
    });

    await waitFor(() => holderAcquired);

    const result = await withSessionLock(pool, 'test_lock_key_b', () => Promise.resolve('acquired'));
    expect(result).toBe('acquired');

    gate.open();
    await holder;
  });

  it('reports waiting via onWaiting only while actually blocked', async () => {
    // Uncontended acquire: onWaiting must not fire.
    const uncontendedWaits: Array<number> = [];
    await withSessionLock(
      pool,
      'test_lock_wait_uncontended',
      () => Promise.resolve(),
      (elapsedMs) => uncontendedWaits.push(elapsedMs),
    );
    expect(uncontendedWaits).toEqual([]);

    // Contended acquire: onWaiting fires immediately with elapsed 0.
    const gate = makeGate();
    let holderAcquired = false;
    const holder = withSessionLock(pool, 'test_lock_wait_contended', async () => {
      holderAcquired = true;
      await gate.opened;
    });
    await waitFor(() => holderAcquired);

    const contendedWaits: Array<number> = [];
    const waiter = withSessionLock(
      pool,
      'test_lock_wait_contended',
      () => Promise.resolve(),
      (elapsedMs) => contendedWaits.push(elapsedMs),
    );
    await waitFor(() => contendedWaits.length > 0);
    expect(contendedWaits[0]).toBe(0);

    gate.open();
    await Promise.all([holder, waiter]);
  });

  it('grants the lock to a blocked waiter when the holder connection drops (crash)', async () => {
    const holder = new pg.Client({ ...pgConfig, database: getWorkerDbName() });
    await holder.connect();
    await holder.query('SELECT pg_advisory_lock(hashtext($1))', ['test_lock_crash']);

    let acquired = false;
    const waiter = withSessionLock(pool, 'test_lock_crash', () => {
      acquired = true;
      return Promise.resolve('acquired');
    });

    await sleep(300);
    expect(acquired).toBe(false);

    await holder.end(); // holder's session ends, so PostgreSQL releases the lock and wakes the waiter

    await expect(waiter).resolves.toBe('acquired');
    expect(acquired).toBe(true);
  });
});
