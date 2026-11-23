import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JobContext, ProgressUpdate, ScenarioPricingPass, ScenarioPricingPassOptions } from '@app/module';

const mockPriceAllScenarios = vi.fn();

vi.mock('@app/module', () => ({
  allServiceDefinitions: [],
  createServices: vi.fn().mockReturnValue({ withOrigin: () => ({ crqIndicators: { priceAllScenarios: mockPriceAllScenarios } }) }),
}));

vi.mock('../../utils/logger', () => ({
  createLogger: () => ({ logTrace: vi.fn() }),
}));

const { CRQ_PRICE_MOVED_IDS_CAP, crqPriceRecomputeHandler } = await import('./crq-price-recompute-handler');

type State = Record<string, unknown>;

const makeCtx = (state: State | null = null) => {
  const progress: Array<ProgressUpdate> = [];
  const ctx: JobContext<Record<string, unknown>, State> = {
    jobId: 'job-1',
    tenantId: 'tenant-abc',
    kind: 'crq-price-recompute',
    interactive: false,
    payload: {},
    attempt: 1,
    state,
    signal: new AbortController().signal,
    updateProgress: vi.fn((update: ProgressUpdate) => {
      progress.push(update);
      return Promise.resolve();
    }),
    saveStateSnapshot: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the services factory is mocked, so the run's instance is only passed through
    runDb: {} as never,
  };
  return { ctx, progress };
};

const passOf = (overrides: Partial<ScenarioPricingPass>): ScenarioPricingPass => ({
  priced: 0, unchanged: 0, skipped: 0, refused: [], moved: [], walked: 0, total: 0, resumeAfter: null, ...overrides,
});

/** Answers `pass`, calling the handler's progress hook first as the service does. */
const answer = (pass: ScenarioPricingPass) => {
  mockPriceAllScenarios.mockImplementation(async (_tenantId: string, _signal: AbortSignal, _jobId: string, options: ScenarioPricingPassOptions) => {
    await options.onProgress?.({ walked: 0, total: pass.total });
    return pass;
  });
};

const summaryOf = (progress: Array<ProgressUpdate>) => {
  const last = progress.at(-1);
  return typeof last?.message === 'string' ? JSON.parse(last.message) : undefined;
};

describe('crqPriceRecomputeHandler', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    mockPriceAllScenarios.mockReset();
  });

  it('stamps the runs with the image version, and with none from a process run from source', async () => {
    mockPriceAllScenarios.mockResolvedValue(null);

    vi.stubEnv('APP_VERSION', '0.261112.0-dev.0fed327');
    await crqPriceRecomputeHandler(makeCtx().ctx);
    vi.stubEnv('APP_VERSION', undefined);
    await crqPriceRecomputeHandler(makeCtx().ctx);

    expect(mockPriceAllScenarios.mock.calls.map(([, , , options]) => options.appVersion)).toEqual(['0.261112.0-dev.0fed327', undefined]);
  });

  it('reports the scenarios walked and names the one whose price moved', async () => {
    answer(passOf({ priced: 1, unchanged: 2, moved: ['scenario-b'], walked: 3, total: 3 }));
    const { ctx, progress } = makeCtx();

    expect(await crqPriceRecomputeHandler(ctx)).toBeUndefined();

    expect(progress[0]).toEqual({ processedTotal: 0, expectedTotal: 3 });
    expect(progress.at(-1)).toMatchObject({ processedTotal: 3, expectedTotal: 3 });
    expect(summaryOf(progress)).toEqual({
      walked: 3, priced: 1, unchanged: 2, skipped: 0, refused: 0, moved: ['scenario-b'], movedCount: 1, complete: true,
    });
  });

  it('tells a pass that moved nothing from one that did', async () => {
    answer(passOf({ unchanged: 2, walked: 2, total: 2 }));
    const { ctx, progress } = makeCtx();

    await crqPriceRecomputeHandler(ctx);

    expect(progress.at(-1)).toMatchObject({ processedTotal: 2 });
    expect(summaryOf(progress)).toMatchObject({ priced: 0, moved: [], movedCount: 0, complete: true });
  });

  it('carries its totals to the continuation, which reports the whole chain', async () => {
    answer(passOf({ priced: 1, unchanged: 1, moved: ['scenario-a'], walked: 2, total: 5, resumeAfter: 'scenario-b' }));
    const first = makeCtx();

    const result = await crqPriceRecomputeHandler(first.ctx);

    expect(summaryOf(first.progress)).toMatchObject({ walked: 2, moved: ['scenario-a'], complete: false });
    expect(result).toMatchObject({ continuation: true, state: { after: 'scenario-b' } });

    answer(passOf({ priced: 1, refused: [{ riskScenarioId: 'scenario-d', reason: 'no scope' }], moved: ['scenario-c'], walked: 3, total: 3 }));
    const second = makeCtx(result?.state ?? null);

    await crqPriceRecomputeHandler(second.ctx);

    expect(mockPriceAllScenarios.mock.calls.at(-1)?.[3].after).toBe('scenario-b');
    expect(second.progress[0]).toEqual({ processedTotal: 2, expectedTotal: 5 });
    expect(second.progress.at(-1)).toMatchObject({ processedTotal: 5, expectedTotal: 5 });
    expect(summaryOf(second.progress)).toEqual({
      walked: 5, priced: 2, unchanged: 1, skipped: 0, refused: 1, moved: ['scenario-a', 'scenario-c'], movedCount: 2, complete: true,
    });
  });

  it('names at most the cap of moved scenarios and keeps counting past it', async () => {
    const moved = Array.from({ length: CRQ_PRICE_MOVED_IDS_CAP + 5 }, (_, index) => `scenario-${index}`);
    answer(passOf({ priced: moved.length, moved, walked: moved.length, total: moved.length }));
    const { ctx, progress } = makeCtx();

    await crqPriceRecomputeHandler(ctx);

    const summary = summaryOf(progress);
    expect(summary.moved).toHaveLength(CRQ_PRICE_MOVED_IDS_CAP);
    expect(summary.movedCount).toBe(CRQ_PRICE_MOVED_IDS_CAP + 5);
  });
});
