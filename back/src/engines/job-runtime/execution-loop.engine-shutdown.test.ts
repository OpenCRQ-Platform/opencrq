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
  kind: 'engine-shutdown-handler',
  payload: {},
  attempt: 1,
  maxAttempts: 3,
  maxRuntimeMs: 5_000,
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

describe('executeJob engine-shutdown — preempted handlers do not burn attempts', () => {
  it('calls releaseClaim (not recordFailure) when engineSignal aborts mid-handler', async () => {
    const registry = new HandlerRegistry();
    registry.register('engine-shutdown-handler', (ctx) => new Promise<void>((_resolve, reject) => {
      ctx.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));

    const jobsService = stubJobsService();
    const engineController = new AbortController();

    const run = executeJob({
      job: baseJob(),
      workerId: 'test-worker',
      jobsService,
      handlerRegistry: registry,
      engineSignal: engineController.signal,
      deferralPolicy: TEST_DEFERRAL_POLICY,
      leaseRenewIntervalMs: 50,
      abortPollIntervalMs: 50,
    });

    await new Promise((r) => setTimeout(r, 30));
    engineController.abort();
    await run;

    expect(jobsService.releaseClaim).toHaveBeenCalledTimes(1);
    expect(jobsService.releaseClaim).toHaveBeenCalledWith('job-1', 'test-worker');
    expect(jobsService.recordFailure).not.toHaveBeenCalled();
    expect(jobsService.recordSuccess).not.toHaveBeenCalled();
    expect(jobsService.recordCancelled).not.toHaveBeenCalled();
  });

  it('ends a run a cancel reached before the release as cancelled, owing the answer to its ask', async () => {
    const registry = new HandlerRegistry();
    registry.register('engine-shutdown-handler', (ctx) => new Promise<void>((_resolve, reject) => {
      ctx.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));

    const jobsService = stubJobsService();
    vi.mocked(jobsService.releaseClaim).mockResolvedValue({ outcome: 'cancelled' });
    const engineController = new AbortController();
    const onAnswerOwed = vi.fn();
    const onTerminal = vi.fn();

    const run = executeJob({
      job: baseJob(),
      workerId: 'test-worker',
      jobsService,
      handlerRegistry: registry,
      engineSignal: engineController.signal,
      leaseRenewIntervalMs: 50,
      deferralPolicy: TEST_DEFERRAL_POLICY,
      abortPollIntervalMs: 50,
      onAnswerOwed,
      onTerminal,
    });

    await new Promise((r) => setTimeout(r, 30));
    engineController.abort();
    await run;

    expect(onAnswerOwed).toHaveBeenCalledWith('job-1');
    expect(onTerminal).toHaveBeenCalledOnce();
  });

  it('calls releaseClaim when engineSignal is already aborted before executeJob runs', async () => {
    const registry = new HandlerRegistry();
    registry.register('engine-shutdown-handler', (ctx) => new Promise<void>((_resolve, reject) => {
      if (ctx.signal.aborted) {
        reject(new Error('aborted'));
        return;
      }
      ctx.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));

    const jobsService = stubJobsService();
    const engineController = new AbortController();
    engineController.abort();

    await executeJob({
      job: baseJob(),
      workerId: 'test-worker',
      jobsService,
      handlerRegistry: registry,
      engineSignal: engineController.signal,
      deferralPolicy: TEST_DEFERRAL_POLICY,
    });

    expect(jobsService.releaseClaim).toHaveBeenCalledTimes(1);
    expect(jobsService.releaseClaim).toHaveBeenCalledWith('job-1', 'test-worker');
    expect(jobsService.recordFailure).not.toHaveBeenCalled();
  });

  it('does NOT call releaseClaim when the handler completes before any abort', async () => {
    const registry = new HandlerRegistry();
    registry.register('engine-shutdown-handler', async () => {});

    const jobsService = stubJobsService();
    const engineController = new AbortController();

    await executeJob({
      job: baseJob(),
      workerId: 'test-worker',
      jobsService,
      handlerRegistry: registry,
      engineSignal: engineController.signal,
      deferralPolicy: TEST_DEFERRAL_POLICY,
    });

    expect(jobsService.recordSuccess).toHaveBeenCalledTimes(1);
    expect(jobsService.releaseClaim).not.toHaveBeenCalled();
  });
});
