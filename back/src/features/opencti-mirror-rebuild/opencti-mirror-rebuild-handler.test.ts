import type { JobContext, MirrorRebuildBatchResult } from '@app/module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockRebuildPendingBatch = vi.fn<(...args: Array<unknown>) => Promise<MirrorRebuildBatchResult>>();
const mockWithOrigin = vi.fn().mockReturnValue({
  openctiConnector: { rebuildPendingBatch: mockRebuildPendingBatch },
});

vi.mock('@app/module', () => ({
  allServiceDefinitions: [],
  createServices: vi.fn().mockReturnValue({ withOrigin: mockWithOrigin }),
}));

const mockLogFromError = vi.fn();
vi.mock('../../utils/logger', () => ({
  createLogger: vi.fn().mockReturnValue({ logTrace: vi.fn(), logFromError: mockLogFromError }),
}));

const {
  MIRROR_REBUILD_MAX_BATCHES,
  MIRROR_REBUILD_MAX_RUNTIME_MS,
  openctiMirrorRebuildHandler,
} = await import('./opencti-mirror-rebuild-handler');

const mark = (stixId: string) => ({ stixId, watermark: '2026-01-01 00:00:00.1+00' });

const batch = (over: Partial<MirrorRebuildBatchResult> = {}): MirrorRebuildBatchResult => ({
  locked: true,
  scanned: 0,
  rebuilt: 0,
  retracted: 0,
  settled: 0,
  remaining: false,
  bound: (over.scanned ?? 0) > 0 ? mark('object--last') : null,
  failures: [],
  ...over,
});

/** A batch that drained its rows and saw more waiting behind them. */
const fullBatch = () => batch({ scanned: 200, settled: 200, remaining: true });

const context = (over: Partial<JobContext> = {}): JobContext => ({
  jobId: 'job-1',
  tenantId: 'tenant-a',
  kind: 'opencti-mirror-rebuild',
  interactive: false,
  payload: {},
  attempt: 1,
  state: null,
  signal: new AbortController().signal,
  updateProgress: () => Promise.resolve(),
  saveStateSnapshot: () => Promise.resolve(),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the handler only hands this to the mocked `createServices`
  runDb: {} as JobContext['runDb'],
  ...over,
});

