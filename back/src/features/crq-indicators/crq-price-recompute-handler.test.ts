import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JobContext } from '@app/module';

const mockPriceAllScenarios = vi.fn();

vi.mock('@app/module', () => ({
  allServiceDefinitions: [],
  createServices: vi.fn().mockReturnValue({ withOrigin: () => ({ crqIndicators: { priceAllScenarios: mockPriceAllScenarios } }) }),
}));

vi.mock('../../utils/logger', () => ({
  createLogger: () => ({ logTrace: vi.fn() }),
}));

const { crqPriceRecomputeHandler } = await import('./crq-price-recompute-handler');

const makeCtx = (): JobContext<Record<string, unknown>> => ({
  jobId: 'job-1',
  tenantId: 'tenant-abc',
  kind: 'crq-price-recompute',
  interactive: false,
  payload: {},
  attempt: 1,
  state: null,
  signal: new AbortController().signal,
  updateProgress: vi.fn(),
  saveStateSnapshot: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the services factory is mocked, so the run's instance is only passed through
  runDb: {} as never,
});

describe('crqPriceRecomputeHandler', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    mockPriceAllScenarios.mockReset();
  });

  it('stamps the runs with the image version, and with none from a process run from source', async () => {
    mockPriceAllScenarios.mockResolvedValue(null);

    vi.stubEnv('APP_VERSION', '0.261112.0-dev.0fed327');
    await crqPriceRecomputeHandler(makeCtx());
    vi.stubEnv('APP_VERSION', undefined);
    await crqPriceRecomputeHandler(makeCtx());

    expect(mockPriceAllScenarios.mock.calls.map(([, , , options]) => options.appVersion)).toEqual(['0.261112.0-dev.0fed327', undefined]);
  });
});
