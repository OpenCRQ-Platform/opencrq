import { describe, expect, it, vi } from 'vitest';
import type { JobContext } from '@app/module';
import type { CrqBaselinePayload } from './crq-simulation-origin';

const mockRunAttackRunEngine = vi.fn();

const mockWithOrigin = vi.fn().mockReturnValue({
  crqIndicators: {
    runAttackRunEngine: mockRunAttackRunEngine,
  },
});

const FULL_RUN_PROFILE = { techniques: true, cves: true, levers: 'all', plans: 'all' };

vi.mock('@app/module', () => ({
  allServiceDefinitions: [],
  createServices: vi.fn().mockReturnValue({ withOrigin: mockWithOrigin }),
  bookedRunProfile: (payload: { profile?: unknown }) => payload.profile ?? FULL_RUN_PROFILE,
}));

vi.mock('../../engines/db', () => ({
  dbEngine: { db: {} },
}));

const mockLogTrace = vi.fn();
vi.mock('../../utils/logger', () => ({
  createLogger: () => ({ logTrace: mockLogTrace }),
}));

const { crqSimulationHandler } = await import('./crq-simulation-handler');

const TENANT_ID = 'tenant-abc';
const SCENARIO_ID = 'scenario-123';
const USER_ID = 'user-xyz';

const makeCtx = (overrides: Partial<JobContext<CrqBaselinePayload>> = {}): JobContext<CrqBaselinePayload> => ({
  jobId: 'job-1',
  tenantId: TENANT_ID,
  kind: 'crq-simulation',
  interactive: true,
  payload: { riskScenarioId: SCENARIO_ID, userId: USER_ID },
  attempt: 1,
  state: null,
  signal: new AbortController().signal,
  updateProgress: vi.fn(),
  saveStateSnapshot: vi.fn(),
  ...overrides,
});

const makeAbortedCtx = (): JobContext<CrqBaselinePayload> => {
  const ctrl = new AbortController();
  ctrl.abort();
  return makeCtx({ signal: ctrl.signal });
};

describe('crqSimulationHandler', () => {
  it('returns immediately without calling services when signal is already aborted', async () => {
    await crqSimulationHandler(makeAbortedCtx());

    expect(mockRunAttackRunEngine).not.toHaveBeenCalled();
  });

  it('calls runAttackRunEngine with the riskScenarioId, the tenantId, the job abort signal, a full profile and the job id', async () => {
    mockRunAttackRunEngine.mockResolvedValueOnce(undefined);
    const ctx = makeCtx();

    await crqSimulationHandler(ctx);

    expect(mockRunAttackRunEngine).toHaveBeenCalledOnce();
    expect(mockRunAttackRunEngine).toHaveBeenCalledWith(SCENARIO_ID, TENANT_ID, ctx.signal, FULL_RUN_PROFILE, 'job-1', { priceBudgetReviews: true });
  });

  it('runs the profile the booking carries', async () => {
    mockRunAttackRunEngine.mockResolvedValueOnce(undefined);
    const profile = { techniques: false, cves: false, levers: ['control-1'], plans: [] };

    await crqSimulationHandler(makeCtx({ payload: { riskScenarioId: SCENARIO_ID, profile } }));

    expect(mockRunAttackRunEngine).toHaveBeenLastCalledWith(SCENARIO_ID, TENANT_ID, expect.anything(), profile, 'job-1', { priceBudgetReviews: true });
  });

  it('logs a skip and ends without failing when the engine priced nothing', async () => {
    mockRunAttackRunEngine.mockResolvedValueOnce({ skipped: 'no-scenario' });

    await expect(crqSimulationHandler(makeCtx())).resolves.toBeUndefined();

    expect(mockLogTrace).toHaveBeenCalledWith('Attack run simulation skipped', { riskScenarioId: SCENARIO_ID, reason: 'no-scenario' });
  });

  it('uses withOrigin({ type: "client" }) with userId and tenantId from the job context', async () => {
    mockRunAttackRunEngine.mockResolvedValueOnce(undefined);

    await crqSimulationHandler(makeCtx());

    expect(mockWithOrigin).toHaveBeenCalledWith({
      type: 'client',
      userId: USER_ID,
      tenantId: TENANT_ID,
      job: { jobKind: 'crq-simulation', interactive: true },
    });
  });
});
