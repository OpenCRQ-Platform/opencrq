import type { ClaimedJob, CompletedRunObservation } from '@app/module';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecuteJobOptions } from './execution-loop';
import { listEngines } from '../engines-manager';
import { jobRuntimeEngine } from './job-runtime-engine';

const mocks = vi.hoisted(() => ({
  claimNext: vi.fn(),
  executeJob: vi.fn(),
  finalizeRunObservation: vi.fn(),
  answerAbsorbedAsk: vi.fn(),
}));

vi.mock('../../config', () => ({
  config: vi.fn(() => ({
    jobs: { enabled: true, max_concurrent: 2, polling_fallback_ms: 3_600_000, heartbeat_interval_ms: 3_600_000 },
    recompute: { debounce_cap_ms: 300_000 },
  })),
  pmConfig: { inDev: false },
  getProcessName: vi.fn(() => 'test'),
}));

vi.mock('../db', () => ({ dbEngine: { db: {}, pool: {} } }));

vi.mock('@app/module', () => ({
  SUBSCRIBE_ALL_SENTINEL: '*',
  sharedSlotGroups: () => [],
  jobsService: {},
  jobLogsService: {},
  workersService: {},
  deferralPolicyFor: () => ({ minDelayMs: 2_000, maxDelayMs: 30_000, maxWaitMs: 600_000 }),
  createServices: () => ({
    withOrigin: () => ({
      jobs: {
        claimNext: mocks.claimNext,
        answerAbsorbedAsk: mocks.answerAbsorbedAsk,
        reapOrphans: vi.fn().mockResolvedValue(undefined),
      },
      jobLogs: { trimToRecentRuns: vi.fn().mockResolvedValue(undefined) },
      workers: { heartbeat: vi.fn().mockResolvedValue(undefined) },
    }),
  }),
}));

vi.mock('./execution-loop', () => ({ executeJob: mocks.executeJob, LEASE_MS: 30_000 }));

