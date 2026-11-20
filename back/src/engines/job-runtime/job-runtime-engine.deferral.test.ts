import type { ClaimedJob } from '@app/module';
import { InputsNotReadyError } from '@app/module';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecuteJobOptions } from './execution-loop';
import { listEngines } from '../engines-manager';
import { jobRuntimeEngine } from './job-runtime-engine';

const { DEBOUNCE_CAP_MS, DEFERRAL_DELAY_MS } = vi.hoisted(() => ({ DEBOUNCE_CAP_MS: 300_000, DEFERRAL_DELAY_MS: 7_000 }));
const KIND = 'deferred-simulation';

const mocks = vi.hoisted(() => ({
  claimNext: vi.fn(),
  executeJob: vi.fn(),
}));

vi.mock('../../config', () => ({
  config: vi.fn(() => ({
    jobs: { enabled: true, max_concurrent: 2, polling_fallback_ms: 3_600_000, heartbeat_interval_ms: 3_600_000 },
    recompute: { debounce_cap_ms: DEBOUNCE_CAP_MS },
  })),
  pmConfig: { inDev: false },
  getProcessName: vi.fn(() => 'test'),
}));

vi.mock('../db', () => ({ dbEngine: { db: {}, pool: {} } }));

vi.mock('@app/module', async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    SUBSCRIBE_ALL_SENTINEL: '*',
    sharedSlotGroups: () => [],
    jobsService: {},
    jobLogsService: {},
    workersService: {},
    deferralPolicyFor: actual.deferralPolicyFor,
    InputsNotReadyError: actual.InputsNotReadyError,
    createServices: () => ({
      withOrigin: () => ({
        jobs: {
          claimNext: mocks.claimNext,
          reapOrphans: vi.fn().mockResolvedValue(undefined),
        },
        jobLogs: { trimToRecentRuns: vi.fn().mockResolvedValue(undefined) },
        workers: { heartbeat: vi.fn().mockResolvedValue(undefined) },
      }),
    }),
  };
});

vi.mock('./execution-loop', () => ({ executeJob: mocks.executeJob, LEASE_MS: 30_000 }));

vi.mock('./run-observation', () => ({
  createRunObservation: () => ({ db: {}, recorder: {} }),
  finalizeRunObservation: vi.fn(),
}));

vi.mock('./listen-notify-listener', () => ({
  startListenNotifyListener: vi.fn(() => new Promise<void>(() => {})),
}));

const claimedJob = (kind: string): ClaimedJob => ({
  id: 'job-1',
  tenantId: 'tenant-1',
  kind,
  payload: {},
  attempt: 1,
  maxAttempts: 3,
  maxRuntimeMs: 1_000,
  bounded: true,
  stateSnapshot: null,
  processedTotal: 0,
  expectedTotal: null,
  leasedUntil: new Date(Date.now() + 30_000),
  triggeredBy: 'system',
  triggeredById: null,
  interactive: false,
});

describe('job runtime deferral', () => {
  beforeAll(() => {
    jobRuntimeEngine.registerHandler(KIND, async () => {}, {});
  });

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.claimNext.mockReset();
    mocks.executeJob.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should drain again once the deferral delay has passed, not before', async () => {
    mocks.claimNext.mockResolvedValueOnce(claimedJob(KIND)).mockResolvedValue(null);
    mocks.executeJob.mockImplementation((opts: ExecuteJobOptions) => {
      opts.onDeferred?.(opts.job.id, opts.job.kind, new InputsNotReadyError('mixture is not stored yet'), {
        runAfter: new Date(Date.now() + DEFERRAL_DELAY_MS),
        delayMs: DEFERRAL_DELAY_MS,
      });
      opts.onHandlerSettled?.();
      return Promise.resolve();
    });

    const engine = listEngines().find(({ key }) => key === 'job-runtime');
    expect(engine).toBeDefined();
    const controller = new AbortController();
    const handler = await engine!.start(controller.signal);
    await handler.onEnginesStarted?.();

    await vi.advanceTimersByTimeAsync(0);
    const claimsAfterRun = mocks.claimNext.mock.calls.length;
    expect(mocks.executeJob).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(DEFERRAL_DELAY_MS - 1);
    expect(mocks.claimNext).toHaveBeenCalledTimes(claimsAfterRun);

    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.claimNext.mock.calls.length).toBeGreaterThan(claimsAfterRun);
    controller.abort();
  });

  it('should wait for its inputs longer than the dispatcher may take to book the job that writes them', async () => {
    mocks.claimNext.mockResolvedValueOnce(claimedJob(KIND)).mockResolvedValue(null);
    let deferralPolicy: ExecuteJobOptions['deferralPolicy'] | undefined;
    mocks.executeJob.mockImplementation((opts: ExecuteJobOptions) => {
      deferralPolicy = opts.deferralPolicy;
      opts.onHandlerSettled?.();
      return Promise.resolve();
    });

    const engine = listEngines().find(({ key }) => key === 'job-runtime');
    const controller = new AbortController();
    const handler = await engine!.start(controller.signal);
    await handler.onEnginesStarted?.();
    await vi.advanceTimersByTimeAsync(0);

    expect(deferralPolicy?.maxWaitMs).toBeGreaterThan(DEBOUNCE_CAP_MS);
    controller.abort();
  });
});
