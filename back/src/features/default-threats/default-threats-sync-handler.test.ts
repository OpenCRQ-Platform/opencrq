import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobContext } from '@app/module';
import type { DefaultThreatsSyncState } from './default-threats-sync-handler';

const mockGetSettings = vi.fn();
const mockLoadDataset = vi.fn();
const mockParse = vi.fn();
const mockFetch = vi.fn<(url: string, init: { headers: Record<string, string> }) => Promise<Response>>();

vi.mock('../../utils/logger', () => ({
  createLogger: vi.fn().mockReturnValue({ logTrace: vi.fn(), logTraceFromError: vi.fn() }),
}));

vi.mock('@app/module', () => ({
  allServiceDefinitions: [],
  OUTCOME_COUNTER_VERSION: '2026.11',
  createServices: vi.fn().mockReturnValue({
    withOrigin: vi.fn().mockReturnValue({ defaultThreats: { getSettings: mockGetSettings, loadDataset: mockLoadDataset } }),
  }),
  parseDefaultThreatsDataset: (json: unknown) => mockParse(json),
  NonRetryableError: class NonRetryableError extends Error {},
  CONNECTOR_INVENTORY: {},
  INTEGRATION_SOURCES: [],
  DEFAULT_THREATS_DATASET_FILE: 'default-threats-v1.json',
  nextOccurrence: vi.fn(),
}));

vi.mock('../../engines/db', () => ({ dbEngine: { db: {} } }));

vi.mock('../../config', () => ({
  config: () => ({ connectors: { default_threats: { dataset_url: 'https://mirror.example.com/data/' } } }),
}));

const { defaultThreatsSyncHandler } = await import('./default-threats-sync-handler');

const makeCtx = (): JobContext<Record<string, unknown>, DefaultThreatsSyncState> => ({
  jobId: 'job-1',
  tenantId: 'tenant-abc',
  kind: 'default-threats-sync',
  interactive: false,
  payload: {},
  attempt: 1,
  state: null,
  signal: new AbortController().signal,
  updateProgress: vi.fn(),
  saveStateSnapshot: vi.fn(),
});

const STAMP = 'unversioned+counter-2026.11';

const settings = (overrides: Record<string, unknown> = {}) => ({
  enabled: true, etag: '"v1"', lastModified: null, appVersion: STAMP, attackRelease: '20.0', loadedAt: new Date(), ...overrides,
});

const DATASET = { attackRelease: '20.0', threats: [{}, {}], ignoredTechniqueClaims: 0 };

const sentHeaders = (): Record<string, string> | undefined => mockFetch.mock.lastCall?.[1].headers;

