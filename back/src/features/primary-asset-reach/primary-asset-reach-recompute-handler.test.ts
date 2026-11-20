import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobContext } from '@app/module';

const mockRecomputePrimaryAssetReach = vi.fn().mockResolvedValue({ primaryAssets: 0, rows: 0, upserted: 0, deleted: 0 });
const mockWithOrigin = vi.fn().mockReturnValue({
  assetDependencies: { recomputePrimaryAssetReach: mockRecomputePrimaryAssetReach },
});
const mockCreateServices = vi.fn().mockReturnValue({ withOrigin: mockWithOrigin });

vi.mock('@app/module', () => ({
  allServiceDefinitions: [],
  createServices: mockCreateServices,
}));

vi.mock('../../utils/logger', () => ({
  createLogger: vi.fn().mockReturnValue({ logTrace: vi.fn(), logFromError: vi.fn() }),
}));

const { primaryAssetReachRecomputeHandler } = await import('./primary-asset-reach-recompute-handler');

const runDb = { run: true };

const makeCtx = (overrides: Partial<JobContext> = {}): JobContext => ({
  jobId: 'job-reach-1',
  tenantId: 'tenant-abc',
  kind: 'primary-asset-reach-recompute',
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

describe('primaryAssetReachRecomputeHandler', () => {
  beforeEach(() => {
    mockRecomputePrimaryAssetReach.mockClear();
    mockWithOrigin.mockClear();
    mockCreateServices.mockClear();
  });

  it('refuses to run unobserved', async () => {
    await expect(primaryAssetReachRecomputeHandler(makeCtx({ runDb: undefined }))).rejects.toThrow('primary asset reach recompute must run as an observed job');
    expect(mockRecomputePrimaryAssetReach).not.toHaveBeenCalled();
  });

  it('builds its services on the run instance, never the shared one', async () => {
    await primaryAssetReachRecomputeHandler(makeCtx());

    expect(mockCreateServices).toHaveBeenCalledWith([], runDb);
  });

  it('runs under the job of the tenant it was booked for', async () => {
    await primaryAssetReachRecomputeHandler(makeCtx({ interactive: true }));

    expect(mockWithOrigin).toHaveBeenCalledWith({ type: 'job', tenantId: 'tenant-abc', jobKind: 'primary-asset-reach-recompute', interactive: true });
  });

  it('recomputes the tenant once per run', async () => {
    await primaryAssetReachRecomputeHandler(makeCtx());

    expect(mockRecomputePrimaryAssetReach).toHaveBeenCalledOnce();
  });

  it('does nothing once aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await primaryAssetReachRecomputeHandler(makeCtx({ signal: controller.signal }));

    expect(mockCreateServices).not.toHaveBeenCalled();
    expect(mockRecomputePrimaryAssetReach).not.toHaveBeenCalled();
  });
});
