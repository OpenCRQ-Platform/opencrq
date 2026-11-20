import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobContext } from '@app/module';

const mockPurgeExpiredRuns = vi.fn().mockResolvedValue({ runsDeleted: 0 });

const mockWithOrigin = vi.fn().mockReturnValue({
  jobs: { purgeExpiredRuns: mockPurgeExpiredRuns },
});

vi.mock('@app/module', () => ({
  allServiceDefinitions: [],
  createServices: vi.fn().mockReturnValue({ withOrigin: mockWithOrigin }),
}));

vi.mock('../../engines/db', () => ({
  dbEngine: { db: {} },
}));

vi.mock('../../utils/logger', () => ({
  createLogger: vi.fn().mockReturnValue({ logTrace: vi.fn(), logFromError: vi.fn() }),
}));

const mockConfig = vi.fn();
vi.mock('../../config', () => ({
  config: mockConfig,
}));

const { jobsRetentionHandler } = await import('./retention-handler');

const TENANT_ID = 'tenant-abc';
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-09-18T12:00:00.000Z').getTime();

const makeCtx = (overrides: Partial<JobContext> = {}): JobContext => ({
  jobId: 'job-1',
  tenantId: TENANT_ID,
  kind: 'jobs-retention',
  interactive: false,
  payload: {},
  attempt: 1,
  state: null,
  signal: new AbortController().signal,
  updateProgress: vi.fn(),
  saveStateSnapshot: vi.fn(),
  ...overrides,
});

describe('jobsRetentionHandler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mockPurgeExpiredRuns.mockClear();
    mockWithOrigin.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns immediately without calling services when the signal is already aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();

    await jobsRetentionHandler(makeCtx({ signal: ctrl.signal }));

    expect(mockPurgeExpiredRuns).not.toHaveBeenCalled();
  });

  it('computes the bound from the configured retention days', async () => {
    mockConfig.mockReturnValue({ jobs: { enabled: true, run_retention_days: 30 } });

    await jobsRetentionHandler(makeCtx());

    expect(mockPurgeExpiredRuns).toHaveBeenCalledWith(TENANT_ID, {
      runOlderThan: new Date(NOW - 30 * DAY_MS),
    });
  });

  it('falls back to the default retention days when the config carries none', async () => {
    mockConfig.mockReturnValue({ jobs: undefined });

    await jobsRetentionHandler(makeCtx());

    expect(mockPurgeExpiredRuns).toHaveBeenCalledWith(TENANT_ID, {
      runOlderThan: new Date(NOW - 30 * DAY_MS),
    });
  });

  it('uses a job origin scoped to the run tenant and kind', async () => {
    mockConfig.mockReturnValue({ jobs: { enabled: true, run_retention_days: 30 } });

    await jobsRetentionHandler(makeCtx({ interactive: true }));

    expect(mockWithOrigin).toHaveBeenCalledWith({
      type: 'job',
      tenantId: TENANT_ID,
      jobKind: 'jobs-retention',
      interactive: true,
    });
  });
});
