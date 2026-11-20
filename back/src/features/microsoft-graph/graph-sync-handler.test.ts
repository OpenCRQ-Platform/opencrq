import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobContext } from '@app/module';
import type { GraphSyncPayload, GraphSyncState } from './graph-types';
import type * as PrimaryUsersModule from './graph-primary-users';

const mockGetConnectorId = vi.fn().mockResolvedValue('connector-id-abc');
const mockMarkSynced = vi.fn().mockResolvedValue(undefined);
const mockAcquireToken = vi.fn().mockResolvedValue({ accessToken: 'tok', expiresAt: Date.now() + 3_600_000 });
const mockIsTokenExpired = vi.fn().mockReturnValue(false);

const mockUpsertDefenderReports = vi.fn().mockResolvedValue(undefined);
const mockGetCveIdMap = vi.fn().mockResolvedValue(new Map());
const mockBulkUpsertAssets = vi.fn().mockResolvedValue(new Map());
const mockBulkUpsertEvidence = vi.fn().mockResolvedValue({ applicable: 0, dismissed: 0 });
const mockMarkEnumerated = vi.fn().mockResolvedValue(undefined);
const mockRecomputeState = vi.fn().mockResolvedValue(0);
const mockGetRelationEndpoints = vi.fn().mockResolvedValue({ devices: [], identities: [] });
const mockListRelations = vi.fn().mockResolvedValue([]);
const mockReconcileRelations = vi.fn().mockResolvedValue({ written: 0, removed: 0 });
const mockRetireSuperseded = vi.fn().mockResolvedValue(0);
const mockRetireConnectorSources = vi.fn().mockResolvedValue({ sources: 0, assets: 0 });
const mockReadEntraDevices = vi.fn().mockResolvedValue({ status: 'answered', items: [] });
const mockReadIntuneDevices = vi.fn().mockResolvedValue({ status: 'answered', items: [] });

const mockWithOrigin = vi.fn().mockReturnValue({
  integrationSettings: { getConnectorId: mockGetConnectorId, markSynced: mockMarkSynced },
  cve: { upsertDefenderReports: mockUpsertDefenderReports, getCveIdMap: mockGetCveIdMap },
  supportingAssets: {
    bulkUpsertAssets: mockBulkUpsertAssets,
    bulkUpsertEvidence: mockBulkUpsertEvidence,
    markAssetsEnumerated: mockMarkEnumerated,
    recomputeEvidenceStateForAssets: mockRecomputeState,
    getConnectorRelationEndpoints: mockGetRelationEndpoints,
    listConnectorRelations: mockListRelations,
    reconcileConnectorRelations: mockReconcileRelations,
    retireSupersededSources: mockRetireSuperseded,
    retireConnectorSources: mockRetireConnectorSources,
  },
});

const mockLogTrace = vi.fn();
const mockLogTraceFromError = vi.fn();

vi.mock('../../utils/logger', () => ({
  createLogger: vi.fn().mockReturnValue({ logTrace: mockLogTrace, logFromError: vi.fn(), logTraceFromError: mockLogTraceFromError }),
}));

vi.mock('@app/module', () => ({
  allServiceDefinitions: [],
  ASSET_CRITICALITY_SEVERITY: { unknown: 0, low: 1, medium: 2, high: 3, very_high: 4 },
  createServices: vi.fn().mockReturnValue({ withOrigin: mockWithOrigin }),
  SUBCATEGORY_TO_CATEGORY: { switch: 'network_device' },
  normalizeMacs: (macs: ReadonlyArray<string> | null) => [...(macs ?? [])].filter((mac) => mac !== ''),
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

vi.mock('./graph-auth', () => ({
  acquireToken: mockAcquireToken,
  isTokenExpired: mockIsTokenExpired,
}));

// The two Graph reads only: these fixtures stub `fetch` with hunting responses, and the join and
// the closing line stay real.
vi.mock('./graph-primary-users', async (importOriginal) => ({
  ...await importOriginal<typeof PrimaryUsersModule>(),
  readEntraDevices: mockReadEntraDevices,
  readIntuneDevices: mockReadIntuneDevices,
}));

const { graphSyncHandler } = await import('./graph-sync-handler');

const makeCtx = (
  overrides: Partial<JobContext<GraphSyncPayload, GraphSyncState>> = {},
): JobContext<GraphSyncPayload, GraphSyncState> => ({
  jobId: 'job-graph-1',
  tenantId: 'tenant-abc',
  kind: 'microsoft-graph-sync',
  interactive: true,
  payload: { serviceAccountId: 'sa-abc' },
  attempt: 1,
  state: null,
  signal: new AbortController().signal,
  updateProgress: vi.fn().mockResolvedValue(undefined),
  saveStateSnapshot: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

/**
 * The queries the identity pass issues after the device loop: the two logon reads and one identity
 * page. Named rather than folded into each total, so a device-pass assertion still reads as being
 * about the device pass. The identity count is not among them — it is read up front, beside the
 * device count, so the progress bar's denominator never grows mid-run.
 */
const IDENTITY_PASS_QUERIES = 3;

/** The identity count the preamble reads right after the device count. These fixtures carry none. */
const noIdentitiesCounted = () => new Response(JSON.stringify({ schema: [], results: [{ Count: 0 }] }), { status: 200 });

const emptyHuntingResult = { schema: [], results: [] };
// A Response body reads once, and one sync issues several queries.
const emptyHuntingResponse = () => new Response(JSON.stringify(emptyHuntingResult), { status: 200 });

describe('graphSyncHandler: tenant isolation of connectors.microsoft_graph', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(emptyHuntingResponse())));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    mockAcquireToken.mockClear();
  });

  it('throws NonRetryableError when the requesting tenant has no microsoft_graph entry', async () => {
    const { config: mockConfig } = await import('../../config');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock; partial config
    vi.mocked(mockConfig).mockReturnValueOnce({ connectors: undefined } as never);

    await expect(graphSyncHandler(makeCtx())).rejects.toThrow('microsoft_graph config is missing for this tenant');
    expect(mockAcquireToken).not.toHaveBeenCalled();
  });

  it('acquires a token with only the requesting tenant\'s own credentials, never another tenant\'s', async () => {
    const { config: mockConfig } = await import('../../config');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock; partial config
    vi.mocked(mockConfig).mockReturnValueOnce({
      connectors: {
        microsoft_graph: {
          'tenant-abc': { azure_tenant_id: 'az-abc', client_id: 'client-abc', client_secret: 'secret-abc' },
          'tenant-other': { azure_tenant_id: 'az-other', client_id: 'client-other', client_secret: 'secret-other' },
        },
      },
    } as never);

    await graphSyncHandler(makeCtx({ tenantId: 'tenant-abc' }));

    expect(mockAcquireToken).toHaveBeenCalledWith('az-abc', 'client-abc', 'secret-abc');
  });

  it('throws when the requesting tenant has no entry, even though another tenant is fully configured', async () => {
    const { config: mockConfig } = await import('../../config');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock; partial config
    vi.mocked(mockConfig).mockReturnValueOnce({
      connectors: {
        microsoft_graph: {
          'tenant-other': { azure_tenant_id: 'az-other', client_id: 'client-other', client_secret: 'secret-other' },
        },
      },
    } as never);

    await expect(graphSyncHandler(makeCtx({ tenantId: 'tenant-abc' }))).rejects.toThrow('microsoft_graph config is missing for this tenant');
    expect(mockAcquireToken).not.toHaveBeenCalled();
  });
});

