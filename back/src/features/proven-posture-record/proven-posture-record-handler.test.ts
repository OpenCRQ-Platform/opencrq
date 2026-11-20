import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobContext } from '@app/module';

const mockRecord = vi.fn().mockResolvedValue({ lines: 0, replayedLines: 0, replayedDays: 0 });
const mockGetIntegrationSettings = vi.fn();
const mockWithOrigin = vi.fn().mockReturnValue({
  controlValidation: { recordProvenPostureHistory: mockRecord },
  integrationSettings: { getIntegrationSettings: mockGetIntegrationSettings },
});
const mockConfig = vi.fn();

vi.mock('@app/module', () => ({
  allServiceDefinitions: [],
  createServices: vi.fn().mockReturnValue({ withOrigin: mockWithOrigin }),
}));

vi.mock('../../config', () => ({ config: () => mockConfig() }));

vi.mock('../../utils/logger', () => ({
  createLogger: vi.fn().mockReturnValue({ logTrace: vi.fn(), logFromError: vi.fn() }),
}));

const { provenPostureRecordHandler } = await import('./proven-posture-record-handler');

const TENANT_ID = 'tenant-abc';

const makeCtx = (overrides: Partial<JobContext> = {}): JobContext => ({
  jobId: 'job-proven-posture-1',
  tenantId: TENANT_ID,
  kind: 'proven-posture-record',
  interactive: false,
  payload: {},
  attempt: 1,
  state: null,
  signal: new AbortController().signal,
  updateProgress: vi.fn().mockResolvedValue(undefined),
  saveStateSnapshot: vi.fn().mockResolvedValue(undefined),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the services factory is mocked, so the run's instance is only passed through
  runDb: {} as never,
  ...overrides,
});

const platformConfigured = { connectors: { openaev: { [TENANT_ID]: { url: 'https://openaev.example' } } } };
const tenantBound = { source: 'openaev', serviceAccountId: 'service-account-1' };

describe('provenPostureRecordHandler', () => {
  beforeEach(() => {
    mockRecord.mockClear();
    mockWithOrigin.mockClear();
    mockConfig.mockReturnValue(platformConfigured);
    mockGetIntegrationSettings.mockResolvedValue(tenantBound);
  });

  it('refuses to run unobserved', async () => {
    await expect(provenPostureRecordHandler(makeCtx({ runDb: undefined }))).rejects.toThrow('proven posture recording must run as an observed job');
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it('records under the job of the tenant it was booked for when OpenAEV is configured on both sides', async () => {
    const ctx = makeCtx();

    await provenPostureRecordHandler(ctx);

    expect(mockWithOrigin).toHaveBeenCalledWith({ type: 'job', tenantId: TENANT_ID, jobKind: 'proven-posture-record', interactive: false });
    expect(mockRecord).toHaveBeenCalledExactlyOnceWith({ now: expect.any(Date), signal: ctx.signal });
  });

  it('records nothing without the deployment credentials, after reading the tenant binding', async () => {
    mockConfig.mockReturnValue({ connectors: {} });

    await provenPostureRecordHandler(makeCtx());

    expect(mockGetIntegrationSettings).toHaveBeenCalledWith('openaev');
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it.each([
    ['no binding', null],
    ['a binding without a service account', { source: 'openaev', serviceAccountId: null }],
  ])('records nothing with %s', async (_, settings) => {
    mockGetIntegrationSettings.mockResolvedValue(settings);

    await provenPostureRecordHandler(makeCtx());

    expect(mockRecord).not.toHaveBeenCalled();
  });
});
