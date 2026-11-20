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

/** uuidv7 ids sort in booking order, so the last row is always the newest. */
const allRuns = () => db
  .select()
  .from(jobsTable)
  .where(eq(jobsTable.kind, 'noop'))
  .orderBy(asc(jobsTable.id));

const jobs = () => services.withOrigin(SYSTEM_ORIGIN).jobs;

const book = (payload: Record<string, unknown> = {}, interactive = false) =>
  jobs().enqueueJob({ kind: 'noop', tenantId, payload, idempotencyKey: KEY, interactive });

const NO_RETRY_DELAY = () => 0;

const expireLease = (jobId: string) =>
  db.execute(sql`UPDATE jobs SET leased_until = now() - interval '1 second' WHERE id = ${jobId}`);

let tenantId: string;

describe('jobs follow-up after absorption', () => {
  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    tenantId = setup.tenantId;
  });

  it('starts no second run while the one holding the key is still running', async () => {
    const first = await book();
    await jobs().claimNext('w1', ['noop'], 30_000);

    const absorbed = await book();

    expect(absorbed.jobId).toBe(first.jobId);
    expect(absorbed.alreadyExisted).toBe(true);
    const runs = await allRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe('running');
  });

  it('queues one run for the ask the finished one had absorbed', async () => {
    const first = await book({ scenario: 42 });
    await jobs().claimNext('w1', ['noop'], 30_000);
    await book({ scenario: 42 });

    await jobs().recordSuccess(first.jobId, 'w1');

    const runs = await allRuns();
    expect(runs).toHaveLength(2);
    const followUp = runs[1];
    expect(followUp?.status).toBe('queued');
    expect(followUp?.idempotencyKey).toBe(KEY);
    expect(followUp?.payload).toEqual({ scenario: 42 });
  });

  it('queues one run for an ask absorbed on the payload key alone', async () => {
    const first = await jobs().enqueueJob({ kind: 'noop', tenantId, payload: { scenario: 42 } });
    await jobs().claimNext('w1', ['noop'], 30_000);
    await jobs().enqueueJob({ kind: 'noop', tenantId, payload: { scenario: 42 } });

    await jobs().recordSuccess(first.jobId, 'w1');

    const runs = await allRuns();
    expect(runs).toHaveLength(2);
    expect(runs[1]?.idempotencyKey).toBeNull();
    expect(runs[1]?.payload).toEqual({ scenario: 42 });
  });

  // `triggered_by` is the audit of who asked, and the fold kept no asker. So the answering run is
  // booked under the platform, pointing back at the run that owed it.
  it('books the answering run under the platform, linked to the run that owed it', async () => {
    const first = await jobs().enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
      idempotencyKey: KEY,
      triggeredBy: 'event',
      triggeredById: 'some-write',
    });
    await jobs().claimNext('w1', ['noop'], 30_000);
    await book();

    await jobs().recordSuccess(first.jobId, 'w1');

    const runs = await allRuns();
    expect(runs[1]?.triggeredBy).toBe('system');
    expect(runs[1]?.triggeredById).toBe(first.jobId);
  });

  it('queues one run for three asks absorbed by the same execution', async () => {
    const first = await book();
    await jobs().claimNext('w1', ['noop'], 30_000);
    await book();
    await book();
    await book();

    await jobs().recordSuccess(first.jobId, 'w1');

    expect(await allRuns()).toHaveLength(2);
  });

  it('starts the follow-up clean rather than resuming the run that booked it', async () => {
    const first = await jobs().enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
      idempotencyKey: KEY,
      stateSnapshot: { startIndex: 5000 },
    });
    await jobs().claimNext('w1', ['noop'], 30_000);
    await book();

    await jobs().recordSuccess(first.jobId, 'w1');

    const runs = await allRuns();
    expect(runs[0]?.stateSnapshot).toEqual({ startIndex: 5000 });
    expect(runs[1]?.stateSnapshot).toBeNull();
  });

  it('queues nothing after a run that absorbed an ask while still queued', async () => {
    const first = await book();
    await book();
    await jobs().claimNext('w1', ['noop'], 30_000);

    await jobs().recordSuccess(first.jobId, 'w1');

    expect(await allRuns()).toHaveLength(1);
  });

  it('owes the ask when the queued run it folds into will resume instead of starting clean', async () => {
    const first = await jobs().enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
      idempotencyKey: KEY,
      stateSnapshot: { startIndex: 5000 },
    });
    await book();
    await jobs().claimNext('w1', ['noop'], 30_000);

    await jobs().recordSuccess(first.jobId, 'w1');

    expect(await allRuns()).toHaveLength(2);
  });

  it('queues nothing after a run that absorbed no ask', async () => {
    const first = await book();
    await jobs().claimNext('w1', ['noop'], 30_000);

    await jobs().recordSuccess(first.jobId, 'w1');

    expect(await allRuns()).toHaveLength(1);
  });

  it('ends the chain on the run that absorbs nothing', async () => {
    const first = await book();
    await jobs().claimNext('w1', ['noop'], 30_000);
    await book();
    await jobs().recordSuccess(first.jobId, 'w1');

    const second = await jobs().claimNext('w1', ['noop'], 30_000);
    await book();
    await jobs().recordSuccess(second!.id, 'w1');

    const third = await jobs().claimNext('w1', ['noop'], 30_000);
    await jobs().recordSuccess(third!.id, 'w1');

    expect(await allRuns()).toHaveLength(3);
  });

  it('queues the follow-up when the run that absorbed the ask is cancelled', async () => {
    const first = await book();
    await jobs().claimNext('w1', ['noop'], 30_000);
    await book();

    await jobs().recordCancelled(first.jobId, 'w1');

    const runs = await allRuns();
    expect(runs).toHaveLength(2);
    expect(runs[0]?.status).toBe('cancelled');
    expect(runs[1]?.status).toBe('queued');
  });

  it('queues the follow-up when the run that absorbed the ask lands in the dead-letter queue', async () => {
    const first = await jobs().enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
      idempotencyKey: KEY,
      maxAttempts: 1,
    });
    await jobs().claimNext('w1', ['noop'], 30_000);
    await book();

    const outcome = await jobs().recordFailure(first.jobId, 'w1', { message: 'boom' }, false, NO_RETRY_DELAY);

    expect(outcome.outcome).toBe('dlq');
    const runs = await allRuns();
    expect(runs).toHaveLength(2);
    expect(runs[0]?.status).toBe('dlq');
    expect(runs[1]?.status).toBe('queued');
  });

  it('queues the follow-up when the reaper sends the run that absorbed the ask to the dead-letter queue', async () => {
    const first = await jobs().enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
      idempotencyKey: KEY,
      maxAttempts: 1,
    });
    await jobs().claimNext('crashed-worker', ['noop'], 30_000);
    await book();
    await expireLease(first.jobId);

    const reaped = await jobs().reapOrphans();

    expect(reaped.dlqed).toBe(1);
    const runs = await allRuns();
    expect(runs).toHaveLength(2);
    expect(runs[0]?.status).toBe('dlq');
    expect(runs[1]?.status).toBe('queued');
  });

  // The three ways back to `queued` all hand the ask to the attempt that follows, which answers it
  // by reading afresh. Nothing is owed on top of that.
  it('answers the ask through the attempt that follows a retry', async () => {
    const first = await book();
    await jobs().claimNext('w1', ['noop'], 30_000);
    await book();

    const outcome = await jobs().recordFailure(first.jobId, 'w1', { message: 'transient' }, true, NO_RETRY_DELAY);
    expect(outcome.outcome).toBe('retry');

    await jobs().claimNext('w1', ['noop'], 30_000);
    await jobs().recordSuccess(first.jobId, 'w1');

    expect(await allRuns()).toHaveLength(1);
  });

  it('answers the ask through the attempt that follows a shutdown release', async () => {
    const first = await book();
    await jobs().claimNext('w1', ['noop'], 30_000);
    await book();

    await jobs().releaseClaim(first.jobId, 'w1');
    await jobs().claimNext('w1', ['noop'], 30_000);
    await jobs().recordSuccess(first.jobId, 'w1');

    expect(await allRuns()).toHaveLength(1);
  });

  it('answers the ask through the attempt that follows an orphan requeue', async () => {
    const first = await book();
    await jobs().claimNext('crashed-worker', ['noop'], 30_000);
    await book();
    await expireLease(first.jobId);

    const reaped = await jobs().reapOrphans();
    expect(reaped.requeued).toBe(1);

    await jobs().claimNext('w1', ['noop'], 30_000);
    await jobs().recordSuccess(first.jobId, 'w1');

    expect(await allRuns()).toHaveLength(1);
  });

  // Unless that attempt resumes: the pages read before the ask are not read again for it.
  it('keeps the ask owed when the attempt that follows a retry will resume', async () => {
    const first = await jobs().enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
      idempotencyKey: KEY,
      stateSnapshot: { startIndex: 40_000 },
    });
    await jobs().claimNext('w1', ['noop'], 30_000);
    await book();

    await jobs().recordFailure(first.jobId, 'w1', { message: 'transient' }, true, NO_RETRY_DELAY);
    await jobs().claimNext('w1', ['noop'], 30_000);
    await jobs().recordSuccess(first.jobId, 'w1');

    const runs = await allRuns();
    expect(runs).toHaveLength(2);
    expect(runs[1]?.stateSnapshot).toBeNull();
  });

  // The run this one booked answered what it absorbed, so the row comes back out of the
  // dead-letter queue owing nothing.
  it('queues no follow-up for a dead-lettered run that is retried', async () => {
    const first = await jobs().enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
      idempotencyKey: KEY,
      maxAttempts: 1,
    });
    await jobs().claimNext('w1', ['noop'], 30_000);
    await book();
    await jobs().recordFailure(first.jobId, 'w1', { message: 'boom' }, false, NO_RETRY_DELAY);
    const followUp = (await allRuns())[1];
    await jobs().claimNext('w1', ['noop'], 30_000);
    await jobs().recordSuccess(followUp.id, 'w1');

    await jobs().retryFromDlq(first.jobId);
    await jobs().claimNext('w1', ['noop'], 30_000);
    await jobs().recordSuccess(first.jobId, 'w1');

    expect(await allRuns()).toHaveLength(2);
  });

  // Cancelling the run does not cancel the ask somebody else's save made: it was folded into a run
  // that had already read its inputs, and a row cancelled before it started never held the key.
  it('answers the ask when a requeued run carrying it is cancelled', async () => {
    const first = await jobs().enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
      idempotencyKey: KEY,
      stateSnapshot: { startIndex: 40_000 },
    });
    await jobs().claimNext('w1', ['noop'], 30_000);
    await book();
    await jobs().recordFailure(first.jobId, 'w1', { message: 'transient' }, true, NO_RETRY_DELAY);

    await jobs().cancelJob(first.jobId);

    const runs = await allRuns();
    expect(runs).toHaveLength(2);
    expect(runs[0]?.status).toBe('cancelled');
    expect(runs[1]?.status).toBe('queued');
  });

  // The other half of the same call answers a delete, and there the ask is moot: the entity the
  // runs were pricing is gone.
  it('answers nothing when a delete cancels the runs it made pointless', async () => {
    const payload = { riskScenarioId: '0199e2b1-0000-7000-8000-00000000cafe' };
    const first = await jobs().enqueueJob({
      kind: 'noop',
      tenantId,
      payload,
      idempotencyKey: KEY,
      stateSnapshot: { startIndex: 40_000 },
    });
    await jobs().claimNext('w1', ['noop'], 30_000);
    await jobs().enqueueJob({ kind: 'noop', tenantId, payload, idempotencyKey: KEY });
    await jobs().recordFailure(first.jobId, 'w1', { message: 'transient' }, true, NO_RETRY_DELAY);

    await jobs().cancelByPayloadId('noop', 'riskScenarioId', [payload.riskScenarioId]);

    expect(await allRuns()).toHaveLength(1);
  });

  it('carries the absorbed ask onto the follow-up when somebody waits on it', async () => {
    const first = await book();
    await jobs().claimNext('w1', ['noop'], 30_000);
    await book({}, true);

    await jobs().recordSuccess(first.jobId, 'w1');

    const runs = await allRuns();
    expect(runs[0]?.interactive).toBe(false);
    expect(runs[1]?.interactive).toBe(true);
  });

  it('leaves the follow-up on the coarse window when no ask was waited on', async () => {
    const first = await book();
    await jobs().claimNext('w1', ['noop'], 30_000);
    await book();

    await jobs().recordSuccess(first.jobId, 'w1');

    expect((await allRuns())[1]?.interactive).toBe(false);
  });

  // A cancel the worker has not read yet when the run would go back to `queued` wins over the
  // requeue, which would otherwise clear it and run the job again.
  describe('a cancel pending when the run would go back to the queue', () => {
    const bookCancelledWhileRunning = async () => {
      const first = await book();
      await jobs().claimNext('w1', ['noop'], 30_000);
      await book();
      await jobs().cancelJob(first.jobId);
      return first.jobId;
    };

    it('cancels the run a retryable failure would retry, and answers the ask its handler no longer writes', async () => {
      const jobId = await bookCancelledWhileRunning();

      const outcome = await jobs().recordFailure(jobId, 'w1', { message: 'transient' }, true, NO_RETRY_DELAY);

      expect(outcome.outcome).toBe('cancelled');
      const runs = await allRuns();
      expect(runs.map((run) => run.status)).toEqual(['cancelled', 'queued']);
    });

    it('leaves the answer to the runtime when the handler of the failed run may still be writing', async () => {
      const jobId = await bookCancelledWhileRunning();

      const outcome = await jobs().recordFailure(jobId, 'w1', { message: 'Aborted: unknown' }, true, NO_RETRY_DELAY, true);

      expect(outcome.outcome).toBe('cancelled');
      const runs = await allRuns();
      expect(runs.map((run) => run.status)).toEqual(['cancelled']);
    });

    it('cancels the run a shutdown would release, leaving the answer to the runtime', async () => {
      const jobId = await bookCancelledWhileRunning();

      const outcome = await jobs().releaseClaim(jobId, 'w1');

      expect(outcome.outcome).toBe('cancelled');
      const runs = await allRuns();
      expect(runs.map((run) => run.status)).toEqual(['cancelled']);
    });

    it('cancels an orphan the reaper would requeue, and answers its ask', async () => {
      const jobId = await bookCancelledWhileRunning();
      await expireLease(jobId);

      const reaped = await jobs().reapOrphans();

      expect(reaped).toEqual({ requeued: 0, dlqed: 0, cancelled: 1 });
      const runs = await allRuns();
      expect(runs.map((run) => run.status)).toEqual(['cancelled', 'queued']);
    });

    it('still reports a lost race to a worker that no longer holds the run', async () => {
      const jobId = await bookCancelledWhileRunning();

      const outcome = await jobs().releaseClaim(jobId, 'w2');

      expect(outcome.outcome).toBe('lost-race');
      const runs = await allRuns();
      expect(runs.map((run) => run.status)).toEqual(['running']);
    });
  });
});