describe('graphSyncHandler: progress in assets', () => {
  const tenantConfig = {
    connectors: {
      microsoft_graph: {
        'tenant-abc': { azure_tenant_id: 'az-abc', client_id: 'client-abc', client_secret: 'secret-abc' },
      },
    },
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('announces the device count before the first page, and issues a devices query then a findings query', async () => {
    const { config: mockConfig } = await import('../../config');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock; partial config
    vi.mocked(mockConfig).mockReturnValue(tenantConfig as never);
    const deviceRows = [
      { DeviceId: 'aa11', FirstSeen: '2026-08-01T00:00:00Z', LastSeen: '2026-08-30T00:00:00Z', IsInternetFacing: 'true' },
      { DeviceId: 'bb22', FirstSeen: '2026-08-01T00:00:00Z', LastSeen: '2026-08-30T00:00:00Z', IsInternetFacing: 'false' },
    ];
    const findingRows = [
      { DeviceId: 'aa11', CveId: 'CVE-2026-0001' },
      { DeviceId: 'aa11', CveId: 'CVE-2026-0002' },
      { DeviceId: 'bb22', CveId: 'CVE-2026-0001' },
    ];
    const fetchMock = vi.fn()
      .mockImplementation(() => Promise.resolve(emptyHuntingResponse()))
      .mockResolvedValueOnce(new Response(JSON.stringify({ schema: [], results: [{ Count: 2 }] }), { status: 200 }))
      .mockResolvedValueOnce(noIdentitiesCounted())
      .mockResolvedValueOnce(new Response(JSON.stringify({ schema: [], results: deviceRows }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ schema: [], results: findingRows }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { dbEngine } = await import('../../engines/db');
    (dbEngine as { db: { transaction?: unknown } }).db.transaction = vi.fn().mockResolvedValue({ dismissed: 0 });
    const ctx = makeCtx({ tenantId: 'tenant-abc' });

    await graphSyncHandler(ctx);

    expect(fetchMock).toHaveBeenCalledTimes(4 + IDENTITY_PASS_QUERIES);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      expect.objectContaining({ body: expect.stringContaining('| count') }),
    );
    // A page is a devices query (identity + network attributes) then a findings query (DeviceId x
    // CveId), never one wide query joining both: that split is what keeps a dense tenant's response
    // under the Advanced Hunting size limit.
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      expect.any(String),
      expect.objectContaining({ body: expect.stringContaining('DeviceInfo') }),
    );
    expect(fetchMock.mock.calls[2][1]).toEqual(expect.objectContaining({
      body: expect.not.stringContaining('DeviceTvmSoftwareVulnerabilities'),
    }));
    // The latest non-empty Entra device id, not the latest row's: DeviceInfo interleaves sparse rows.
    expect(String(fetchMock.mock.calls[2][1].body)).toContain('isnotempty(AadDeviceId)');
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      expect.any(String),
      expect.objectContaining({ body: expect.stringContaining('DeviceTvmSoftwareVulnerabilities') }),
    );
    const counted = vi.mocked(ctx.updateProgress).mock.calls
      .map(([progress]) => progress)
      .filter((progress) => progress.processedTotal !== undefined || progress.expectedTotal !== undefined);
    expect(counted).toEqual([
      { processedTotal: 0, expectedTotal: 2 },
      expect.objectContaining({ processedTotal: 0 }),
      expect.objectContaining({ processedTotal: 0 }),
      expect.objectContaining({ processedTotal: 2 }),
    ]);
    expect(ctx.saveStateSnapshot).toHaveBeenCalledWith(expect.objectContaining({ pageIndex: 1, cursor: 'bb22', devicesProcessed: 2 }));
  });

  it('names each step as it takes it', async () => {
    const { config: mockConfig } = await import('../../config');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock; partial config
    vi.mocked(mockConfig).mockReturnValue(tenantConfig as never);
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(emptyHuntingResponse())));
    const ctx = makeCtx({ tenantId: 'tenant-abc' });

    await graphSyncHandler(ctx);

    const steps = vi.mocked(ctx.updateProgress).mock.calls
      .map(([progress]) => progress.message)
      .filter((message): message is string => typeof message === 'string');
    expect(steps).toEqual([
      'Acquiring an access token from Microsoft Entra',
      'Counting the assets to sync',
      'Fetching page 1 from Microsoft Graph',
      'Fetching the accounts seen in logon events',
      'Reading the primary users of the devices from Microsoft Entra ID and Intune',
      'Recording the sync completion (0 findings dismissed as no longer reported, 0 primary users; Microsoft Entra ID answered, Intune answered)',
    ]);
  });
});

describe('graphSyncHandler: the device set a run walks', () => {
  const tenantConfig = {
    connectors: {
      microsoft_graph: {
        'tenant-abc': { azure_tenant_id: 'az-abc', client_id: 'client-abc', client_secret: 'secret-abc' },
      },
    },
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('asks Defender for every device it still holds, never only the ones that checked in since the last run', async () => {
    const { config: mockConfig } = await import('../../config');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock; partial config
    vi.mocked(mockConfig).mockReturnValue(tenantConfig as never);
    mockMarkSynced.mockClear();
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(emptyHuntingResponse()));
    vi.stubGlobal('fetch', fetchMock);

    await graphSyncHandler(makeCtx({ tenantId: 'tenant-abc' }));

    const queries = fetchMock.mock.calls.map(([, init]) => String(init.body));
    const deviceQueries = queries.filter((query) => query.includes('DeviceInfo'));
    expect(deviceQueries).not.toHaveLength(0);
    for (const query of deviceQueries) {
      expect(query).not.toContain('Timestamp > datetime(');
    }
  });

  it('still records the run stamp the connector page shows', async () => {
    const { config: mockConfig } = await import('../../config');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock; partial config
    vi.mocked(mockConfig).mockReturnValue(tenantConfig as never);
    mockMarkSynced.mockClear();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(emptyHuntingResponse())));

    await graphSyncHandler(makeCtx({ tenantId: 'tenant-abc' }));

    expect(mockMarkSynced).toHaveBeenCalledWith('microsoft_graph', expect.any(Date));
  });
});

