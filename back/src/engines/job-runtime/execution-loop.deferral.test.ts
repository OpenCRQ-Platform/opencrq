import type { ClaimedJob, DeferOutcome, JobContext } from '@app/module';
import { deferralPolicyFor, InputsNotReadyError, NonRetryableError } from '@app/module';
import { describe, expect, it, vi } from 'vitest';
import type { ExecuteJobOptions, ExecutionJobsService } from './execution-loop';
import { executeJob } from './execution-loop';
import { HandlerRegistry } from './handler-registry';

const TEST_DEFERRAL_POLICY = deferralPolicyFor(1_000);

const KIND = 'deferral-handler';

const baseJob = (): ClaimedJob => ({
  id: 'job-1',
  tenantId: 'tenant-1',
  kind: KIND,
  payload: {},
  attempt: 1,
  maxAttempts: 3,
  maxRuntimeMs: 30 * 60 * 1000,
  bounded: true,
  triggeredBy: 'user',
  triggeredById: 'user-1',
  interactive: true,
  stateSnapshot: null,
  processedTotal: 0,
  expectedTotal: null,
  leasedUntil: new Date(Date.now() + 30_000),
});

const stubJobsService = (deferOutcome: DeferOutcome): ExecutionJobsService => ({
  enqueueJob: vi.fn().mockResolvedValue({ jobId: 'other-1', alreadyExisted: false }),
  renewLease: vi.fn().mockResolvedValue(undefined),
  recordSuccess: vi.fn().mockResolvedValue({ recorded: true }),
  recordFailure: vi.fn().mockResolvedValue({ outcome: 'dlq' }),
  recordCancelled: vi.fn().mockResolvedValue({ recorded: true }),
  releaseClaim: vi.fn().mockResolvedValue({ released: true }),
  deferRun: vi.fn().mockResolvedValue(deferOutcome),
  isAbortRequested: vi.fn().mockResolvedValue(false),
  updateProgress: vi.fn().mockResolvedValue(undefined),
  saveStateSnapshot: vi.fn().mockResolvedValue(undefined),
});

const runWith = async (
  error: Error,
  deferOutcome: DeferOutcome,
  hooks: Pick<ExecuteJobOptions, 'onDeferred' | 'onJobFailure' | 'onTerminal' | 'onLostRace'> = {},
): Promise<ExecutionJobsService> => {
  const jobsService = stubJobsService(deferOutcome);
  const registry = new HandlerRegistry();
  registry.register(KIND, (_ctx: JobContext) => Promise.reject(error));
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

describe('executeJob deferral', () => {
  it('should put the run back in the queue without recording a failure when its inputs are not ready', async () => {
    const runAfter = new Date('2030-01-01T00:00:02Z');
    const error = new InputsNotReadyError('mixture not computed yet');
    const onDeferred = vi.fn();
    const onJobFailure = vi.fn();
    const onTerminal = vi.fn();

    const jobsService = await runWith(error, { outcome: 'deferred', runAfter, delayMs: 2_000 }, { onDeferred, onJobFailure, onTerminal });

    expect(jobsService.deferRun).toHaveBeenCalledWith('job-1', 'test-worker', TEST_DEFERRAL_POLICY);
    expect(jobsService.recordFailure).not.toHaveBeenCalled();
    expect(onDeferred).toHaveBeenCalledWith('job-1', KIND, error, { runAfter, delayMs: 2_000 });
    expect(onJobFailure).not.toHaveBeenCalled();
    expect(onTerminal).not.toHaveBeenCalled();
  });

  it('should send the run to the dead-letter queue as a non-retryable failure once it can no longer wait', async () => {
    const error = new InputsNotReadyError('mixture not computed yet');
    const onDeferred = vi.fn();
    const onJobFailure = vi.fn();

    const jobsService = await runWith(error, { outcome: 'expired' }, { onDeferred, onJobFailure });

    expect(jobsService.recordFailure).toHaveBeenCalledWith(
      'job-1',
      'test-worker',
      expect.objectContaining({ message: 'mixture not computed yet' }),
      false,
      expect.any(Function),
      false,
    );
    expect(onDeferred).not.toHaveBeenCalled();
    expect(onJobFailure).toHaveBeenCalledWith('job-1', KIND, error, 'dlq', null);
  });

  it('should end the run without a failure when a cancel reached it before it could be deferred', async () => {
    const onDeferred = vi.fn();
    const onJobFailure = vi.fn();
    const onTerminal = vi.fn();

    const jobsService = await runWith(
      new InputsNotReadyError('mixture not computed yet'),
      { outcome: 'cancelled', answeringJobId: undefined },
      { onDeferred, onJobFailure, onTerminal },
    );

    expect(jobsService.recordFailure).not.toHaveBeenCalled();
    expect(onDeferred).not.toHaveBeenCalled();
    expect(onJobFailure).not.toHaveBeenCalled();
    expect(onTerminal).toHaveBeenCalledOnce();
  });

  it('should record nothing when the lease was lost before the run could be deferred', async () => {
    const onDeferred = vi.fn();
    const onLostRace = vi.fn();

    const jobsService = await runWith(
      new InputsNotReadyError('mixture not computed yet'),
      { outcome: 'lost-race' },
      { onDeferred, onLostRace },
    );

    expect(jobsService.recordFailure).not.toHaveBeenCalled();
    expect(onDeferred).not.toHaveBeenCalled();
    expect(onLostRace).toHaveBeenCalledWith('job-1', 'defer-after-lease-lost');
  });

  it('should not defer a plain non-retryable error', async () => {
    const jobsService = await runWith(new NonRetryableError('refused for good'), { outcome: 'deferred', runAfter: new Date(), delayMs: 2_000 });

    expect(jobsService.deferRun).not.toHaveBeenCalled();
    expect(jobsService.recordFailure).toHaveBeenCalledOnce();
  });
});
