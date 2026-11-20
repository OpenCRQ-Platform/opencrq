import type { ClaimedJob, JobContext, JobRunResult } from '@app/module';
import { deferralPolicyFor } from '@app/module';
import { describe, expect, it, vi } from 'vitest';
import type { ExecuteJobOptions, ExecutionJobsService } from './execution-loop';
import { executeJob } from './execution-loop';
import { HandlerRegistry } from './handler-registry';

const TEST_DEFERRAL_POLICY = deferralPolicyFor(1_000);

const KIND = 'continuation-handler';

const baseJob = (): ClaimedJob => ({
  id: 'job-1',
  tenantId: 'tenant-1',
  kind: KIND,
  payload: { serviceAccountId: 'sa-1' },
  attempt: 2,
  maxAttempts: 5,
  maxRuntimeMs: 30 * 60 * 1000,
  bounded: true,
  triggeredBy: 'user',
  triggeredById: 'user-1',
  interactive: true,
  stateSnapshot: { startIndex: 1_000 },
  processedTotal: 0,
  expectedTotal: null,
  leasedUntil: new Date(Date.now() + 30_000),
});

const stubJobsService = (): ExecutionJobsService => ({
  enqueueJob: vi.fn().mockResolvedValue({ jobId: 'other-1', alreadyExisted: false }),
  renewLease: vi.fn().mockResolvedValue(undefined),
  recordSuccess: vi.fn().mockResolvedValue({ recorded: true, bookedJobId: 'successor-1' }),
  recordFailure: vi.fn().mockResolvedValue({ outcome: 'dlq' }),
  recordCancelled: vi.fn().mockResolvedValue({ recorded: true }),
  releaseClaim: vi.fn().mockResolvedValue({ outcome: 'released' }),
  deferRun: vi.fn().mockResolvedValue({ outcome: 'lost-race' }),
  isAbortRequested: vi.fn().mockResolvedValue(false),
  updateProgress: vi.fn().mockResolvedValue(undefined),
  saveStateSnapshot: vi.fn().mockResolvedValue(undefined),
});

const runWith = async (
  handler: (ctx: JobContext) => Promise<JobRunResult | void>,
  hooks: Pick<ExecuteJobOptions, 'onContinuation' | 'onAnswered'> = {},
): Promise<ExecutionJobsService> => {
  const jobsService = stubJobsService();
  const registry = new HandlerRegistry();
  registry.register(KIND, handler);
  await executeJob({
    job: baseJob(),
    workerId: 'test-worker',
    jobsService,
    handlerRegistry: registry,
    engineSignal: new AbortController().signal,
    deferralPolicy: TEST_DEFERRAL_POLICY,
    leaseRenewIntervalMs: 1_000,
    abortPollIntervalMs: 1_000,
    ...hooks,
  });
  return jobsService;
};

/**
 * What the run leaves behind is inserted by the queue, in the transaction that ends the run: while
 * the run held the key its own successor would have been folded into it. So what is checked here is
 * the one thing the runtime knows, whether the handler asked to continue, and that it books nothing
 * of its own. The row's contents belong to `runtime/job-continuation.test.ts`.
 */
describe('executeJob continuation booking', () => {
  it('hands the state the run stopped at to the transition that ends it', async () => {
    const jobsService = await runWith(() =>
      Promise.resolve({ continuation: true, state: { startIndex: 59_500 } }));

    expect(jobsService.recordSuccess).toHaveBeenCalledWith('job-1', 'test-worker', { state: { startIndex: 59_500 } });
    expect(jobsService.enqueueJob).not.toHaveBeenCalled();
  });

  it('asks for a continuation even when the handler hands over no state', async () => {
    const jobsService = await runWith(() => Promise.resolve({ continuation: true }));

    expect(jobsService.recordSuccess).toHaveBeenCalledWith('job-1', 'test-worker', { state: undefined });
  });

  it('asks for none when the run finished the work', async () => {
    const jobsService = await runWith(() => Promise.resolve({ continuation: false }));

    expect(jobsService.recordSuccess).toHaveBeenCalledWith('job-1', 'test-worker', undefined);
    expect(jobsService.enqueueJob).not.toHaveBeenCalled();
  });

  it('asks for none when the handler answers nothing at all', async () => {
    const jobsService = await runWith(() => Promise.resolve());

    expect(jobsService.recordSuccess).toHaveBeenCalledWith('job-1', 'test-worker', undefined);
  });

  it('reports the continuation the queue booked', async () => {
    const onContinuation = vi.fn();
    const onAnswered = vi.fn();
    await runWith(() => Promise.resolve({ continuation: true }), { onContinuation, onAnswered });

    expect(onContinuation).toHaveBeenCalledWith('job-1', KIND, 'successor-1');
    expect(onAnswered).not.toHaveBeenCalled();
  });

  // The same `bookedJobId`, with the other meaning: no continuation was asked for, so the run the
  // queue booked is the one answering what this run absorbed.
  it('reports an answering run as an answer, not as a continuation', async () => {
    const onContinuation = vi.fn();
    const onAnswered = vi.fn();
    await runWith(() => Promise.resolve(), { onContinuation, onAnswered });

    expect(onAnswered).toHaveBeenCalledWith('job-1', KIND, 'successor-1');
    expect(onContinuation).not.toHaveBeenCalled();
  });
});
