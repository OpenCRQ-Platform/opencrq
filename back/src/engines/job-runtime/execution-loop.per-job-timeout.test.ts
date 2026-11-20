import type { ClaimedJob } from '@app/module';
import { deferralPolicyFor } from '@app/module';
import { describe, expect, it, vi } from 'vitest';
import type { ExecutionJobsService } from './execution-loop';
import { executeJob } from './execution-loop';
import { HandlerRegistry } from './handler-registry';

const TEST_DEFERRAL_POLICY = deferralPolicyFor(1_000);

const baseJob = (overrides: Partial<ClaimedJob> = {}): ClaimedJob => ({
  id: 'job-1',
  tenantId: 'tenant-1',
  kind: 'slow-handler',
  payload: {},
  attempt: 1,
  maxAttempts: 3,
  maxRuntimeMs: 200,
  bounded: true,
  stateSnapshot: null,
  processedTotal: 0,
  expectedTotal: null,
  leasedUntil: new Date(Date.now() + 30_000),
  triggeredBy: 'system',
  triggeredById: null,
  interactive: false,
  ...overrides,
});

const stubJobsService = (): ExecutionJobsService => ({
  enqueueJob: vi.fn().mockResolvedValue({ jobId: 'continuation-1', alreadyExisted: false }),
  renewLease: vi.fn().mockResolvedValue(undefined),
  recordSuccess: vi.fn().mockResolvedValue({ recorded: true }),
  recordFailure: vi.fn().mockResolvedValue({ outcome: 'retry' }),
  recordCancelled: vi.fn().mockResolvedValue({ recorded: true }),
  releaseClaim: vi.fn().mockResolvedValue({ outcome: 'released' }),
  deferRun: vi.fn().mockResolvedValue({ outcome: 'lost-race' }),
  isAbortRequested: vi.fn().mockResolvedValue(false),
  updateProgress: vi.fn().mockResolvedValue(undefined),
  saveStateSnapshot: vi.fn().mockResolvedValue(undefined),
});

describe('executeJob per-job timeout', () => {
  it('fires recordFailure when a handler exceeds maxRuntimeMs', async () => {
    const registry = new HandlerRegistry();
    registry.register('slow-handler', () => new Promise<void>(() => {}));

    const jobsService = stubJobsService();
    const engineSignal = new AbortController().signal;

    await executeJob({
      job: baseJob({ maxRuntimeMs: 100 }),
      workerId: 'test-worker',
      jobsService,
      handlerRegistry: registry,
      engineSignal,
      deferralPolicy: TEST_DEFERRAL_POLICY,
      leaseRenewIntervalMs: 50,
      abortPollIntervalMs: 50,
    });

    expect(jobsService.recordFailure).toHaveBeenCalledTimes(1);
    expect(jobsService.recordSuccess).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- accessing mock.calls requires cast to vi.fn() return type
    const call = (jobsService.recordFailure as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe('job-1');
    expect(call[1]).toBe('test-worker');
    expect(call[2].message).toMatch(/maxRuntimeMs/);
    expect(call[3]).toBe(true);
  });

  it('ends a timed-out run a cancel reached before its retry as cancelled, owing the answer to its ask', async () => {
    const registry = new HandlerRegistry();
    registry.register('slow-handler', () => new Promise<void>(() => {}));

    const jobsService = stubJobsService();
    vi.mocked(jobsService.recordFailure).mockResolvedValue({ outcome: 'cancelled' });
    const onAnswerOwed = vi.fn();
    const onTerminal = vi.fn();

    await executeJob({
      job: baseJob({ maxRuntimeMs: 100 }),
      workerId: 'test-worker',
      jobsService,
      handlerRegistry: registry,
      engineSignal: new AbortController().signal,
      leaseRenewIntervalMs: 50,
      deferralPolicy: TEST_DEFERRAL_POLICY,
      abortPollIntervalMs: 50,
      onAnswerOwed,
      onTerminal,
    });

    expect(onAnswerOwed).toHaveBeenCalledWith('job-1');
    expect(onTerminal).toHaveBeenCalledOnce();
  });

  it('fires recordSuccess when a handler finishes within maxRuntimeMs', async () => {
    const registry = new HandlerRegistry();
    registry.register('slow-handler', async () => {});

    const jobsService = stubJobsService();
    const engineSignal = new AbortController().signal;

    await executeJob({
      job: baseJob({ maxRuntimeMs: 5_000 }),
      workerId: 'test-worker',
      jobsService,
      handlerRegistry: registry,
      engineSignal,
      deferralPolicy: TEST_DEFERRAL_POLICY,
    });

    expect(jobsService.recordSuccess).toHaveBeenCalledTimes(1);
    expect(jobsService.recordFailure).not.toHaveBeenCalled();
  });

  it('signals handler settlement only once the handler resolves after the timeout abort', async () => {
    const registry = new HandlerRegistry();
    let releaseHandler: () => void = () => {};
    registry.register('slow-handler', () => new Promise<void>((resolve) => {
      releaseHandler = resolve;
    }));

    const jobsService = stubJobsService();
    const onHandlerSettled = vi.fn();

    await executeJob({
      job: baseJob({ maxRuntimeMs: 50 }),
      workerId: 'test-worker',
      jobsService,
      handlerRegistry: registry,
      engineSignal: new AbortController().signal,
      deferralPolicy: TEST_DEFERRAL_POLICY,
      leaseRenewIntervalMs: 25,
      abortPollIntervalMs: 25,
      onHandlerSettled,
    });

    expect(jobsService.recordFailure).toHaveBeenCalledTimes(1);
    expect(onHandlerSettled).not.toHaveBeenCalled();

    releaseHandler();
    await vi.waitFor(() => expect(onHandlerSettled).toHaveBeenCalledTimes(1));
  });

  it('signals handler settlement when no handler is registered for the kind', async () => {
    const onHandlerSettled = vi.fn();

    await executeJob({
      job: baseJob({ kind: 'unregistered' }),
      workerId: 'test-worker',
      jobsService: stubJobsService(),
      handlerRegistry: new HandlerRegistry(),
      engineSignal: new AbortController().signal,
      deferralPolicy: TEST_DEFERRAL_POLICY,
      onHandlerSettled,
    });

    expect(onHandlerSettled).toHaveBeenCalledTimes(1);
  });

  it('fires recordCancelled when isAbortRequested transitions to true mid-handler', async () => {
    const registry = new HandlerRegistry();
    registry.register('slow-handler', (ctx) => new Promise<void>((_resolve, reject) => {
      ctx.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));

    const jobsService = stubJobsService();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- accessing mock method requires cast to vi.fn() return type
    (jobsService.isAbortRequested as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- accessing mock method requires cast to vi.fn() return type
    (jobsService.isAbortRequested as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

    const engineSignal = new AbortController().signal;

    await executeJob({
      job: baseJob({ maxRuntimeMs: 5_000 }),
      workerId: 'test-worker',
      jobsService,
      handlerRegistry: registry,
      engineSignal,
      deferralPolicy: TEST_DEFERRAL_POLICY,
      abortPollIntervalMs: 30,
    });

    expect(jobsService.recordCancelled).toHaveBeenCalledTimes(1);
    expect(jobsService.recordSuccess).not.toHaveBeenCalled();
    expect(jobsService.recordFailure).not.toHaveBeenCalled();
  });
});