describe('graphSyncHandler: the Advanced Hunting row cap', () => {
  const tenantConfig = {
    connectors: {
      microsoft_graph: {
        'tenant-abc': { azure_tenant_id: 'az-abc', client_id: 'client-abc', client_secret: 'secret-abc' },
      },
    },
  };
  // Usable both as a device row (deviceRowSchema ignores the extra CveId) and as a finding row
  // (findingRowSchema ignores the extra device attributes): one row shape, two query positions.
  const row = (deviceId: string, cveId: string) => ({
    DeviceId: deviceId, CveId: cveId, FirstSeen: '2026-08-01T00:00:00Z', LastSeen: '2026-08-30T00:00:00Z', IsInternetFacing: 'true',
  });
  const deviceRow = (deviceId: string) => ({
    DeviceId: deviceId, FirstSeen: '2026-08-01T00:00:00Z', LastSeen: '2026-08-30T00:00:00Z', IsInternetFacing: 'true',
  });
  const hunting = (results: Array<unknown>) => new Response(JSON.stringify({ schema: [], results }), { status: 200 });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('refuses a page whose findings query sits on the cap and asks again for half the devices', async () => {
    const { config: mockConfig } = await import('../../config');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock; partial config
    vi.mocked(mockConfig).mockReturnValue(tenantConfig as never);
    const cappedFindings = Array.from({ length: 100_000 }, (_, i) => row('aa11', `CVE-2026-${i}`));
    const fetchMock = vi.fn()
      .mockImplementation(() => Promise.resolve(emptyHuntingResponse()))
      .mockResolvedValueOnce(hunting([{ Count: 2 }]))
      .mockResolvedValueOnce(noIdentitiesCounted())
      .mockResolvedValueOnce(hunting([deviceRow('aa11')])) // device query #1, take 500
      .mockResolvedValueOnce(hunting(cappedFindings)) // findings query #1, take 500: sits on the cap
      .mockResolvedValueOnce(hunting([deviceRow('aa11'), deviceRow('bb22')])) // device query #2, take 250
      .mockResolvedValueOnce(hunting([row('bb22', 'CVE-2026-1'), row('aa11', 'CVE-2026-2')])); // findings query #2, take 250
    vi.stubGlobal('fetch', fetchMock);
    const { dbEngine } = await import('../../engines/db');
    (dbEngine as { db: { transaction?: unknown } }).db.transaction = vi.fn().mockResolvedValue({ dismissed: 0 });
    const ctx = makeCtx({ tenantId: 'tenant-abc' });

    await graphSyncHandler(ctx);

    expect(fetchMock).toHaveBeenCalledTimes(6 + IDENTITY_PASS_QUERIES);
    expect(fetchMock).toHaveBeenNthCalledWith(3, expect.any(String), expect.objectContaining({ body: expect.stringContaining('| take 500') }));
    expect(fetchMock).toHaveBeenNthCalledWith(4, expect.any(String), expect.objectContaining({ body: expect.stringContaining('dynamic([\\"aa11\\"])') }));
    expect(fetchMock).toHaveBeenNthCalledWith(5, expect.any(String), expect.objectContaining({ body: expect.stringContaining('| take 250') }));
    expect(fetchMock).toHaveBeenNthCalledWith(6, expect.any(String), expect.objectContaining({ body: expect.stringContaining('dynamic([\\"aa11\\",\\"bb22\\"])') }));
    expect(ctx.saveStateSnapshot).toHaveBeenCalledWith(expect.objectContaining({ cursor: 'bb22', devicesProcessed: 2, pageSize: 500 }));
    expect(ctx.updateProgress).toHaveBeenCalledWith(expect.objectContaining({ processedTotal: 2 }));
  });

  it('reads fewer devices than the page is owed as a truncation, whatever the finding row count', async () => {
    const { config: mockConfig } = await import('../../config');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock; partial config
    vi.mocked(mockConfig).mockReturnValue(tenantConfig as never);
    const fetchMock = vi.fn()
      .mockImplementation(() => Promise.resolve(emptyHuntingResponse()))
      .mockResolvedValueOnce(hunting([{ Count: 3 }]))
      .mockResolvedValueOnce(noIdentitiesCounted())
      .mockResolvedValueOnce(hunting([deviceRow('aa11'), deviceRow('bb22')]))
      .mockResolvedValueOnce(hunting([row('aa11', 'CVE-2026-1'), row('bb22', 'CVE-2026-1')]))
      .mockResolvedValueOnce(hunting([deviceRow('aa11'), deviceRow('bb22'), deviceRow('cc33')]))
      .mockResolvedValueOnce(hunting([row('aa11', 'CVE-2026-1'), row('bb22', 'CVE-2026-1'), row('cc33', 'CVE-2026-1')]));
    vi.stubGlobal('fetch', fetchMock);
    const { dbEngine } = await import('../../engines/db');
    (dbEngine as { db: { transaction?: unknown } }).db.transaction = vi.fn().mockResolvedValue({ dismissed: 0 });
    const ctx = makeCtx({ tenantId: 'tenant-abc' });

    await graphSyncHandler(ctx);

    expect(fetchMock).toHaveBeenCalledTimes(6 + IDENTITY_PASS_QUERIES);
    expect(fetchMock).toHaveBeenNthCalledWith(5, expect.any(String), expect.objectContaining({ body: expect.stringContaining('| take 250') }));
    expect(ctx.saveStateSnapshot).toHaveBeenCalledWith(expect.objectContaining({ cursor: 'cc33', devicesProcessed: 3 }));
  });

  it('accepts a short page once a shorter ask returns the same devices, the count having drifted', async () => {
    const { config: mockConfig } = await import('../../config');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock; partial config
    vi.mocked(mockConfig).mockReturnValue(tenantConfig as never);
    const twoDeviceRows = () => hunting([deviceRow('aa11'), deviceRow('bb22')]);
    const twoFindingRows = () => hunting([row('aa11', 'CVE-2026-1'), row('bb22', 'CVE-2026-1')]);
    const fetchMock = vi.fn()
      .mockImplementation(() => Promise.resolve(emptyHuntingResponse()))
      .mockResolvedValueOnce(hunting([{ Count: 3 }]))
      .mockResolvedValueOnce(noIdentitiesCounted())
      .mockResolvedValueOnce(twoDeviceRows())
      .mockResolvedValueOnce(twoFindingRows())
      .mockResolvedValueOnce(twoDeviceRows())
      .mockResolvedValueOnce(twoFindingRows());
    vi.stubGlobal('fetch', fetchMock);
    const { dbEngine } = await import('../../engines/db');
    (dbEngine as { db: { transaction?: unknown } }).db.transaction = vi.fn().mockResolvedValue({ dismissed: 0 });
    const ctx = makeCtx({ tenantId: 'tenant-abc' });

    await graphSyncHandler(ctx);

    expect(fetchMock).toHaveBeenCalledTimes(6 + IDENTITY_PASS_QUERIES);
    expect(ctx.saveStateSnapshot).toHaveBeenCalledWith(expect.objectContaining({ cursor: 'bb22', devicesProcessed: 2 }));
    expect(mockMarkSynced).toHaveBeenCalled();
  });

  it('counts a device whose row fails validation as received, so the page is owed nothing more', async () => {
    const { config: mockConfig } = await import('../../config');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock; partial config
    vi.mocked(mockConfig).mockReturnValue(tenantConfig as never);
    const fetchMock = vi.fn()
      .mockImplementation(() => Promise.resolve(emptyHuntingResponse()))
      .mockResolvedValueOnce(hunting([{ Count: 2 }]))
      .mockResolvedValueOnce(noIdentitiesCounted())
      .mockResolvedValueOnce(hunting([deviceRow('aa11'), { DeviceId: 'bb22' }])) // bb22 misses FirstSeen/LastSeen
      .mockResolvedValueOnce(hunting([row('aa11', 'CVE-2026-1'), row('bb22', 'CVE-2026-1')]));
    vi.stubGlobal('fetch', fetchMock);
    const { dbEngine } = await import('../../engines/db');
    (dbEngine as { db: { transaction?: unknown } }).db.transaction = vi.fn().mockResolvedValue({ dismissed: 0 });
    const ctx = makeCtx({ tenantId: 'tenant-abc' });

    await graphSyncHandler(ctx);

    expect(fetchMock).toHaveBeenCalledTimes(4 + IDENTITY_PASS_QUERIES);
    expect(ctx.saveStateSnapshot).toHaveBeenCalledWith(expect.objectContaining({ cursor: 'bb22', devicesProcessed: 2 }));
  });

  it('gives up on a single device that alone exceeds the cap, rather than storing a partial one', async () => {
    const { config: mockConfig } = await import('../../config');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock; partial config
    vi.mocked(mockConfig).mockReturnValue(tenantConfig as never);
    const capped = Array.from({ length: 100_000 }, (_, i) => row('aa11', `CVE-2026-${i}`));
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(hunting(capped))));
    const ctx = makeCtx({ tenantId: 'tenant-abc', state: { pageIndex: 0, cursor: null, devicesProcessed: 0, findingsDismissed: 0, pageSize: 1, syncStartedAt: '2026-09-01T14:02:01Z' } });

    await expect(graphSyncHandler(ctx)).rejects.toThrow('a single device exceeds');
  });
});