describe('defaultThreatsSyncHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);
    mockParse.mockReturnValue(DATASET);
    mockLoadDataset.mockResolvedValue({ created: 2, updated: 0, retracted: 0 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('reads the file of its format major under the configured dataset URL', async () => {
    mockGetSettings.mockResolvedValue(settings());
    mockFetch.mockResolvedValue(new Response(null, { status: 304 }));

    await defaultThreatsSyncHandler(makeCtx());

    expect(mockFetch.mock.lastCall?.[0]).toBe('https://mirror.example.com/data/default-threats-v1.json');
  });

  it('asks for the file only if it changed, and loads nothing when it did not', async () => {
    mockGetSettings.mockResolvedValue(settings());
    mockFetch.mockResolvedValue(new Response(null, { status: 304 }));

    await defaultThreatsSyncHandler(makeCtx());

    expect(sentHeaders()).toEqual({ 'If-None-Match': '"v1"' });
    expect(mockLoadDataset).not.toHaveBeenCalled();
  });

  it('reports the release it holds, and no count of ignored claims, when the file did not change', async () => {
    mockGetSettings.mockResolvedValue(settings());
    mockFetch.mockResolvedValue(new Response(null, { status: 304 }));
    const ctx = makeCtx();

    await defaultThreatsSyncHandler(ctx);

    expect(ctx.saveStateSnapshot).toHaveBeenCalledWith({ fileChanged: false, attackRelease: '20.0', ignoredTechniqueClaims: null });
  });

  it('falls back to Last-Modified when the server gave no ETag', async () => {
    mockGetSettings.mockResolvedValue(settings({ etag: null, lastModified: 'Wed, 04 Nov 2026 11:32:03 GMT' }));
    mockFetch.mockResolvedValue(new Response(null, { status: 304 }));

    await defaultThreatsSyncHandler(makeCtx());

    expect(sentHeaders()).toEqual({ 'If-Modified-Since': 'Wed, 04 Nov 2026 11:32:03 GMT' });
  });

  it('loads the file whatever it says on a tenant with no load recorded', async () => {
    mockGetSettings.mockResolvedValue(settings({ loadedAt: null }));
    mockFetch.mockResolvedValue(new Response('{}', { status: 200, headers: { etag: '"v2"' } }));

    await defaultThreatsSyncHandler(makeCtx());

    expect(sentHeaders()).toEqual({});
    expect(mockLoadDataset).toHaveBeenCalledWith(DATASET, { etag: '"v2"', lastModified: null, appVersion: STAMP });
  });

  it('loads the file whatever it says after an app upgrade', async () => {
    vi.stubEnv('APP_VERSION', '2.1.0');
    mockGetSettings.mockResolvedValue(settings({ appVersion: '2.0.0+counter-2026.11' }));
    mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));

    await defaultThreatsSyncHandler(makeCtx());

    expect(sentHeaders()).toEqual({});
    expect(mockLoadDataset).toHaveBeenCalledWith(DATASET, expect.objectContaining({ appVersion: '2.1.0+counter-2026.11' }));
  });

  it('loads the file whatever it says after an outcome model upgrade on a checkout with no app version', async () => {
    mockGetSettings.mockResolvedValue(settings({ appVersion: 'unversioned+counter-2026.10' }));
    mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));

    await defaultThreatsSyncHandler(makeCtx());

    expect(sentHeaders()).toEqual({});
    expect(mockLoadDataset).toHaveBeenCalledWith(DATASET, expect.objectContaining({ appVersion: STAMP }));
  });

  it('does nothing on a tenant that switched the connector off', async () => {
    mockGetSettings.mockResolvedValue(settings({ enabled: false }));

    await defaultThreatsSyncHandler(makeCtx());

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fails without retrying on a file it cannot read, loading nothing', async () => {
    mockGetSettings.mockResolvedValue(settings({ loadedAt: null }));
    mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));
    mockParse.mockImplementation(() => {
      throw new Error('not a bundle');
    });

    await expect(defaultThreatsSyncHandler(makeCtx())).rejects.toThrow('not a STIX bundle');
    expect(mockLoadDataset).not.toHaveBeenCalled();
  });

  it('fails without retrying on a body that is not JSON, loading nothing', async () => {
    mockGetSettings.mockResolvedValue(settings({ loadedAt: null }));
    mockFetch.mockResolvedValue(new Response('<html>', { status: 200 }));

    await expect(defaultThreatsSyncHandler(makeCtx())).rejects.toThrow('not a STIX bundle');
    expect(mockLoadDataset).not.toHaveBeenCalled();
  });

  it('fails with the transport error, not an unreadable file, on a body cut short', async () => {
    mockGetSettings.mockResolvedValue(settings({ loadedAt: null }));
    const cut = new ReadableStream({ start: (controller) => controller.error(new Error('connection reset')) });
    mockFetch.mockResolvedValue(new Response(cut, { status: 200 }));

    await expect(defaultThreatsSyncHandler(makeCtx())).rejects.toThrow('connection reset');
    expect(mockLoadDataset).not.toHaveBeenCalled();
  });

  it('fails a run the server answers with an error, loading nothing', async () => {
    mockGetSettings.mockResolvedValue(settings());
    mockFetch.mockResolvedValue(new Response(null, { status: 503, statusText: 'Service Unavailable' }));

    await expect(defaultThreatsSyncHandler(makeCtx())).rejects.toThrow('503');
    expect(mockLoadDataset).not.toHaveBeenCalled();
  });
});
