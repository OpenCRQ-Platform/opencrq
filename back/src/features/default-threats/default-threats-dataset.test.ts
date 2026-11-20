import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetSettings = vi.fn();
const mockLoadDataset = vi.fn();
const mockFetch = vi.fn<(url: string, init: { signal: AbortSignal }) => Promise<Response>>();

vi.mock('../../utils/logger', () => ({
  createLogger: vi.fn().mockReturnValue({ logFromError: vi.fn(), logTrace: vi.fn() }),
}));

vi.mock('@app/module', () => ({
  OUTCOME_COUNTER_VERSION: '2026.11',
  parseDefaultThreatsDataset: () => DATASET,
  NonRetryableError: class NonRetryableError extends Error {},
  CONNECTOR_INVENTORY: {},
  INTEGRATION_SOURCES: [],
  DEFAULT_THREATS_DATASET_FILE: 'default-threats-v1.json',
  nextOccurrence: vi.fn(),
}));

vi.mock('../../config', () => ({
  config: () => ({ connectors: { default_threats: { dataset_url: 'https://mirror.example.com/data/' } } }),
}));

const DATASET = { attackRelease: '20.0', threats: [{}, {}], ignoredTechniqueClaims: 0 };

const { seedDefaultThreatsLoad } = await import('./default-threats-dataset');

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock, the load reads these two methods alone
const services = { defaultThreats: { getSettings: mockGetSettings, loadDataset: mockLoadDataset } } as unknown as Parameters<typeof seedDefaultThreatsLoad>[0];

describe('seedDefaultThreatsLoad', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);
    mockLoadDataset.mockResolvedValue({ created: 2, updated: 0, retracted: 0 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads the file whole and records it under the sync\'s stamp, so the boot sync asks only for a change', async () => {
    mockGetSettings.mockResolvedValue({ enabled: true });
    mockFetch.mockResolvedValue(new Response('{}', { status: 200, headers: { etag: '"v2"' } }));

    await seedDefaultThreatsLoad(services, 'tenant-abc');

    expect(mockGetSettings).toHaveBeenCalledWith('tenant-abc');
    expect(mockFetch.mock.lastCall?.[0]).toBe('https://mirror.example.com/data/default-threats-v1.json');
    expect(mockLoadDataset).toHaveBeenCalledWith(DATASET, { etag: '"v2"', lastModified: null, appVersion: 'unversioned+counter-2026.11' });
  });

  it('loads nothing on a tenant that switched the connector off', async () => {
    mockGetSettings.mockResolvedValue({ enabled: false });

    await seedDefaultThreatsLoad(services, 'tenant-abc');

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockLoadDataset).not.toHaveBeenCalled();
  });

  it('fails on a server error, loading nothing, so the first boot loads it', async () => {
    mockGetSettings.mockResolvedValue({ enabled: true });
    mockFetch.mockResolvedValue(new Response(null, { status: 503, statusText: 'Service Unavailable' }));

    await expect(seedDefaultThreatsLoad(services, 'tenant-abc')).rejects.toThrow('503');
    expect(mockLoadDataset).not.toHaveBeenCalled();
  });
});