describe('graphSyncHandler: the Advanced Hunting response size limit', () => {
  const tenantConfig = {
    connectors: {
      microsoft_graph: {
        'tenant-abc': { azure_tenant_id: 'az-abc', client_id: 'client-abc', client_secret: 'secret-abc' },
      },
    },
  };
  const deviceRow = (deviceId: string) => ({
    DeviceId: deviceId, FirstSeen: '2026-08-01T00:00:00Z', LastSeen: '2026-08-30T00:00:00Z', IsInternetFacing: 'true',
  });
  const findingRow = (deviceId: string, cveId: string) => ({ DeviceId: deviceId, CveId: cveId });
  const hunting = (results: Array<unknown>) => new Response(JSON.stringify({ schema: [], results }), { status: 200 });
  // Distinct from a truncated (200, at the row cap) response: this is a 400 refusal, reached
  // before the row cap on a page whose response simply weighs too much.
  const tooLarge = () => new Response(
    'Query execution has exceeded the allowed result size. Optimize your query by limiting the amount of results and try again.',
    { status: 400 },
  );

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('treats a 400 result-size refusal like a truncated page: shrinks the page size and retries', async () => {
    const { config: mockConfig } = await import('../../config');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock; partial config
    vi.mocked(mockConfig).mockReturnValue(tenantConfig as never);
    const fetchMock = vi.fn()
      .mockImplementation(() => Promise.resolve(emptyHuntingResponse()))
      .mockResolvedValueOnce(hunting([{ Count: 2 }]))
      .mockResolvedValueOnce(noIdentitiesCounted())
      .mockResolvedValueOnce(hunting([deviceRow('aa11'), deviceRow('bb22')])) // device query #1, take 500
      .mockResolvedValueOnce(tooLarge()) // findings query #1, take 500: refused for size
      .mockResolvedValueOnce(hunting([deviceRow('aa11'), deviceRow('bb22')])) // device query #2, take 250
      .mockResolvedValueOnce(hunting([findingRow('aa11', 'CVE-2026-1'), findingRow('bb22', 'CVE-2026-2')])); // findings query #2, take 250
    vi.stubGlobal('fetch', fetchMock);
    const { dbEngine } = await import('../../engines/db');
    (dbEngine as { db: { transaction?: unknown } }).db.transaction = vi.fn().mockResolvedValue({ dismissed: 0 });
    const ctx = makeCtx({ tenantId: 'tenant-abc' });

    await graphSyncHandler(ctx);

    expect(fetchMock).toHaveBeenCalledTimes(6 + IDENTITY_PASS_QUERIES);
    expect(fetchMock).toHaveBeenNthCalledWith(4, expect.any(String), expect.objectContaining({ body: expect.stringContaining('dynamic([\\"aa11\\",\\"bb22\\"])') }));
    expect(fetchMock).toHaveBeenNthCalledWith(5, expect.any(String), expect.objectContaining({ body: expect.stringContaining('| take 250') }));
    expect(ctx.saveStateSnapshot).toHaveBeenCalledWith(expect.objectContaining({ cursor: 'bb22', devicesProcessed: 2 }));
  });

  it('gives up when even a single device\'s result is refused for size', async () => {
    const { config: mockConfig } = await import('../../config');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock; partial config
    vi.mocked(mockConfig).mockReturnValue(tenantConfig as never);
    vi.stubGlobal('fetch', vi.fn()
      .mockImplementation(() => Promise.resolve(emptyHuntingResponse()))
      .mockResolvedValueOnce(hunting([{ Count: 1 }]))
      .mockResolvedValueOnce(noIdentitiesCounted())
      .mockResolvedValueOnce(hunting([deviceRow('aa11')]))
      .mockResolvedValueOnce(tooLarge()));
    const ctx = makeCtx({
      tenantId: 'tenant-abc',
      state: { pageIndex: 0, cursor: null, devicesProcessed: 0, findingsDismissed: 0, pageSize: 1, syncStartedAt: '2026-09-01T14:02:01Z' },
    });

    await expect(graphSyncHandler(ctx)).rejects.toThrow('response size limit');
  });
});