describe('openctiMirrorRebuildHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Batches slow enough that this many of them spend the whole allowance of one run. */
  const SLOW_BATCHES_PER_RUN = 3;

  const slowBatches = (over: Partial<MirrorRebuildBatchResult> = {}) => {
    vi.useFakeTimers();
    mockRebuildPendingBatch.mockImplementation(() => {
      vi.advanceTimersByTime(MIRROR_REBUILD_MAX_RUNTIME_MS / SLOW_BATCHES_PER_RUN);
      return Promise.resolve({ ...fullBatch(), ...over });
    });
  };

  it('should refuse to run unobserved, rather than falling back to the shared instance', async () => {
    await expect(openctiMirrorRebuildHandler(context({ runDb: undefined }))).rejects.toThrow(/observed/);
    expect(mockRebuildPendingBatch).not.toHaveBeenCalled();
  });

  /**
   * The empty run is what keeps the mirror and the settings row in the observed read set, and that
   * subscription is the only thing the next cursor flush's doorbell can route on.
   */
  it('should run one batch even when nothing is marked', async () => {
    mockRebuildPendingBatch.mockResolvedValue(batch());

    await openctiMirrorRebuildHandler(context());

    expect(mockRebuildPendingBatch).toHaveBeenCalledTimes(1);
  });

  it('should keep taking batches until a scan comes back empty', async () => {
    mockRebuildPendingBatch
      .mockResolvedValueOnce(batch({ scanned: 200, settled: 200 }))
      .mockResolvedValueOnce(batch({ scanned: 30, settled: 30 }))
      .mockResolvedValue(batch());

    await openctiMirrorRebuildHandler(context());

    expect(mockRebuildPendingBatch).toHaveBeenCalledTimes(3);
  });

  /**
   * The rows of a failing actor sort first in every scan, so without the bound a batch they fill
   * would be read again on the next pass and the backlog behind them would never be reached.
   */
  it('should walk past the rows a failing actor left marked and reach the batch behind them', async () => {
    mockRebuildPendingBatch
      .mockResolvedValueOnce(batch({
        scanned: 200,
        settled: 0,
        remaining: true,
        bound: mark('intrusion-set--broken-200'),
        failures: [{ stixId: 'intrusion-set--broken', error: new Error('malformed') }],
      }))
      .mockResolvedValueOnce(batch({ scanned: 40, settled: 40, bound: mark('intrusion-set--behind') }))
      .mockResolvedValue(batch());

    await openctiMirrorRebuildHandler(context());

    expect(mockRebuildPendingBatch).toHaveBeenCalledTimes(3);
    expect(mockRebuildPendingBatch.mock.calls[0][2]).toBeUndefined();
    expect(mockRebuildPendingBatch.mock.calls[1][2]).toEqual(mark('intrusion-set--broken-200'));
    expect(mockRebuildPendingBatch.mock.calls[2][2]).toEqual(mark('intrusion-set--behind'));
  });

  // Another runner holds the tenant: nothing was read and nothing was cleared, so there is no
  // progress to chase and the dispatcher's follow-up is what brings the work back.
  it('should stop at once when the tenant lock is held elsewhere', async () => {
    mockRebuildPendingBatch.mockResolvedValue(batch({ locked: false }));

    await openctiMirrorRebuildHandler(context());

    expect(mockRebuildPendingBatch).toHaveBeenCalledTimes(1);
  });

  /**
   * The three exits of the loop, each with the follow-up it owes: only a run that stops on the bound
   * with rows still marked asks for one. That the ask becomes a queued row is the runtime's half,
   * covered where the row can be read, in `runtime/job-continuation`.
   */
  it('should ask for no continuation when the scan comes back empty', async () => {
    mockRebuildPendingBatch.mockResolvedValue(batch());

    expect(await openctiMirrorRebuildHandler(context())).toEqual({ continuation: false });
  });

  it('should hand the worker slot back at the batch bound and ask for a continuation', async () => {
    mockRebuildPendingBatch.mockResolvedValue(fullBatch());

    expect(await openctiMirrorRebuildHandler(context())).toEqual({ continuation: true });
    expect(mockRebuildPendingBatch).toHaveBeenCalledTimes(MIRROR_REBUILD_MAX_BATCHES);
  });

  it('should ask for no continuation when the bound is reached with nothing left behind', async () => {
    mockRebuildPendingBatch.mockImplementation(() => Promise.resolve(
      mockRebuildPendingBatch.mock.calls.length < MIRROR_REBUILD_MAX_BATCHES
        ? fullBatch()
        : batch({ scanned: 200, settled: 200, remaining: false }),
    ));

    expect(await openctiMirrorRebuildHandler(context())).toEqual({ continuation: false });
    expect(mockRebuildPendingBatch).toHaveBeenCalledTimes(MIRROR_REBUILD_MAX_BATCHES);
  });

  /**
   * The two bounds answer different failure modes: many cheap batches, and few expensive ones. A run
   * whose batches are slow has to hand the slot back on the clock well before the batch count.
   */
  it('should hand the worker slot back on the wall clock and ask for a continuation', async () => {
    slowBatches();

    expect(await openctiMirrorRebuildHandler(context())).toEqual({ continuation: true });
    expect(mockRebuildPendingBatch).toHaveBeenCalledTimes(SLOW_BATCHES_PER_RUN);
    expect(SLOW_BATCHES_PER_RUN).toBeLessThan(MIRROR_REBUILD_MAX_BATCHES);
  });

  it('should ask for no continuation when the wall clock runs out with nothing left behind', async () => {
    slowBatches({ remaining: false });

    expect(await openctiMirrorRebuildHandler(context())).toEqual({ continuation: false });
    expect(mockRebuildPendingBatch).toHaveBeenCalledTimes(SLOW_BATCHES_PER_RUN);
  });

  it('should log each actor whose rebuild failed and carry on with the batch', async () => {
    mockRebuildPendingBatch
      .mockResolvedValueOnce(batch({
        scanned: 200,
        settled: 150,
        rebuilt: 2,
        failures: [{ stixId: 'intrusion-set--broken', error: new Error('malformed') }],
      }))
      .mockResolvedValue(batch());

    const updateProgress = vi.fn().mockResolvedValue(undefined);
    await openctiMirrorRebuildHandler(context({ updateProgress }));

    expect(mockLogFromError).toHaveBeenCalledTimes(1);
    expect(mockLogFromError.mock.calls[0][2]).toEqual({ tenantId: 'tenant-a', stixId: 'intrusion-set--broken' });
    // The run stays succeeded, so the count of lost actors has nowhere else on the row to live.
    expect(updateProgress).toHaveBeenCalledWith({ processedTotal: 2, message: '2 rebuilt, 0 retracted, 1 failed' });
  });

  it('should do nothing at all once the run is aborted', async () => {
    const aborted = new AbortController();
    aborted.abort();

    await openctiMirrorRebuildHandler(context({ signal: aborted.signal }));

    expect(mockRebuildPendingBatch).not.toHaveBeenCalled();
  });

  it('should stop between batches when the run is aborted mid-drain', async () => {
    const controller = new AbortController();
    mockRebuildPendingBatch.mockImplementation(() => {
      controller.abort();
      return Promise.resolve(batch({ scanned: 200, settled: 200 }));
    });

    await openctiMirrorRebuildHandler(context({ signal: controller.signal }));

    expect(mockRebuildPendingBatch).toHaveBeenCalledTimes(1);
  });
});
