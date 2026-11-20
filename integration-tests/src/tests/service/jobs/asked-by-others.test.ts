import type { EventOrigin } from '@app/module';
import { jobs as jobsTable } from '@app/module';
import { asc, eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantWithAdmin } from '../../../helpers/factories';
import { db } from '../../../setup/db';
import { createTestServices, truncateAllTables } from '../../../setup/test-context';

const services = createTestServices(db);
const SYSTEM_ORIGIN: EventOrigin = { type: 'system' };
const KEY = 'scenario-42';
const ALICE = { triggeredBy: 'user', triggeredById: 'alice' } as const;
const BOB = { triggeredBy: 'user', triggeredById: 'bob' } as const;

const jobs = () => services.withOrigin(SYSTEM_ORIGIN).jobs;

const book = (asker: { triggeredBy?: 'user' | 'scheduler', triggeredById?: string }, skipIfActive = false) =>
  jobs().enqueueJob({ kind: 'noop', tenantId, payload: {}, idempotencyKey: KEY, skipIfActive, ...asker });

/** uuidv7 ids sort in booking order, so the last row is always the newest. */
const allRuns = () => db.select().from(jobsTable).where(eq(jobsTable.kind, 'noop')).orderBy(asc(jobsTable.id));

const askedByOthersOf = async (jobId: string) => (await jobs().getJob(jobId))?.askedByOthers;

/**
 * Gives a call under test the time to reach a lock another transaction already holds. It is a
 * synchronisation and never a verdict: a caller that took no lock simply runs to completion here,
 * and what judges it is the state it leaves behind.
 */
const waitUntilHeldUp = async (): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const { rows } = await db.execute<{ blocked: number }>(sql`
      SELECT count(*)::int AS blocked
      FROM pg_stat_activity
      WHERE datname = current_database() AND cardinality(pg_blocking_pids(pid)) > 0
    `);
    if ((rows[0]?.blocked ?? 0) > 0) {
      return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });
  }
};

let tenantId: string;