describe('graphSyncHandler: devices without a vulnerability', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('counts such a device as processed and not as a finding, since it never appears in the findings query', async () => {
    const { config: mockConfig } = await import('../../config');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock; partial config
    vi.mocked(mockConfig).mockReturnValue({
      connectors: { microsoft_graph: { 'tenant-abc': { azure_tenant_id: 'az', client_id: 'c', client_secret: 's' } } },
    } as never);
    const base = { FirstSeen: '2026-08-01T00:00:00Z', LastSeen: '2026-08-30T00:00:00Z', IsInternetFacing: 'true' };
    const fetchMock = vi.fn()
      .mockImplementation(() => Promise.resolve(emptyHuntingResponse()))
      .mockResolvedValueOnce(new Response(JSON.stringify({ schema: [], results: [{ Count: 2 }] }), { status: 200 }))
      .mockResolvedValueOnce(noIdentitiesCounted())
      .mockResolvedValueOnce(new Response(JSON.stringify({ schema: [], results: [
        { ...base, DeviceId: 'aa11' },
        // bb22 has no vulnerability: it is a device row, and simply carries no row in the findings query.
        { ...base, DeviceId: 'bb22' },
      ] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ schema: [], results: [
        { DeviceId: 'aa11', CveId: 'CVE-2026-0001' },
      ] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { dbEngine } = await import('../../engines/db');
    (dbEngine as { db: { transaction?: unknown } }).db.transaction = vi.fn().mockResolvedValue({ dismissed: 0 });
    const ctx = makeCtx({ tenantId: 'tenant-abc' });

    await graphSyncHandler(ctx);

    expect(ctx.updateProgress).toHaveBeenCalledWith({ message: 'Storing page 1: 0 of 2 devices, 1 findings, 0 dismissed', processedTotal: 0 });
    expect(ctx.updateProgress).toHaveBeenCalledWith(expect.objectContaining({ processedTotal: 2 }));
  });
});

/** `join` occurrences in the device query: the network info join, then the three left joins on the final stage. */
const BASELINE_JOIN_COUNT = 4;

describe('graphSyncHandler: the identity a device row carries to the matcher', () => {
  const base = { FirstSeen: '2026-08-01T00:00:00Z', LastSeen: '2026-08-30T00:00:00Z', IsInternetFacing: 'true' };
  const hunting = (results: Array<unknown>) => new Response(JSON.stringify({ schema: [], results }), { status: 200 });

  const syncOneDevice = async (deviceRow: Record<string, unknown>) => {
    const { config: mockConfig } = await import('../../config');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock; partial config
    vi.mocked(mockConfig).mockReturnValue({
      connectors: { microsoft_graph: { 'tenant-abc': { azure_tenant_id: 'az', client_id: 'c', client_secret: 's' } } },
    } as never);
    const fetchMock = vi.fn()
      .mockImplementation(() => Promise.resolve(emptyHuntingResponse()))
      .mockResolvedValueOnce(hunting([{ Count: 1 }]))
      .mockResolvedValueOnce(noIdentitiesCounted())
      .mockResolvedValueOnce(hunting([{ ...base, ...deviceRow }]))
      .mockResolvedValueOnce(hunting([]));
    vi.stubGlobal('fetch', fetchMock);
    const { dbEngine } = await import('../../engines/db');
    (dbEngine as { db: { transaction?: unknown } }).db.transaction =
      vi.fn().mockImplementation((callback: (tx: object) => Promise<unknown>) => callback({}));

    await graphSyncHandler(makeCtx({ tenantId: 'tenant-abc' }));
    return fetchMock;
  };

  // The device row's machine identity now travels under `properties`; everything else stays common.
  const MACHINE_PROPERTY_KEYS = new Set([
    'hostname', 'ipAddresses', 'macAddresses', 'hardwareUuid', 'directoryDeviceId',
    'cloudVmId', 'cloudResourceId', 'platform', 'vendor', 'model', 'operatingSystem', 'osVersion', 'agentExternalReference', 'agentExecutorType',
  ]);
  const expectAssetUpserted = (fields: Record<string, unknown>) => {
    const common: Record<string, unknown> = {};
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      (MACHINE_PROPERTY_KEYS.has(key) ? properties : common)[key] = value;
    }
    const expected = Object.keys(properties).length > 0 ? { ...common, properties: expect.objectContaining(properties) } : common;
    expect(mockBulkUpsertAssets).toHaveBeenCalledWith([expect.objectContaining(expected)]);
  };

  beforeEach(() => {
    mockBulkUpsertAssets.mockClear();
    mockBulkUpsertAssets.mockResolvedValue(new Map([['aa11', 'asset-a']]));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('carries every identifier the matcher resolves on, addresses included', async () => {
    await syncOneDevice({
      DeviceId: 'aa11',
      DeviceName: 'srv01.corp.local',
      HardwareUuid: 'uuid-a',
      AadDeviceId: 'aad-a',
      AzureVmId: 'vm-a',
      OSPlatform: 'Windows11',
      MacAddresses: ['aa:bb:cc:dd:ee:01', 'aa:bb:cc:dd:ee:02'],
      IpAddresses: ['10.0.0.5'],
    });

    expectAssetUpserted({
      sourceAssetId: 'aa11',
      hostname: 'srv01.corp.local',
      hardwareUuid: 'uuid-a',
      directoryDeviceId: 'aad-a',
      cloudVmId: 'vm-a',
      platform: 'Windows11',
      macAddresses: ['aa:bb:cc:dd:ee:01', 'aa:bb:cc:dd:ee:02'],
      ipAddresses: ['10.0.0.5'],
    });
  });

  it('rates a device from its Defender roles, naming the rule, and reads Normal as no reading', async () => {
    await syncOneDevice({
      DeviceId: 'aa11',
      AssetValue: 'Normal',
      DeviceRoles: '{"DomainController":{"Name":"DomainController","SystemDefinedConfidence":"Low","UserDefinedConfidence":"NotDefined"}}',
    });

    expectAssetUpserted({ criticality: 'very_high', criticalityRule: 'domain_controller' });
  });

  it('states nothing for a device left at Defender\'s default value with no role', async () => {
    await syncOneDevice({ DeviceId: 'aa11', AssetValue: 'Normal' });

    expectAssetUpserted({ criticality: 'unknown', criticalityRule: null });
  });

  it('lets a real cloud resource id win the cascade over an earlier one Advanced Hunting serialized as empty', async () => {
    await syncOneDevice({
      DeviceId: 'aa11',
      AzureResourceId: '',
      AwsResourceName: 'arn:aws:ec2:eu-west-1:1:instance/i-abc',
      GcpFullResourceName: '',
    });

    expectAssetUpserted({ cloudResourceId: 'arn:aws:ec2:eu-west-1:1:instance/i-abc' });
  });

  it('prefers the Azure resource id when the device reports one, the other clouds being absent', async () => {
    await syncOneDevice({
      DeviceId: 'aa11',
      AzureResourceId: '/subscriptions/s/resourceGroups/rg/providers/p/vm-a',
      AwsResourceName: '',
      GcpFullResourceName: '',
    });

    expectAssetUpserted({ cloudResourceId: '/subscriptions/s/resourceGroups/rg/providers/p/vm-a' });
  });

  it('reports no cloud resource id at all when every cloud field is empty, rather than an empty string every device would share', async () => {
    await syncOneDevice({
      DeviceId: 'aa11',
      AzureResourceId: '',
      AwsResourceName: '',
      GcpFullResourceName: '',
    });

    expectAssetUpserted({ cloudResourceId: null });
  });

  it.each(['', '   '])('stores a device name of %j as no name and no hostname, never as an empty string', async (DeviceName) => {
    await syncOneDevice({ DeviceId: 'aa11', DeviceName });

    expectAssetUpserted({ name: null, hostname: null });
  });

  it('carries the vendor and the model Defender reports under the machine properties', async () => {
    await syncOneDevice({ DeviceId: 'aa11', Vendor: 'Cisco', Model: 'Catalyst 9300' });

    expectAssetUpserted({ vendor: 'Cisco', model: 'Catalyst 9300' });
  });

  it('reports no vendor and no model when Defender sends them empty or not at all', async () => {
    await syncOneDevice({ DeviceId: 'aa11', Vendor: '', Model: '  ' });
    expectAssetUpserted({ vendor: null, model: null });

    mockBulkUpsertAssets.mockClear();
    await syncOneDevice({ DeviceId: 'aa11' });
    expectAssetUpserted({ vendor: null, model: null });
  });

  it('carries the operating system and its full version under the machine properties', async () => {
    await syncOneDevice({
      DeviceId: 'aa11',
      OSPlatform: 'Windows11',
      OSDistribution: 'Windows11',
      OSVersion: '10.0',
      OSVersionInfo: '25H2',
      OSBuild: 26200,
      OsBuildRevision: '9711',
    });

    expectAssetUpserted({ platform: 'Windows11', operatingSystem: 'Windows 11 25H2', osVersion: '10.0.26200.9711' });
  });

  it('keeps a device whose build columns arrive empty, with the version Defender gave alone', async () => {
    await syncOneDevice({ DeviceId: 'aa11', OSPlatform: 'macOS', OSDistribution: 'macOS', OSVersion: '26.6', OSBuild: {}, OsBuildRevision: '' });

    expectAssetUpserted({ operatingSystem: 'macOS', osVersion: '26.6' });
  });

  it('files a network device under the subcategory its DeviceSubtype names', async () => {
    await syncOneDevice({ DeviceId: 'aa11', DeviceCategory: 'Network', DeviceType: 'NetworkDevice', DeviceSubtype: 'Switch' });

    expectAssetUpserted({ categoryId: 'network_device', subcategoryId: 'switch' });
  });

  it('asks Defender for the subtype, vendor, model and OS columns in the final projection, without one more join', async () => {
    const fetchMock = await syncOneDevice({ DeviceId: 'aa11' });

    const query = String(fetchMock.mock.calls[2][1].body);
    const finalProject = query.slice(query.lastIndexOf('| project DeviceId, DeviceName'));
    expect(finalProject).toContain('DeviceSubtype, Vendor, Model');
    expect(finalProject).toContain('OSDistribution, OSVersion, OSVersionInfo, OSBuild, OsBuildRevision');
    expect(query.match(/join/g)).toHaveLength(BASELINE_JOIN_COUNT);
  });
});

describe('graphSyncHandler — findings Defender no longer reports', () => {
  const base = { FirstSeen: '2026-08-01T00:00:00Z', LastSeen: '2026-08-30T00:00:00Z', IsInternetFacing: 'true' };
  const hunting = (results: Array<unknown>) => new Response(JSON.stringify({ schema: [], results }), { status: 200 });
  const transaction = vi.fn().mockImplementation((callback: (tx: object) => Promise<unknown>) => callback({}));
  const storeThroughTransaction = async () => {
    const { dbEngine } = await import('../../engines/db');
    (dbEngine as { db: { transaction?: unknown } }).db.transaction = transaction;
  };

  beforeEach(async () => {
    const { config: mockConfig } = await import('../../config');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock; partial config
    vi.mocked(mockConfig).mockReturnValue({
      connectors: { microsoft_graph: { 'tenant-abc': { azure_tenant_id: 'az', client_id: 'c', client_secret: 's' } } },
    } as never);
    mockBulkUpsertAssets.mockResolvedValue(new Map([['aa11', 'asset-a'], ['bb22', 'asset-b']]));
    mockGetCveIdMap.mockResolvedValue(new Map([['CVE-2026-0001', 'cve-1']]));
    mockRecomputeState.mockResolvedValue(3);
    await storeThroughTransaction();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    mockMarkEnumerated.mockClear();
    mockRecomputeState.mockClear();
    transaction.mockClear();
  });

  it('marks, on the devices it stored, the enumeration the recompute reads, in a transaction after the storing one', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockImplementation(() => Promise.resolve(emptyHuntingResponse()))
      .mockResolvedValueOnce(hunting([{ Count: 2 }]))
      .mockResolvedValueOnce(noIdentitiesCounted())
      .mockResolvedValueOnce(hunting([{ ...base, DeviceId: 'aa11' }, { ...base, DeviceId: 'bb22' }]))
      .mockResolvedValueOnce(hunting([{ DeviceId: 'aa11', CveId: 'CVE-2026-0001' }])));
    const ctx = makeCtx({ tenantId: 'tenant-abc' });

    await graphSyncHandler(ctx);

    expect(mockMarkEnumerated).toHaveBeenCalledTimes(1);
    expect(mockMarkEnumerated).toHaveBeenCalledWith({
      connectorId: 'connector-id-abc',
      supportingAssetIds: ['asset-a', 'asset-b'],
      scope: '',
      enumeratedAt: expect.any(Date),
    });
    expect(mockRecomputeState).toHaveBeenCalledTimes(1);
    expect(mockRecomputeState).toHaveBeenCalledWith({
      supportingAssetIds: ['asset-a', 'asset-b'],
      reason: 'No longer reported by Microsoft Defender',
    });
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(transaction.mock.invocationCallOrder[1]).toBeGreaterThan(mockBulkUpsertEvidence.mock.invocationCallOrder.at(-1)!);
    expect(mockMarkEnumerated.mock.invocationCallOrder[0]).toBeGreaterThan(transaction.mock.invocationCallOrder[1]);
    expect(mockRecomputeState.mock.invocationCallOrder[0]).toBeGreaterThan(mockMarkEnumerated.mock.invocationCallOrder[0]);
  });

  it('leaves out a device carrying a finding row validation rejected, whose absent CVEs are a drop, not a fix', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockImplementation(() => Promise.resolve(emptyHuntingResponse()))
      .mockResolvedValueOnce(hunting([{ Count: 2 }]))
      .mockResolvedValueOnce(noIdentitiesCounted())
      .mockResolvedValueOnce(hunting([{ ...base, DeviceId: 'aa11' }, { ...base, DeviceId: 'bb22' }]))
      .mockResolvedValueOnce(hunting([
        { DeviceId: 'aa11', CveId: 'CVE-2026-0001' },
        { DeviceId: 'bb22', CveId: 'CVE-2026-0001' },
        { DeviceId: 'bb22', CveId: 42 },
      ])));

    await graphSyncHandler(makeCtx({ tenantId: 'tenant-abc' }));

    expect(mockMarkEnumerated).toHaveBeenCalledWith(expect.objectContaining({
      supportingAssetIds: ['asset-a'],
    }));
  });

  it('reports the dismissed count in the run steps and carries it across a retry', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockImplementation(() => Promise.resolve(emptyHuntingResponse()))
      .mockResolvedValueOnce(hunting([{ Count: 1 }]))
      .mockResolvedValueOnce(noIdentitiesCounted())
      .mockResolvedValueOnce(hunting([{ ...base, DeviceId: 'aa11' }]))
      .mockResolvedValueOnce(hunting([{ DeviceId: 'aa11', CveId: 'CVE-2026-0001' }])));
    const ctx = makeCtx({
      tenantId: 'tenant-abc',
      state: { pageIndex: 2, cursor: null, devicesProcessed: 10, findingsDismissed: 2, pageSize: 500, syncStartedAt: '2026-09-01T14:02:01Z' },
    });

    await graphSyncHandler(ctx);

    expect(ctx.updateProgress).toHaveBeenCalledWith({ message: 'Storing page 3: 0 of 1 devices, 1 findings, 0 dismissed', processedTotal: 10 });
    expect(ctx.saveStateSnapshot).toHaveBeenCalledWith(expect.objectContaining({ devicesProcessed: 11, findingsDismissed: 5 }));
    expect(ctx.updateProgress).toHaveBeenCalledWith({
      message: 'Recording the sync completion (5 findings dismissed as no longer reported, 0 primary users; Microsoft Entra ID answered, Intune answered)',
      processedTotal: 11,
    });
  });
});

