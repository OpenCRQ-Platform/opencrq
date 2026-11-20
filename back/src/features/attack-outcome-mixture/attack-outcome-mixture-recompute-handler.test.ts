import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobContext } from '@app/module';

const mockRecomputeAttackOutcomeMixtures = vi.fn().mockResolvedValue({ written: 0, removed: 0, unchanged: 0 });
const mockWithOrigin = vi.fn().mockReturnValue({
  attackOutcomes: { recomputeAttackOutcomeMixtures: mockRecomputeAttackOutcomeMixtures },
});
const mockCreateServices = vi.fn().mockReturnValue({ withOrigin: mockWithOrigin });

vi.mock('@app/module', () => ({
  allServiceDefinitions: [],
  createServices: mockCreateServices,
}));

vi.mock('../../utils/logger', () => ({
  createLogger: vi.fn().mockReturnValue({ logTrace: vi.fn(), logFromError: vi.fn() }),
}));

const { attackOutcomeMixtureRecomputeHandler } = await import('./attack-outcome-mixture-recompute-handler');

const runDb = { run: true };

const makeCtx = (overrides: Partial<JobContext> = {}): JobContext => ({
  jobId: 'job-mixture-1',
  tenantId: 'tenant-abc',
  kind: 'attack-outcome-mixture-recompute',
  interactive: false,
  payload: {},
  attempt: 1,
  state: null,
  signal: new AbortController().signal,
  updateProgress: vi.fn().mockResolvedValue(undefined),
  saveStateSnapshot: vi.fn().mockResolvedValue(undefined),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the services factory is mocked, so the run's instance is only passed through
  runDb: runDb as never,
  ...overrides,
});

describe('attackOutcomeMixtureRecomputeHandler', () => {
  beforeEach(() => {
    mockRecomputeAttackOutcomeMixtures.mockClear();
    mockWithOrigin.mockClear();
    mockCreateServices.mockClear();
  });

  it('refuses to run unobserved', async () => {
    await expect(attackOutcomeMixtureRecomputeHandler(makeCtx({ runDb: undefined }))).rejects.toThrow('attack outcome mixture recompute must run as an observed job');
    expect(mockRecomputeAttackOutcomeMixtures).not.toHaveBeenCalled();
  });

  it('builds its services on the run instance, never the shared one', async () => {
    await attackOutcomeMixtureRecomputeHandler(makeCtx());

    expect(mockCreateServices).toHaveBeenCalledWith([], runDb);
  });

  it('runs under the job of the tenant it was booked for', async () => {
    await attackOutcomeMixtureRecomputeHandler(makeCtx({ interactive: true }));

    expect(mockWithOrigin).toHaveBeenCalledWith({ type: 'job', tenantId: 'tenant-abc', jobKind: 'attack-outcome-mixture-recompute', interactive: true });
  });

  it('recomputes the tenant once per run', async () => {
    await attackOutcomeMixtureRecomputeHandler(makeCtx());

    expect(mockRecomputeAttackOutcomeMixtures).toHaveBeenCalledOnce();
  });

  it('does nothing once aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await attackOutcomeMixtureRecomputeHandler(makeCtx({ signal: controller.signal }));

    expect(mockCreateServices).not.toHaveBeenCalled();
    expect(mockRecomputeAttackOutcomeMixtures).not.toHaveBeenCalled();
  });
});