describe('jobs asked_by_others', () => {
  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    tenantId = setup.tenantId;
  });

  it('should leave a queued run unmarked when its own asker folds into it', async () => {
    const first = await book(ALICE);
    await book(ALICE);

    expect(await askedByOthersOf(first.jobId)).toBe(false);
  });

  it('should mark a queued run another user folds into', async () => {
    const first = await book(ALICE);
    await book(BOB);

    expect(await askedByOthersOf(first.jobId)).toBe(true);
  });

  it('should mark a queued run a skipIfActive ask from the scheduler lands on', async () => {
    const first = await book(ALICE);
    await book({ triggeredBy: 'scheduler' }, true);

    expect(await askedByOthersOf(first.jobId)).toBe(true);
    expect(await allRuns()).toHaveLength(1);
  });

  it('should mark a running run another asker folds into', async () => {
    const first = await book(ALICE);
    await jobs().claimNext('w1', ['noop'], 30_000);
    await book(BOB);

    expect(await askedByOthersOf(first.jobId)).toBe(true);
  });

  it('should keep the mark on the continuation of a marked run', async () => {
    const first = await book(ALICE);
    await jobs().claimNext('w1', ['noop'], 30_000);
    await book(BOB);

    const settled = await jobs().recordSuccess(first.jobId, 'w1', { state: { startIndex: 10 } });

    expect(settled.bookedJobId).toBeDefined();
    expect(await askedByOthersOf(settled.bookedJobId!)).toBe(true);
  });

  it('should start the run answering the absorbed asks unmarked', async () => {
    const first = await book(ALICE);
    await jobs().claimNext('w1', ['noop'], 30_000);
    await book(BOB);

    const settled = await jobs().recordSuccess(first.jobId, 'w1');

    expect(settled.bookedJobId).toBeDefined();
    expect(await askedByOthersOf(settled.bookedJobId!)).toBe(false);
  });

  it('should clear the mark when the run is retried from the dead-letter queue', async () => {
    const first = await book(ALICE);
    await book(BOB);
    await jobs().claimNext('w1', ['noop'], 30_000);
    await jobs().recordFailure(first.jobId, 'w1', { message: 'boom' }, false, () => 0);
    expect((await jobs().getJob(first.jobId))?.status).toBe('dlq');
    expect(await askedByOthersOf(first.jobId)).toBe(true);

    await jobs().retryFromDlq(first.jobId);

    expect(await askedByOthersOf(first.jobId)).toBe(false);
  });

  describe('askActiveRuns', () => {
    it('should mark an active run of the kind another asker started, whatever its payload', async () => {
      const first = await jobs().enqueueJob({ kind: 'noop', tenantId, payload: { other: true }, ...ALICE });

      expect(await jobs().askActiveRuns(tenantId, 'noop', { triggeredBy: 'scheduler' })).toBe(true);

      expect(await askedByOthersOf(first.jobId)).toBe(true);
    });

    it('should leave a run the same asker started unmarked', async () => {
      const first = await book({ triggeredBy: 'scheduler' });

      expect(await jobs().askActiveRuns(tenantId, 'noop', { triggeredBy: 'scheduler' })).toBe(true);

      expect(await askedByOthersOf(first.jobId)).toBe(false);
    });

    it('should answer that no run is active once the kind has none', async () => {
      expect(await jobs().askActiveRuns(tenantId, 'noop', { triggeredBy: 'scheduler' })).toBe(false);
    });

    it('should read the runs under their row lock when a cancel lands while the ask waits', async () => {
      const first = await book(ALICE);
      let commitHolder = (): void => {};
      const held = new Promise<void>((resolve) => {
        commitHolder = resolve;
      });
      let signalLocked = (): void => {};
      const locked = new Promise<void>((resolve) => {
        signalLocked = resolve;
      });
      // The held transaction stands for the starter's cancel, which has the row and cancels it before it commits.
      const holder = db.transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM jobs WHERE id = ${first.jobId} FOR UPDATE`);
        signalLocked();
        await held;
        await tx.update(jobsTable).set({ status: 'cancelled' }).where(eq(jobsTable.id, first.jobId));
      });
      await locked;

      const asked = jobs().askActiveRuns(tenantId, 'noop', { triggeredBy: 'scheduler' });
      await waitUntilHeldUp();
      commitHolder();
      await holder;

      expect(await asked).toBe(false);
      expect(await askedByOthersOf(first.jobId)).toBe(false);
    });
  });

  it('should mark the run that holds the key when a successor of a kind without a payload fold finds it taken', async () => {
    const first = await book(ALICE);
    await jobs().claimNext('w1', ['noop'], 30_000);
    await book(BOB);
    await jobs().cancelJob(first.jobId);
    await jobs().recordCancelled(first.jobId, 'w1', true);
    const replacement = await book(ALICE);
    expect(await askedByOthersOf(replacement.jobId)).toBe(false);

    const booked = await jobs().answerAbsorbedAsk(first.jobId);

    expect(booked).toBeUndefined();
    expect(await askedByOthersOf(replacement.jobId)).toBe(true);
  });

  describe('cancelJob with refuseIfShared', () => {
    it('should leave a marked queued run untouched and answer shared', async () => {
      const first = await book(ALICE);
      await book(BOB);

      const outcome = await jobs().cancelJob(first.jobId, { refuseIfShared: true });

      expect(outcome).toBe('shared');
      expect((await jobs().getJob(first.jobId))?.status).toBe('queued');
    });

    it('should cancel an unmarked queued run', async () => {
      const first = await book(ALICE);

      const outcome = await jobs().cancelJob(first.jobId, { refuseIfShared: true });

      expect(outcome).toBe('cancelled');
      expect((await jobs().getJob(first.jobId))?.status).toBe('cancelled');
    });

    it('should drop the asks a running run absorbed from its own starter', async () => {
      const first = await book(ALICE);
      await jobs().claimNext('w1', ['noop'], 30_000);
      await book(ALICE);
      expect((await jobs().getJob(first.jobId))?.absorbedAsk).toBe(true);

      expect(await jobs().cancelJob(first.jobId, { refuseIfShared: true })).toBe('cancelled');
      await jobs().recordCancelled(first.jobId, 'w1', true);
      const booked = await jobs().answerAbsorbedAsk(first.jobId);

      expect(booked).toBeUndefined();
      expect(await allRuns()).toHaveLength(1);
    });

    it('should drop the asks a queued run absorbed from its own starter', async () => {
      const first = await book(ALICE);
      await jobs().claimNext('w1', ['noop'], 30_000);
      await jobs().saveStateSnapshot(first.jobId, 'w1', { startIndex: 10 });
      await jobs().recordFailure(first.jobId, 'w1', { message: 'boom' }, true, () => 0);
      await book(ALICE);
      expect((await jobs().getJob(first.jobId))?.absorbedAsk).toBe(true);

      await jobs().cancelJob(first.jobId, { refuseIfShared: true });

      expect(await allRuns()).toHaveLength(1);
    });

    it('should still answer the absorbed asks when the cancel does not refuse a shared run', async () => {
      const first = await book(ALICE);
      await jobs().claimNext('w1', ['noop'], 30_000);
      await book(ALICE);

      await jobs().cancelJob(first.jobId);
      await jobs().recordCancelled(first.jobId, 'w1', true);
      const booked = await jobs().answerAbsorbedAsk(first.jobId);

      expect(booked).toBeDefined();
    });

    it('should read the mark under the row lock when a fold lands while the cancel waits', async () => {
      const first = await book(ALICE);
      let commitHolder = (): void => {};
      const held = new Promise<void>((resolve) => {
        commitHolder = resolve;
      });
      let signalLocked = (): void => {};
      const locked = new Promise<void>((resolve) => {
        signalLocked = resolve;
      });
      // The held transaction stands for a fold that has the row and marks it before it commits.
      const holder = db.transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM jobs WHERE id = ${first.jobId} FOR UPDATE`);
        signalLocked();
        await held;
        await tx.update(jobsTable).set({ askedByOthers: true }).where(eq(jobsTable.id, first.jobId));
      });
      await locked;

      let settled = false;
      const cancel = jobs().cancelJob(first.jobId, { refuseIfShared: true }).finally(() => {
        settled = true;
      });
      await waitUntilHeldUp();
      expect(settled).toBe(false);
      commitHolder();
      await holder;

      expect(await cancel).toBe('shared');
      expect((await jobs().getJob(first.jobId))?.status).toBe('queued');
    });
  });
});