describe('graphSyncHandler — a device Defender merges into another', () => {
  const base = { FirstSeen: '2026-08-01T00:00:00Z', LastSeen: '2026-08-30T00:00:00Z', IsInternetFacing: 'true' };
  const hunting = (results: Array<unknown>) => new Response(JSON.stringify({ schema: [], results }), { status: 200 });
  const transaction = vi.fn().mockImplementation((callback: (tx: object) => Promise<unknown>) => callback({}));

  beforeEach(async () => {
    const { config: mockConfig } = await import('../../config');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock; partial config
    vi.mocked(mockConfig).mockReturnValue({
      connectors: { microsoft_graph: { 'tenant-abc': { azure_tenant_id: 'az', client_id: 'c', client_secret: 's' } } },
    } as never);
    mockGetCveIdMap.mockResolvedValue(new Map([['CVE-2026-0001', 'cve-1']]));
    const { dbEngine } = await import('../../engines/db');
    (dbEngine as { db: { transaction?: unknown } }).db.transaction = transaction;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    mockMarkEnumerated.mockClear();
    mockRecomputeState.mockClear();
    transaction.mockClear();
  });

  it('keys the same CVE on the canonical asset, not the raw device id, so the two sides of a merge land on one provenance row', async () => {
    // Both the superseded id and its survivor resolve through bulkUpsertAssets onto the same
    // canonical asset: a real merge, already reconciled below the sourceFindingId built here.
    mockBulkUpsertAssets.mockResolvedValue(new Map([['aa11', 'asset-a'], ['bb22', 'asset-a']]));
    vi.stubGlobal('fetch', vi.fn()
      .mockImplementation(() => Promise.resolve(emptyHuntingResponse()))
      .mockResolvedValueOnce(hunting([{ Count: 2 }]))
      .mockResolvedValueOnce(noIdentitiesCounted())
      .mockResolvedValueOnce(hunting([
        { ...base, DeviceId: 'aa11', MergedToDeviceId: 'bb22' },
        { ...base, DeviceId: 'bb22' },
      ]))
      .mockResolvedValueOnce(hunting([
        { DeviceId: 'aa11', CveId: 'CVE-2026-0001' },
        { DeviceId: 'bb22', CveId: 'CVE-2026-0001' },
      ])));

    await graphSyncHandler(makeCtx({ tenantId: 'tenant-abc' }));

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock; partial config
    const evidenceRows = mockBulkUpsertEvidence.mock.calls[0][0] as Array<{ sourceFindingId: string }>;
    expect(evidenceRows).toHaveLength(2);
    expect(evidenceRows.map((row) => row.sourceFindingId)).toEqual(['asset-a:CVE-2026-0001', 'asset-a:CVE-2026-0001']);
  });

  it('carries each row\'s own Defender device id as the external reference, outside the canonical key', async () => {
    mockBulkUpsertAssets.mockResolvedValue(new Map([['aa11', 'asset-a'], ['bb22', 'asset-a']]));
    vi.stubGlobal('fetch', vi.fn()
      .mockImplementation(() => Promise.resolve(emptyHuntingResponse()))
      .mockResolvedValueOnce(hunting([{ Count: 2 }]))
      .mockResolvedValueOnce(noIdentitiesCounted())
      .mockResolvedValueOnce(hunting([
        { ...base, DeviceId: 'aa11', MergedToDeviceId: 'bb22' },
        { ...base, DeviceId: 'bb22' },
      ]))
      .mockResolvedValueOnce(hunting([
        { DeviceId: 'aa11', CveId: 'CVE-2026-0001' },
        { DeviceId: 'bb22', CveId: 'CVE-2026-0001' },
      ])));

    await graphSyncHandler(makeCtx({ tenantId: 'tenant-abc' }));

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock; partial config
    const evidenceRows = mockBulkUpsertEvidence.mock.calls[0][0] as Array<{ externalReference: string | null }>;
    expect(evidenceRows.map((row) => row.externalReference)).toEqual(['aa11', 'bb22']);
  });

  it('leaves the survivor\'s asset unreconciled when the merged device is stored without it, its empty list being no fix', async () => {
    // bulkUpsertAssets keys a merged row under the survivor's id too, survivor absent or not.
    mockBulkUpsertAssets.mockResolvedValue(new Map([['bb22', 'asset-a'], ['aa11', 'asset-a'], ['cc33', 'asset-c']]));
    vi.stubGlobal('fetch', vi.fn()
      .mockImplementation(() => Promise.resolve(emptyHuntingResponse()))
      .mockResolvedValueOnce(hunting([{ Count: 2 }]))
      .mockResolvedValueOnce(noIdentitiesCounted())
      .mockResolvedValueOnce(hunting([
        { ...base, DeviceId: 'aa11', MergedToDeviceId: 'bb22' },
        { ...base, DeviceId: 'cc33' },
      ]))
      .mockResolvedValueOnce(hunting([{ DeviceId: 'cc33', CveId: 'CVE-2026-0001' }])));

    await graphSyncHandler(makeCtx({ tenantId: 'tenant-abc' }));

    expect(mockMarkEnumerated).toHaveBeenCalledWith(expect.objectContaining({ supportingAssetIds: ['asset-c'] }));
    expect(mockRecomputeState).toHaveBeenCalledWith(expect.objectContaining({ supportingAssetIds: ['asset-c'] }));
  });

  it('reconciles the asset once through the survivor\'s own row when both sides of the merge are stored together', async () => {
    mockBulkUpsertAssets.mockResolvedValue(new Map([['aa11', 'asset-a'], ['bb22', 'asset-a']]));
    vi.stubGlobal('fetch', vi.fn()
      .mockImplementation(() => Promise.resolve(emptyHuntingResponse()))
      .mockResolvedValueOnce(hunting([{ Count: 2 }]))
      .mockResolvedValueOnce(noIdentitiesCounted())
      .mockResolvedValueOnce(hunting([
        { ...base, DeviceId: 'aa11', MergedToDeviceId: 'bb22' },
        { ...base, DeviceId: 'bb22' },
      ]))
      .mockResolvedValueOnce(hunting([{ DeviceId: 'bb22', CveId: 'CVE-2026-0001' }])));

    await graphSyncHandler(makeCtx({ tenantId: 'tenant-abc' }));

    expect(mockMarkEnumerated).toHaveBeenCalledWith(expect.objectContaining({ supportingAssetIds: ['asset-a'] }));
  });

  it('still reconciles a device whose merge target is itself', async () => {
    mockBulkUpsertAssets.mockResolvedValue(new Map([['aa11', 'asset-a']]));
    vi.stubGlobal('fetch', vi.fn()
      .mockImplementation(() => Promise.resolve(emptyHuntingResponse()))
      .mockResolvedValueOnce(hunting([{ Count: 1 }]))
      .mockResolvedValueOnce(noIdentitiesCounted())
      .mockResolvedValueOnce(hunting([{ ...base, DeviceId: 'aa11', MergedToDeviceId: 'aa11' }]))
      .mockResolvedValueOnce(hunting([])));

    await graphSyncHandler(makeCtx({ tenantId: 'tenant-abc' }));

    expect(mockMarkEnumerated).toHaveBeenCalledWith(expect.objectContaining({ supportingAssetIds: ['asset-a'] }));
  });
});