vi.mock('./run-observation', () => ({
  createRunObservation: () => ({ db: {}, recorder: {} }),
  finalizeRunObservation: mocks.finalizeRunObservation,
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

interface Completion {
  kind: string,
  observation: CompletedRunObservation | null,
}

const startEngine = async (completions: Array<Completion>) => {
  jobRuntimeEngine.addRunListener({
    onRunCompleted: (kind, _tenantId, _durationMs, observation) => {
      completions.push({ kind, observation });
    },
  });
  const engine = listEngines().find(({ key }) => key === 'job-runtime');
  expect(engine).toBeDefined();
  const controller = new AbortController();
  const handler = await engine!.start(controller.signal);
  await handler.onEnginesStarted?.();
  return { controller, handler };
};

describe('job runtime run completion', () => {
  beforeEach(() => {
    mocks.claimNext.mockReset();
    mocks.executeJob.mockReset();
    mocks.finalizeRunObservation.mockReset();
    mocks.answerAbsorbedAsk.mockReset();
  });

  it('should announce the completion only once the handler has settled', async () => {
    const kind = 'settling-recompute';
    mocks.claimNext.mockResolvedValueOnce(claimedJob(kind)).mockResolvedValue(null);
    jobRuntimeEngine.registerHandler(kind, async () => {}, {});
    let settleHandler = (): void => {};
    mocks.executeJob.mockImplementation((opts: ExecuteJobOptions) => {
      settleHandler = () => opts.onHandlerSettled?.();
      return Promise.resolve();
    });

    const completions: Array<Completion> = [];
    const { controller } = await startEngine(completions);

    await vi.waitFor(() => expect(mocks.executeJob).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(completions).toHaveLength(0);

    settleHandler();
    await vi.waitFor(() => expect(completions).toEqual([{ kind, observation: null }]));
    controller.abort();
  });

  it('should keep a serialized slot out of its own claims until the handler settles', async () => {
    const kind = 'serialized-simulation';
    mocks.claimNext.mockResolvedValueOnce(claimedJob(kind)).mockResolvedValue(null);
    jobRuntimeEngine.registerHandler(kind, async () => {}, { serialized: true });
    let settleHandler = (): void => {};
    // Resolves while the handler is still running, which is what an abort does: the job row is
    // terminal from here, so the queue's own sibling test would let the next one through.
    mocks.executeJob.mockImplementation((opts: ExecuteJobOptions) => {
      settleHandler = () => opts.onHandlerSettled?.();
      return Promise.resolve();
    });

    const completions: Array<Completion> = [];
    const { controller } = await startEngine(completions);

    await vi.waitFor(() => expect(mocks.claimNext).toHaveBeenCalledTimes(2));
    expect(mocks.claimNext.mock.calls[0][4]).toEqual([]);
    expect(mocks.claimNext.mock.calls[1][4]).toEqual([{ kind, tenantId: 'tenant-1' }]);

    settleHandler();
    await vi.waitFor(() => expect(mocks.claimNext).toHaveBeenCalledTimes(3));
    expect(mocks.claimNext.mock.calls[2][4]).toEqual([]);
    controller.abort();
  });

  it('should hold no slot for a kind nothing serializes', async () => {
    const kind = 'parallel-recompute';
    mocks.claimNext.mockResolvedValueOnce(claimedJob(kind)).mockResolvedValue(null);
    jobRuntimeEngine.registerHandler(kind, async () => {}, {});
    mocks.executeJob.mockImplementation(() => Promise.resolve());

    const completions: Array<Completion> = [];
    const { controller } = await startEngine(completions);

    await vi.waitFor(() => expect(mocks.claimNext).toHaveBeenCalledTimes(2));
    expect(mocks.claimNext.mock.calls[1][4]).toEqual([]);
    controller.abort();
  });

  it('should tell the listeners that a widened observation was not persisted', async () => {
    const kind = 'unpersisted-recompute';
    mocks.claimNext.mockResolvedValueOnce(claimedJob(kind)).mockResolvedValue(null);
    jobRuntimeEngine.registerHandler(kind, async () => {}, { observed: true });
    mocks.finalizeRunObservation.mockRejectedValue(new Error('job_dependencies is unreachable'));
    mocks.executeJob.mockImplementation((opts: ExecuteJobOptions) => {
      opts.onJobSuccess?.(opts.job.id, opts.job.kind);
      opts.onHandlerSettled?.();
      return Promise.resolve();
    });

    const completions: Array<Completion> = [];
    const { controller } = await startEngine(completions);

    await vi.waitFor(() => expect(completions).toContainEqual({
      kind,
      observation: { observation: { reads: ['*'], writes: [] }, persisted: false },
    }));
    controller.abort();
  });

  it('should widen the observation of a run resumed from a state, and replace that of a fresh one', async () => {
    const kind = 'resumed-recompute';
    mocks.claimNext
      .mockResolvedValueOnce({ ...claimedJob(kind), id: 'job-resumed', stateSnapshot: { after: 'scenario-90' } })
      .mockResolvedValueOnce({ ...claimedJob(kind), id: 'job-fresh' })
      .mockResolvedValue(null);
    jobRuntimeEngine.registerHandler(kind, async () => {}, { observed: true });
    mocks.finalizeRunObservation.mockResolvedValue({ reads: ['risk_scenarios'], writes: [] });
    mocks.executeJob.mockImplementation((opts: ExecuteJobOptions) => {
      opts.onJobSuccess?.(opts.job.id, opts.job.kind);
      opts.onHandlerSettled?.();
      return Promise.resolve();
    });

    const { controller } = await startEngine([]);

    await vi.waitFor(() => expect(mocks.finalizeRunObservation).toHaveBeenCalledTimes(2));
    expect(mocks.finalizeRunObservation.mock.calls.map((call) => call[6])).toEqual([true, false]);
    controller.abort();
  });

  it('should drain a shutdown on the handler rather than on the concurrency slot', async () => {
    const kind = 'shutdown-recompute';
    mocks.claimNext.mockResolvedValueOnce(claimedJob(kind)).mockResolvedValue(null);
    jobRuntimeEngine.registerHandler(kind, async () => {}, {});
    let settleHandler = (): void => {};
    mocks.executeJob.mockImplementation((opts: ExecuteJobOptions) => {
      settleHandler = () => opts.onHandlerSettled?.();
      return Promise.resolve();
    });

    const { controller, handler } = await startEngine([]);
    await vi.waitFor(() => expect(mocks.executeJob).toHaveBeenCalledTimes(1));

    let drained = false;
    const draining = Promise.resolve(handler.onEnginesStopping?.()).then(() => {
      drained = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(drained).toBe(false);

    settleHandler();
    await draining;
    expect(drained).toBe(true);
    controller.abort();
  });

  it('should drain a shutdown only once the answer an interrupted run owes is booked', async () => {
    const kind = 'answering-recompute';
    mocks.claimNext.mockResolvedValueOnce(claimedJob(kind)).mockResolvedValue(null);
    jobRuntimeEngine.registerHandler(kind, async () => {}, {});
    let bookAnswer = (): void => {};
    mocks.answerAbsorbedAsk.mockImplementation(() => new Promise<string>((resolve) => {
      bookAnswer = () => resolve('answer-1');
    }));
    mocks.executeJob.mockImplementation((opts: ExecuteJobOptions) => {
      opts.onAnswerOwed?.(opts.job.id);
      opts.onHandlerSettled?.();
      return Promise.resolve();
    });

    const { controller, handler } = await startEngine([]);
    await vi.waitFor(() => expect(mocks.answerAbsorbedAsk).toHaveBeenCalledWith('job-1'));

    let drained = false;
    const draining = Promise.resolve(handler.onEnginesStopping?.()).then(() => {
      drained = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(drained).toBe(false);

    bookAnswer();
    await draining;
    expect(drained).toBe(true);
    controller.abort();
  });
});
