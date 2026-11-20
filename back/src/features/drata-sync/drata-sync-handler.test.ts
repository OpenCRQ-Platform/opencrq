import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobContext } from '@app/module';
import type { DrataSyncPayload } from './drata-types';

const mockGetConnectorId = vi.fn().mockResolvedValue('connector-id-abc');
const mockMarkSynced = vi.fn().mockResolvedValue(undefined);
const mockReplaceMirror = vi.fn().mockResolvedValue(undefined);
const mockCreateDrataClient = vi.fn();

const mockWithOrigin = vi.fn().mockReturnValue({
  integrationSettings: { getConnectorId: mockGetConnectorId, markSynced: mockMarkSynced },
  drata: { replaceMirror: mockReplaceMirror },
});

vi.mock('../../utils/logger', () => ({
  createLogger: vi.fn().mockReturnValue({ logTrace: vi.fn(), logFromError: vi.fn() }),
}));

vi.mock('@app/module', () => ({
  allServiceDefinitions: [],
  createServices: vi.fn().mockReturnValue({ withOrigin: mockWithOrigin }),
  NonRetryableError: class NonRetryableError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'NonRetryableError';
    }
  },
}));

vi.mock('../../engines/db', () => ({
  dbEngine: { db: {} },
}));

vi.mock('../../config', () => ({
  config: vi.fn().mockReturnValue({ connectors: undefined }),
}));

vi.mock('./drata-api-client', () => ({
  createDrataClient: mockCreateDrataClient,
}));

const { drataSyncHandler } = await import('./drata-sync-handler');

const makeCtx = (
  overrides: Partial<JobContext<DrataSyncPayload>> = {},
): JobContext<DrataSyncPayload> => ({
  jobId: 'job-drata-1',
  tenantId: 'tenant-abc',
  kind: 'drata-sync',
  interactive: true,
  payload: { serviceAccountId: 'sa-abc' },
  attempt: 1,
  state: null,
  signal: new AbortController().signal,
  updateProgress: vi.fn().mockResolvedValue(undefined),
  saveStateSnapshot: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

const DRATA_CONFIG = {
  connectors: {
    drata: { 'tenant-abc': { url: 'https://abc.drata.example.com', api_key: 'key-abc', workspace_id: 1 } },
  },
};

describe('drataSyncHandler: the controls it leaves to the derivation', () => {
  beforeEach(() => {
    mockCreateDrataClient.mockReturnValue({
      listFrameworks: vi.fn().mockResolvedValue([]),
      listFrameworkRequirements: vi.fn().mockResolvedValue([]),
      listControls: vi.fn().mockResolvedValue([]),
    });
  });

  afterEach(() => {
    mockReplaceMirror.mockClear();
  });

  it('replaces the mirror and writes no control, which it is given no service for', async () => {
    const { config: mockConfig } = await import('../../config');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock; partial config
    vi.mocked(mockConfig).mockReturnValueOnce(DRATA_CONFIG as never);

    await drataSyncHandler(makeCtx({ tenantId: 'tenant-abc' }));

    expect(mockReplaceMirror).toHaveBeenCalledOnce();
    expect(mockMarkSynced).toHaveBeenCalled();
  });
});

describe('drataSyncHandler — tenant isolation of connectors.drata', () => {
  beforeEach(() => {
    mockCreateDrataClient.mockReturnValue({
      listFrameworks: vi.fn().mockResolvedValue([]),
      listFrameworkRequirements: vi.fn().mockResolvedValue([]),
      listControls: vi.fn().mockResolvedValue([]),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockCreateDrataClient.mockClear();
  });

  it('throws NonRetryableError when the requesting tenant has no drata entry', async () => {
    const { config: mockConfig } = await import('../../config');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock; partial config
    vi.mocked(mockConfig).mockReturnValueOnce({ connectors: undefined } as never);

    await expect(drataSyncHandler(makeCtx())).rejects.toThrow('drata connector config is missing for this tenant');
    expect(mockCreateDrataClient).not.toHaveBeenCalled();
  });

  it('creates the Drata client with only the requesting tenant\'s own credentials, never another tenant\'s', async () => {
    const { config: mockConfig } = await import('../../config');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock; partial config
    vi.mocked(mockConfig).mockReturnValueOnce({
      connectors: {
        drata: {
          'tenant-abc': { url: 'https://abc.drata.example.com', api_key: 'key-abc', workspace_id: 1 },
          'tenant-other': { url: 'https://other.drata.example.com', api_key: 'key-other', workspace_id: 2 },
        },
      },
    } as never);

    await drataSyncHandler(makeCtx({ tenantId: 'tenant-abc' }));

    expect(mockCreateDrataClient).toHaveBeenCalledWith('https://abc.drata.example.com', 'key-abc', 1, expect.anything());
  });

  it('throws when the requesting tenant has no entry, even though another tenant is fully configured', async () => {
    const { config: mockConfig } = await import('../../config');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock; partial config
    vi.mocked(mockConfig).mockReturnValueOnce({
      connectors: {
        drata: {
          'tenant-other': { url: 'https://other.drata.example.com', api_key: 'key-other', workspace_id: 1 },
        },
      },
    } as never);

    await expect(drataSyncHandler(makeCtx({ tenantId: 'tenant-abc' }))).rejects.toThrow('drata connector config is missing for this tenant');
    expect(mockCreateDrataClient).not.toHaveBeenCalled();
  });
});