describe('graphSyncHandler: the CVSS score a CVE shell carries', () => {
  const base = { FirstSeen: '2026-08-01T00:00:00Z', LastSeen: '2026-08-30T00:00:00Z', IsInternetFacing: 'true' };
  const hunting = (results: Array<unknown>) => new Response(JSON.stringify({ schema: [], results }), { status: 200 });

  const syncOneFinding = async (findingRow: Record<string, unknown>) => {
    const { config: mockConfig } = await import('../../config');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock; partial config
    vi.mocked(mockConfig).mockReturnValue({
      connectors: { microsoft_graph: { 'tenant-abc': { azure_tenant_id: 'az', client_id: 'c', client_secret: 's' } } },
    } as never);
    vi.stubGlobal('fetch', vi.fn()
      .mockImplementation(() => Promise.resolve(emptyHuntingResponse()))
      .mockResolvedValueOnce(hunting([{ Count: 1 }]))
      .mockResolvedValueOnce(noIdentitiesCounted())
      .mockResolvedValueOnce(hunting([{ ...base, DeviceId: 'aa11' }]))
      .mockResolvedValueOnce(hunting([{ DeviceId: 'aa11', CveId: 'CVE-2026-96187', ...findingRow }])));
    const { dbEngine } = await import('../../engines/db');
    (dbEngine as { db: { transaction?: unknown } }).db.transaction =
      vi.fn().mockImplementation((callback: (tx: object) => Promise<unknown>) => callback({}));

    await graphSyncHandler(makeCtx({ tenantId: 'tenant-abc' }));
  };

  beforeEach(() => {
    mockUpsertDefenderReports.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('stores a CvssScore of 0 as not scored', async () => {
    await syncOneFinding({ CvssScore: 0, VulnerabilitySeverityLevel: '' });

    expect(mockUpsertDefenderReports).toHaveBeenCalledWith([{ cveId: 'CVE-2026-96187', cvss: null, isExploitAvailable: null }]);
  });

  it('stores a real CvssScore as it comes', async () => {
    await syncOneFinding({ CvssScore: 7.5, VulnerabilitySeverityLevel: 'High' });

    expect(mockUpsertDefenderReports).toHaveBeenCalledWith([{ cveId: 'CVE-2026-96187', cvss: 7.5, isExploitAvailable: null }]);
  });
});

describe('graphSyncHandler: the software a finding names', () => {
  const base = { FirstSeen: '2026-08-01T00:00:00Z', LastSeen: '2026-08-30T00:00:00Z', IsInternetFacing: 'true' };
  const hunting = (results: Array<unknown>) => new Response(JSON.stringify({ schema: [], results }), { status: 200 });
  const openssl = (version: string) => ({ DeviceId: 'aa11', CveId: 'CVE-2026-35189', SoftwareVendor: 'openssl', SoftwareName: 'openssl', SoftwareVersion: version });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    mockBulkUpsertEvidence.mockClear();
  });

  it('files one finding per device and CVE, carrying every version Defender names for it', async () => {
    const { config: mockConfig } = await import('../../config');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock; partial config
    vi.mocked(mockConfig).mockReturnValue({
      connectors: { microsoft_graph: { 'tenant-abc': { azure_tenant_id: 'az', client_id: 'c', client_secret: 's' } } },
    } as never);
    mockBulkUpsertAssets.mockResolvedValueOnce(new Map([['aa11', 'asset-a']]));
    mockGetCveIdMap.mockResolvedValueOnce(new Map([['CVE-2026-35189', 'cve-1']]));
    const fetchMock = vi.fn()
      .mockImplementation(() => Promise.resolve(emptyHuntingResponse()))
      .mockResolvedValueOnce(hunting([{ Count: 1 }]))
      .mockResolvedValueOnce(noIdentitiesCounted())
      .mockResolvedValueOnce(hunting([{ ...base, DeviceId: 'aa11' }]))
      .mockResolvedValueOnce(hunting([openssl('3.0.15.0'), openssl('4.0.2.0')]));
    vi.stubGlobal('fetch', fetchMock);
    const { dbEngine } = await import('../../engines/db');
    (dbEngine as { db: { transaction?: unknown } }).db.transaction =
      vi.fn().mockImplementation((callback: (tx: object) => Promise<unknown>) => callback({}));

    await graphSyncHandler(makeCtx({ tenantId: 'tenant-abc' }));

    expect(String(fetchMock.mock.calls[3][1].body)).toContain('SoftwareVendor, SoftwareName, SoftwareVersion');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock; the handler's own rows
    const evidenceRows = mockBulkUpsertEvidence.mock.calls[0][0] as Array<{ software: unknown }>;
    expect(evidenceRows.map((row) => row.software)).toEqual([[
      { vendor: 'openssl', name: 'openssl', version: '3.0.15.0' },
      { vendor: 'openssl', name: 'openssl', version: '4.0.2.0' },
    ]]);
  });
});

describe('graphSyncHandler: primary users', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reconciles the relations the sources named, retiring what an answering source no longer names', async () => {
    const { config: mockConfig } = await import('../../config');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock; partial config
    vi.mocked(mockConfig).mockReturnValue({
      connectors: { microsoft_graph: { 'tenant-abc': { azure_tenant_id: 'az-abc', client_id: 'client-abc', client_secret: 'secret-abc' } } },
    } as never);
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(emptyHuntingResponse())));
    mockReadEntraDevices.mockResolvedValueOnce({ status: 'answered', items: [{ deviceId: 'aad-1', registeredOwners: [{ id: 'obj-1' }] }] });
    mockReadIntuneDevices.mockResolvedValueOnce({ status: 'refused', httpStatus: 403 });
    mockGetRelationEndpoints.mockResolvedValueOnce({
      devices: [
        { supportingAssetId: 'device-asset', directoryDeviceId: 'aad-1', macAddresses: [], lastSeenAt: new Date('2026-10-01T08:00:00Z') },
        { supportingAssetId: 'other-device-asset', directoryDeviceId: 'aad-2', macAddresses: [], lastSeenAt: new Date('2026-10-01T08:00:00Z') },
      ],
      identities: [{ supportingAssetId: 'identity-asset', sourceAssetId: 'obj-1' }],
    });
    mockListRelations.mockResolvedValueOnce([
      { id: 'held-entra', fromAssetId: 'identity-asset', toAssetId: 'other-device-asset', source: 'entra_registered_owner' },
      { id: 'held-intune', fromAssetId: 'identity-asset', toAssetId: 'other-device-asset', source: 'intune_primary_user' },
    ]);
    mockReconcileRelations.mockResolvedValueOnce({ written: 1, removed: 1 });
    const ctx = makeCtx({ tenantId: 'tenant-abc' });

    await graphSyncHandler(ctx);

    expect(mockListRelations).toHaveBeenCalledWith({ connectorId: 'connector-id-abc', kind: 'primary_user_of' });
    expect(mockReconcileRelations).toHaveBeenCalledWith({
      connectorId: 'connector-id-abc',
      kind: 'primary_user_of',
      observedAt: expect.any(Date),
      relations: [{ fromAssetId: 'identity-asset', toAssetId: 'device-asset', source: 'entra_registered_owner' }],
      retiredIds: ['held-entra'],
    });
    expect(vi.mocked(ctx.updateProgress).mock.calls.at(-1)?.[0].message)
      .toBe('Recording the sync completion (0 findings dismissed as no longer reported, 1 primary user; Microsoft Entra ID answered, Intune refused (403))');
  });

  it('completes the sync when neither source answers', async () => {
    const { config: mockConfig } = await import('../../config');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock; partial config
    vi.mocked(mockConfig).mockReturnValue({
      connectors: { microsoft_graph: { 'tenant-abc': { azure_tenant_id: 'az-abc', client_id: 'client-abc', client_secret: 'secret-abc' } } },
    } as never);
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(emptyHuntingResponse())));
    mockMarkSynced.mockClear();
    mockLogTraceFromError.mockClear();
    const timeout = new DOMException('The operation timed out.', 'TimeoutError');
    mockReadEntraDevices.mockResolvedValueOnce({ status: 'unavailable', reason: 'timed out', error: timeout });
    mockReadIntuneDevices.mockResolvedValueOnce({ status: 'unavailable', reason: '400' });
    mockListRelations.mockResolvedValueOnce([{ id: 'held-intune', fromAssetId: 'identity-asset', toAssetId: 'device-asset', source: 'intune_primary_user' }]);
    const ctx = makeCtx({ tenantId: 'tenant-abc' });

    await graphSyncHandler(ctx);

    expect(mockReconcileRelations).toHaveBeenLastCalledWith(expect.objectContaining({ relations: [], retiredIds: [] }));
    expect(mockMarkSynced).toHaveBeenCalled();
    expect(mockLogTraceFromError).toHaveBeenCalledExactlyOnceWith(timeout, 'Primary users: Microsoft Entra ID unavailable (timed out)');
    expect(vi.mocked(ctx.updateProgress).mock.calls.at(-1)?.[0].message)
      .toBe('Recording the sync completion (0 findings dismissed as no longer reported, 0 primary users; Microsoft Entra ID unavailable (timed out), Intune unavailable (400))');
  });
});

