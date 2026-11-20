import type { ClaimedJob } from '@app/module';
import { deferralPolicyFor } from '@app/module';
import { describe, expect, it, vi } from 'vitest';
import type { ExecutionJobsService } from './execution-loop';
import { executeJob } from './execution-loop';
import { HandlerRegistry } from './handler-registry';

const TEST_DEFERRAL_POLICY = deferralPolicyFor(1_000);

const baseJob = (): ClaimedJob => ({
  id: 'job-1',
  tenantId: 'tenant-1',
  kind: 'terminal-retention-handler',
  payload: {},
  attempt: 1,
  maxAttempts: 1,
  maxRuntimeMs: 5_000,
  bounded: true,
  stateSnapshot: null,
  processedTotal: 0,
  expectedTotal: null,
  leasedUntil: new Date(Date.now() + 30_000),
  triggeredBy: 'system',
  triggeredById: null,
  interactive: false,
});

const stubJobsService = (overrides: Partial<ExecutionJobsService> = {}): ExecutionJobsService => ({
  enqueueJob: vi.fn().mockResolvedValue({ jobId: 'continuation-1', alreadyExisted: false }),
  renewLease: vi.fn().mockResolvedValue(undefined),
  recordSuccess: vi.fn().mockResolvedValue({ recorded: true }),
  recordFailure: vi.fn().mockResolvedValue({ outcome: 'dlq' }),
  recordCancelled: vi.fn().mockResolvedValue({ recorded: true }),
  releaseClaim: vi.fn().mockResolvedValue({ outcome: 'released' }),
  deferRun: vi.fn().mockResolvedValue({ outcome: 'lost-race' }),
  isAbortRequested: vi.fn().mockResolvedValue(false),
  updateProgress: vi.fn().mockResolvedValue(undefined),
  saveStateSnapshot: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

const runWith = async (jobsService: ExecutionJobsService, handler: () => Promise<void>) => {
  const registry = new HandlerRegistry();
  registry.register('terminal-retention-handler', handler);
  const onTerminal = vi.fn().mockResolvedValue(undefined);
  await executeJob({
    job: baseJob(),
    workerId: 'test-worker',
    jobsService,
    handlerRegistry: registry,
    engineSignal: new AbortController().signal,
    deferralPolicy: TEST_DEFERRAL_POLICY,
    leaseRenewIntervalMs: 1_000,
    abortPollIntervalMs: 1_000,
    onTerminal,
  });
  return onTerminal;
};

describe('executeJob terminal retention', () => {
  it('runs the terminal hook once the success was recorded', async () => {
    const onTerminal = await runWith(stubJobsService(), () => Promise.resolve());

    expect(onTerminal).toHaveBeenCalledTimes(1);
  });

  it('leaves the terminal hook alone when the success lost the lease race', async () => {
    const jobsService = stubJobsService({ recordSuccess: vi.fn().mockResolvedValue({ recorded: false }) });

    const onTerminal = await runWith(jobsService, () => Promise.resolve());

    expect(onTerminal).not.toHaveBeenCalled();
  });

  it('runs the terminal hook when the failure reached the dead-letter queue', async () => {
    const onTerminal = await runWith(stubJobsService(), () => Promise.reject(new Error('handler failed')));

    expect(onTerminal).toHaveBeenCalledTimes(1);
  });

  it('leaves the terminal hook alone when the failure lost the lease race', async () => {
    const jobsService = stubJobsService({ recordFailure: vi.fn().mockResolvedValue({ outcome: 'lost-race' }) });

    const onTerminal = await runWith(jobsService, () => Promise.reject(new Error('handler failed')));

    expect(onTerminal).not.toHaveBeenCalled();
  });

  it('runs the terminal hook when no handler answers for the job kind', async () => {
    const onTerminal = vi.fn().mockResolvedValue(undefined);
    const onJobFailure = vi.fn();

    await executeJob({
      job: baseJob(),
      workerId: 'test-worker',
      jobsService: stubJobsService(),
      handlerRegistry: new HandlerRegistry(),
      engineSignal: new AbortController().signal,
      deferralPolicy: TEST_DEFERRAL_POLICY,
      onTerminal,
      onJobFailure,
    });

    expect(onTerminal).toHaveBeenCalledTimes(1);
    expect(onJobFailure).toHaveBeenCalledTimes(1);
  });
});