describe('graphSyncHandler: disabled accounts with no identifying data', () => {
  const IDENTITY_PAGE_SIZE = 2000;
  const hunting = (results: Array<unknown>) => new Response(JSON.stringify({ schema: [], results }), { status: 200 });
  const enabledAccount = (key: string) => ({ IdentityKey: key, AccountObjectId: key, AccountDisplayName: `Account ${key}`, IsAccountEnabled: true });
  const bareDisabledAccount = (key: string) => ({ IdentityKey: key, AccountObjectId: key, IsAccountEnabled: false });
  const skippedLine = (skipped: number, removed: number) => `${skipped} disabled accounts with no identifying data skipped, ${removed} assets removed`;

  const runIdentitySync = async (identityPage: (requestBody: string) => Array<Record<string, unknown>>, recordCount: number) => {
    const { config: mockConfig } = await import('../../config');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock; partial config
    vi.mocked(mockConfig).mockReturnValue({
      connectors: { microsoft_graph: { 'tenant-abc': { azure_tenant_id: 'az', client_id: 'c', client_secret: 's' } } },
    } as never);
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: string, init: { body: string }) => {
      if (init.body.includes('| project IdentityKey')) {
        return Promise.resolve(hunting(identityPage(init.body)));
      }
      if (init.body.includes('| count')) {
        return Promise.resolve(hunting([{ Count: init.body.includes('IdentityInfo') ? recordCount : 0 }]));
      }
      return Promise.resolve(emptyHuntingResponse());
    }));
    const { dbEngine } = await import('../../engines/db');
    (dbEngine as { db: { transaction?: unknown } }).db.transaction =
      vi.fn().mockImplementation((callback: (tx: object) => Promise<unknown>) => callback({}));

    const ctx = makeCtx({ tenantId: 'tenant-abc' });
    await graphSyncHandler(ctx);
    return ctx;
  };

  const syncIdentityPages = (pages: Array<Array<Record<string, unknown>>>) => {
    let page = 0;
    return runIdentitySync(() => pages[page++] ?? [], pages.flat().length);
  };

  /** Serves `records`, sorted by key, the way Advanced Hunting pages them after the query's cursor. */
  const syncDirectory = (records: Array<Record<string, unknown>>) => runIdentitySync((requestBody) => {
    // The query reaches fetch JSON-encoded, its quotes escaped.
    const after = /strcmp\(IdentityKey, \\"([^"\\]*)\\"\) > 0/.exec(requestBody)?.[1];
    return records.filter((record) => after === undefined || String(record.IdentityKey) > after).slice(0, IDENTITY_PAGE_SIZE);
  }, records.length);

  const progressUpdates = (ctx: Awaited<ReturnType<typeof runIdentitySync>>) =>
    vi.mocked(ctx.updateProgress).mock.calls.map(([update]) => update);

  it('ends the progress at its expected total when accounts are skipped', async () => {
    const ctx = await syncIdentityPages([[enabledAccount('obj-1'), bareDisabledAccount('obj-bare')]]);

    const progress = progressUpdates(ctx);
    expect(progress).toContainEqual(expect.objectContaining({ expectedTotal: 2 }));
    expect(progress.at(-1)).toEqual(expect.objectContaining({ processedTotal: 2 }));
  });

  it('counts once a rejected record that ends a full page', async () => {
    const accountKey = (index: number) => `obj-${String(index).padStart(5, '0')}`;
    const directory = [
      ...Array.from({ length: IDENTITY_PAGE_SIZE - 1 }, (_, index) => enabledAccount(accountKey(index))),
      { ...enabledAccount(accountKey(IDENTITY_PAGE_SIZE - 1)), IsAccountEnabled: 'yes' },
      enabledAccount(accountKey(IDENTITY_PAGE_SIZE)),
    ];

    const ctx = await syncDirectory(directory);

    expect(progressUpdates(ctx).at(-1)).toEqual(expect.objectContaining({ processedTotal: IDENTITY_PAGE_SIZE + 1 }));
  });

  beforeEach(() => {
    mockRetireConnectorSources.mockClear();
    mockRetireSuperseded.mockClear();
    mockLogTrace.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('retires the sources of the accounts the page drops, and only theirs', async () => {
    await syncIdentityPages([[enabledAccount('obj-1'), bareDisabledAccount('obj-bare'), { ...bareDisabledAccount('obj-known'), AccountDisplayName: 'Nadia Fournier' }]]);

    expect(mockRetireConnectorSources).toHaveBeenCalledExactlyOnceWith({ connectorId: 'connector-id-abc', sourceAssetIds: ['obj-bare'] });
    expect(mockRetireSuperseded).toHaveBeenCalledOnce();
  });

  it('does not store the dropped account', async () => {
    mockBulkUpsertAssets.mockClear();

    await syncIdentityPages([[enabledAccount('obj-1'), bareDisabledAccount('obj-bare')]]);

    const stored = mockBulkUpsertAssets.mock.calls.flatMap(([rows]) => rows.map((row: { sourceAssetId: string }) => row.sourceAssetId));
    expect(stored).toEqual(['obj-1']);
  });

  it('asks for no retirement on a page that drops nothing', async () => {
    await syncIdentityPages([[enabledAccount('obj-1')]]);

    expect(mockRetireConnectorSources).not.toHaveBeenCalled();
  });

  it('writes the totals of the whole pass in one line of the run log', async () => {
    mockRetireConnectorSources
      .mockResolvedValueOnce({ sources: 2, assets: 1 })
      .mockResolvedValueOnce({ sources: 1, assets: 1 });
    const firstPage = [
      bareDisabledAccount('obj-bare-1'),
      bareDisabledAccount('obj-bare-2'),
      ...Array.from({ length: IDENTITY_PAGE_SIZE - 2 }, (_, index) => enabledAccount(`obj-ok-${String(index).padStart(5, '0')}`)),
    ];

    await syncIdentityPages([firstPage, [bareDisabledAccount('obj-bare-3')]]);

    expect(mockRetireConnectorSources).toHaveBeenCalledTimes(2);
    const lines = mockLogTrace.mock.calls.map(([message]) => String(message)).filter((message) => message.includes('disabled accounts'));
    expect(lines).toEqual([skippedLine(3, 2)]);
  });

  it('writes the line with zero counts when nothing was dropped', async () => {
    await syncIdentityPages([[enabledAccount('obj-1')]]);

    expect(mockLogTrace).toHaveBeenCalledWith(skippedLine(0, 0));
  });
});
