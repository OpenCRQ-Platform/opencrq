import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobContext, ProgressUpdate } from '@app/module';
import type * as AppModule from '@app/module';
import type * as DescriptionPhase from './openaev-description-phase';
import type { DescriptionPhaseDeps } from './openaev-description-phase';
import type { LegacySyncDeps } from './legacy/openaev-legacy-sync';
import type { ObservationPhaseDeps, ObservationPhaseResult } from './openaev-observation-phase';
import type { OpenaevSyncPayload, OpenaevSyncState } from './openaev-types';
import type * as OpenaevApiClient from './openaev-api-client';
import { NonRetryableError as RefusedError } from '@app/module';
import type * as Utils from '../../utils';

const HOUR_MS = 60 * 60 * 1000;

const { mockSyncAssetGroups } = vi.hoisted(() => ({ mockSyncAssetGroups: vi.fn().mockResolvedValue({ groups: 0, membersAdded: 0, membersRemoved: 0, groupsDeleted: 0 }) }));

const {
  mockBulkUpsertAssets,
  mockUpsertTagVocabulary,
  mockSetAssetTags,
  mockGetInventoryAssetIdMap,
  mockGetReportedOverviewFields,
  mockFindCveScopePairsSince,
  mockFindEvidenceScopePairsForConnector,
  mockGetConnectorId,
  mockGetIntegrationSettings,
  mockMarkSynced,
  mockUpsertOpenaevAssets,
  mockDeleteObservationsNotReportedSince,
  mockListObservationPairs,
  mockListObservationPairsReportedSince,
  mockCompleteFullWalk,
  mockMarkStreamReconciled,
  mockListSourceAssetIds,
  mockGetAssetTenantMap,
  mockGetStreamStates,
  mockListUnreportedAssets,
  mockPruneAssets,
  mockWithOrigin,
  mockCreateOpenaevClient,
  mockSyncObservationStreams,
  mockSyncDescriptions,
  mockRetireAttackEvidence,
  mockRetireCveEvidence,
  mockCreateOpenaevLegacyClient,
  mockProbeSnapshotExport,
  mockRunLegacySync,
  mockLogWarn,
  makeSvc,
} = vi.hoisted(() => {
  const bulkUpsertAssets = vi.fn().mockResolvedValue(new Map([['asset-openaev-1', 'sa-uuid-1']]));
  const upsertTagVocabulary = vi.fn().mockResolvedValue(new Map());
  const setAssetTags = vi.fn().mockResolvedValue(undefined);
  const getInventoryAssetIdMap = vi.fn().mockResolvedValue(new Map());
  const getReportedOverviewFields = vi.fn().mockResolvedValue(new Map());
  const findCveScopePairsSince = vi.fn().mockResolvedValue([]);
  const findEvidenceScopePairsForConnector = vi.fn().mockResolvedValue([]);
  const getConnectorId = vi.fn().mockResolvedValue('connector-id-abc');
  const getIntegrationSettings = vi.fn().mockResolvedValue({ lastReportedAt: null });
  const markSynced = vi.fn().mockResolvedValue(undefined);
  const upsertOpenaevAssets = vi.fn().mockResolvedValue(undefined);
  const deleteObservationsNotReportedSince = vi.fn().mockResolvedValue([]);
  const listObservationPairs = vi.fn().mockResolvedValue([]);
  const listObservationPairsReportedSince = vi.fn().mockResolvedValue([]);
  const completeFullWalk = vi.fn().mockResolvedValue(undefined);
  const markStreamReconciled = vi.fn().mockResolvedValue(undefined);
  const listSourceAssetIds = vi.fn().mockResolvedValue([]);
  const getAssetTenantMap = vi.fn().mockResolvedValue(new Map());
  const getStreamStates = vi.fn().mockResolvedValue([]);
  const listUnreportedAssets = vi.fn().mockResolvedValue([]);
  const pruneAssets = vi.fn().mockResolvedValue(undefined);
  const createOpenaevClient = vi.fn();
  const syncObservationStreams = vi.fn();
  const syncDescriptions = vi.fn();
  const retireAttackEvidence = vi.fn().mockResolvedValue(undefined);
  const retireCveEvidence = vi.fn().mockResolvedValue(undefined);
  const createOpenaevLegacyClient = vi.fn();
  const probeSnapshotExport = vi.fn();
  const runLegacySync = vi.fn();
  const logWarn = vi.fn();

  const svcFactory = () => ({
    integrationSettings: {
      getConnectorId,
      getIntegrationSettings,
      markSynced,
    },
    supportingAssets: {
      bulkUpsertAssets,
      upsertTagVocabulary,
      setAssetTags,
      getInventoryAssetIdMap,
      getReportedOverviewFields,
      findCveScopePairsSince,
      findEvidenceScopePairsForConnector,
    },
    openaevConnector: {
      upsertAssets: upsertOpenaevAssets,
      deleteObservationsNotReportedSince,
      listObservationPairs,
      listObservationPairsReportedSince,
      completeFullWalk,
      markStreamReconciled,
      listSourceAssetIds,
      getAssetTenantMap,
      getStreamStates,
      listUnreportedAssets,
      pruneAssets,
    },
  });

  const withOrigin = vi.fn().mockImplementation(() => svcFactory());

  return {
    mockBulkUpsertAssets: bulkUpsertAssets,
    mockUpsertTagVocabulary: upsertTagVocabulary,
    mockSetAssetTags: setAssetTags,
    mockGetInventoryAssetIdMap: getInventoryAssetIdMap,
    mockGetReportedOverviewFields: getReportedOverviewFields,
    mockFindCveScopePairsSince: findCveScopePairsSince,
    mockFindEvidenceScopePairsForConnector: findEvidenceScopePairsForConnector,
    mockGetConnectorId: getConnectorId,
    mockGetIntegrationSettings: getIntegrationSettings,
    mockMarkSynced: markSynced,
    mockUpsertOpenaevAssets: upsertOpenaevAssets,
    mockDeleteObservationsNotReportedSince: deleteObservationsNotReportedSince,
    mockListObservationPairs: listObservationPairs,
    mockListObservationPairsReportedSince: listObservationPairsReportedSince,
    mockCompleteFullWalk: completeFullWalk,
    mockMarkStreamReconciled: markStreamReconciled,
    mockListSourceAssetIds: listSourceAssetIds,
    mockGetAssetTenantMap: getAssetTenantMap,
    mockGetStreamStates: getStreamStates,
    mockListUnreportedAssets: listUnreportedAssets,
    mockPruneAssets: pruneAssets,
    mockWithOrigin: withOrigin,
    mockCreateOpenaevClient: createOpenaevClient,
    mockSyncObservationStreams: syncObservationStreams,
    mockSyncDescriptions: syncDescriptions,
    mockRetireAttackEvidence: retireAttackEvidence,
    mockRetireCveEvidence: retireCveEvidence,
    mockCreateOpenaevLegacyClient: createOpenaevLegacyClient,
    mockProbeSnapshotExport: probeSnapshotExport,
    mockRunLegacySync: runLegacySync,
    mockLogWarn: logWarn,
    makeSvc: svcFactory,
  };
});

const mockUpdateProgress = vi.fn().mockResolvedValue(undefined);
const mockSaveStateSnapshot = vi.fn().mockResolvedValue(undefined);

vi.mock('../../utils/logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    logFromError: vi.fn(),
    logTrace: vi.fn(),
    logWarn: mockLogWarn,
    logError: vi.fn(),
    logTraceFromError: vi.fn(),
    logFatalError: vi.fn(),
    logFromFatalError: vi.fn(),
    enrich: vi.fn(),
  }),
}));

// The mapping utils the handler now calls during the inventory pass (`assetToConnectorInput` and
// friends) read real constants off `@app/module` (`ASSET_CATEGORY_VALUES`, etc.) — spread the real
// module rather than replacing it outright, and override only what the handler itself needs mocked.
vi.mock('@app/module', async (importOriginal) => {
  const actual = await importOriginal<typeof AppModule>();
  return {
    ...actual,
    allServiceDefinitions: [],
    createServices: vi.fn().mockReturnValue({ withOrigin: mockWithOrigin }),
    NonRetryableError: class NonRetryableError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'NonRetryableError';
      }
    },
  };
});

vi.mock('../../engines/db', () => ({ dbEngine: { db: {} } }));

vi.mock('../../utils', async (importOriginal) => ({
  ...(await importOriginal<typeof Utils>()),
  sleep: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../config', () => ({
  config: vi.fn().mockReturnValue({
    connectors: { openaev: { 'tenant-abc': { url: 'https://openaev.example.com', token: 'test-token' } } },
  }),
}));

// The phase and the retirement have their own tests: here they are the seams the handler wires.
vi.mock('./openaev-observation-phase', () => ({ syncObservationStreams: mockSyncObservationStreams }));
vi.mock('./openaev-group-phase', () => ({ syncAssetGroups: mockSyncAssetGroups }));
vi.mock('./openaev-description-phase', async (importOriginal) => ({
  ...(await importOriginal<typeof DescriptionPhase>()),
  syncDescriptions: mockSyncDescriptions,
}));
vi.mock('./openaev-retirement', () => ({
  retireAttackEvidence: mockRetireAttackEvidence,
  retireCveEvidence: mockRetireCveEvidence,
}));
vi.mock('./legacy/openaev-legacy-client', () => ({ createOpenaevLegacyClient: mockCreateOpenaevLegacyClient }));
vi.mock('./legacy/openaev-legacy-sync', () => ({ runLegacySync: mockRunLegacySync }));

const {
  mockListTenants,
  mockSearchAssets,
  mockFindListedAssetIds,
  mockFindEndpoints,
  mockSearchAiTargets,
  mockGetAssetOverview,
  mockFindUsers,
  mockListTags,
  mockFetchPostureCounters,
  mockPaginateAll,
} = vi.hoisted(() => {
  const listTenants = vi.fn().mockResolvedValue([{ tenant_id: 'oa-tenant-1', tenant_name: 'Tenant A' }]);
  // One machine-family asset by default, so the inventory pass's three phases (assets, machine
  // identities, AI targets) all have something to do without every test having to set it up.
  const searchAssets = vi.fn().mockResolvedValue({
    content: [{ asset_id: 'asset-openaev-1', asset_type: 'endpoint', asset_name: 'srv-01', asset_category: 'host' }],
    last: true,
    totalElements: 1,
    number: 0,
    size: 100,
  });
  const findListedAssetIds = vi.fn().mockResolvedValue(new Set());
  const findEndpoints = vi.fn().mockResolvedValue([]);
  const searchAiTargets = vi.fn().mockResolvedValue({ content: [], last: true, totalElements: 0, number: 0, size: 100 });
  const getAssetOverview = vi.fn().mockImplementation((_tenantId: string, assetId: string) => Promise.resolve({ asset_id: assetId }));
  const findUsers = vi.fn().mockResolvedValue([]);
  const listTags = vi.fn().mockResolvedValue([]);
  const fetchPostureCounters = vi.fn().mockResolvedValue(new Map());

  const paginateAll = vi.fn().mockImplementation(
    async <T>(fetchPage: (page: number) => Promise<{ content: Array<T>, last: boolean, totalElements: number }>) => {
      const result = await fetchPage(0);
      return { items: result.content, totalElements: result.totalElements };
    },
  );

  return {
    mockListTenants: listTenants,
    mockSearchAssets: searchAssets,
    mockFindListedAssetIds: findListedAssetIds,
    mockFindEndpoints: findEndpoints,
    mockSearchAiTargets: searchAiTargets,
    mockGetAssetOverview: getAssetOverview,
    mockFindUsers: findUsers,
    mockListTags: listTags,
    mockFetchPostureCounters: fetchPostureCounters,
    mockPaginateAll: paginateAll,
  };
});

vi.mock('./openaev-api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof OpenaevApiClient>();
  mockCreateOpenaevClient.mockReturnValue({
    listTenants: mockListTenants,
    searchAssets: mockSearchAssets,
    findListedAssetIds: mockFindListedAssetIds,
    findEndpoints: mockFindEndpoints,
    searchAiTargets: mockSearchAiTargets,
    getAssetOverview: mockGetAssetOverview,
    findUsers: mockFindUsers,
    listTags: mockListTags,
    fetchPostureCounters: mockFetchPostureCounters,
  });
  return {
    OpenaevNotFoundError: actual.OpenaevNotFoundError,
    paginateAll: mockPaginateAll,
    createOpenaevClient: mockCreateOpenaevClient,
  };
});

const { openaevSyncHandler } = await import('./openaev-sync-handler');

const makeCtx = (
  overrides: Partial<JobContext<OpenaevSyncPayload, OpenaevSyncState>> = {},
): JobContext<OpenaevSyncPayload, OpenaevSyncState> => ({
  jobId: 'job-1',
  tenantId: 'tenant-abc',
  kind: 'openaev-findings-sync',
  interactive: true,
  payload: { serviceAccountId: 'service-account-1' },
  attempt: 1,
  state: null,
  signal: new AbortController().signal,
  updateProgress: mockUpdateProgress,
  saveStateSnapshot: mockSaveStateSnapshot,
  ...overrides,
});

const reconcileFrom = new Date('2026-10-06T08:00:00.000Z');

const noFullWalk: ObservationPhaseResult = {
  attack: { fullWalk: null, walked: false, reconcileFrom },
  vulnerability: { fullWalk: null, walked: false, reconcileFrom },
};

/** What the phase mock answers unless a test says otherwise: nothing read. */
const quietPhase = (_deps: ObservationPhaseDeps): Promise<ObservationPhaseResult> =>
  Promise.resolve(noFullWalk);

/** A resumed-job state that already carries a complete inventory, so tests focused on the observation phase don't also exercise it. */
const inventoryDoneState = (): OpenaevSyncState => ({ inventoryComplete: true });

/** The inventory is due when the connector never completed one, or when the last one is older than a day. */
const inventorySyncedHoursAgo = (hours: number | null) =>
  mockGetIntegrationSettings.mockResolvedValue({ lastReportedAt: hours === null ? null : new Date(Date.now() - hours * HOUR_MS) });

describe('openaevSyncHandler', () => {
  beforeEach(() => {
    mockWithOrigin.mockImplementation(() => makeSvc());
    mockListTenants.mockResolvedValue([{ tenant_id: 'oa-tenant-1', tenant_name: 'Tenant A' }]);
    mockSearchAssets.mockResolvedValue({
      content: [{ asset_id: 'asset-openaev-1', asset_type: 'endpoint', asset_name: 'srv-01', asset_category: 'host' }],
      last: true,
      totalElements: 1,
      number: 0,
      size: 100,
    });
    mockFindEndpoints.mockResolvedValue([]);
    mockFindListedAssetIds.mockResolvedValue(new Set());
    mockSearchAiTargets.mockResolvedValue({ content: [], last: true, totalElements: 0, number: 0, size: 100 });
    mockGetAssetOverview.mockImplementation((_tenantId: string, assetId: string) => Promise.resolve({ asset_id: assetId }));
    mockFindUsers.mockResolvedValue([]);
    mockListTags.mockResolvedValue([]);
    mockFetchPostureCounters.mockResolvedValue(new Map());
    mockGetConnectorId.mockResolvedValue('connector-id-abc');
    inventorySyncedHoursAgo(null);
    mockBulkUpsertAssets.mockResolvedValue(new Map([['asset-openaev-1', 'sa-uuid-1']]));
    mockFindCveScopePairsSince.mockResolvedValue([]);
    mockFindEvidenceScopePairsForConnector.mockResolvedValue([]);
    mockUpsertTagVocabulary.mockResolvedValue(new Map());
    mockSetAssetTags.mockResolvedValue(undefined);
    mockGetInventoryAssetIdMap.mockResolvedValue(new Map([['asset-openaev-1', 'sa-uuid-1']]));
    mockMarkSynced.mockResolvedValue(undefined);
    mockUpsertOpenaevAssets.mockResolvedValue(undefined);
    mockDeleteObservationsNotReportedSince.mockResolvedValue([]);
    mockListObservationPairs.mockResolvedValue([{ sourceAssetId: 'asset-openaev-1', scenarioId: 'scenario-1' }]);
    mockListObservationPairsReportedSince.mockResolvedValue([{ sourceAssetId: 'asset-openaev-1', scenarioId: 'scenario-1' }]);
    mockCompleteFullWalk.mockResolvedValue(undefined);
    mockMarkStreamReconciled.mockResolvedValue(undefined);
    mockListSourceAssetIds.mockResolvedValue([]);
    mockGetAssetTenantMap.mockResolvedValue(new Map([['asset-openaev-1', 'oa-tenant-1']]));
    mockGetStreamStates.mockResolvedValue([]);
    mockListUnreportedAssets.mockResolvedValue([]);
    mockPruneAssets.mockResolvedValue(undefined);
    mockSyncObservationStreams.mockImplementation(quietPhase);
    mockSyncDescriptions.mockResolvedValue({ calls: 0 });
    mockCreateOpenaevLegacyClient.mockReturnValue({ probeSnapshotExport: mockProbeSnapshotExport });
    mockProbeSnapshotExport.mockResolvedValue('available');
    mockRunLegacySync.mockResolvedValue(undefined);
    mockGetReportedOverviewFields.mockResolvedValue(new Map());
    mockRetireAttackEvidence.mockResolvedValue(undefined);
    mockRetireCveEvidence.mockResolvedValue(undefined);
    mockPaginateAll.mockImplementation(
      async <T>(fetchPage: (page: number) => Promise<{ content: Array<T>, last: boolean, totalElements: number }>) => {
        const result = await fetchPage(0);
        return { items: result.content, totalElements: result.totalElements };
      },
    );
  });

  it('returns immediately if already aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await openaevSyncHandler(makeCtx({ signal: ctrl.signal }));
    expect(mockListTenants).not.toHaveBeenCalled();
  });

  it('throws NonRetryableError if openaev config is missing', async () => {
    const { config: mockConfig } = await import('../../config');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock; partial object forces the missing-config branch
    vi.mocked(mockConfig).mockReturnValueOnce({ connectors: undefined } as never);
    await expect(openaevSyncHandler(makeCtx())).rejects.toThrow('openaev connector config is missing');
  });

  it('connects to only the requesting tenant\'s OpenAEV instance, never another tenant\'s', async () => {
    const { config: mockConfig } = await import('../../config');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock; partial config
    vi.mocked(mockConfig).mockReturnValueOnce({
      connectors: {
        openaev: {
          'tenant-abc': { url: 'https://abc.openaev.example.com', token: 'token-abc' },
          'tenant-other': { url: 'https://other.openaev.example.com', token: 'token-other' },
        },
      },
    } as never);

    await openaevSyncHandler(makeCtx({ tenantId: 'tenant-abc' }));

    expect(mockCreateOpenaevClient).toHaveBeenCalledWith('https://abc.openaev.example.com', 'token-abc', expect.anything());
  });

  it('throws NonRetryableError when the requesting tenant has no OpenAEV entry, even if other tenants do', async () => {
    const { config: mockConfig } = await import('../../config');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock; partial config
    vi.mocked(mockConfig).mockReturnValueOnce({
      connectors: { openaev: { 'tenant-other': { url: 'https://other.openaev.example.com', token: 'token-other' } } },
    } as never);

    await expect(openaevSyncHandler(makeCtx({ tenantId: 'tenant-abc' }))).rejects.toThrow('openaev connector config is missing');
    expect(mockCreateOpenaevClient).not.toHaveBeenCalled();
  });

  it('throws NonRetryableError if integration_settings row is missing', async () => {
    mockGetConnectorId.mockResolvedValueOnce(null);
    await expect(openaevSyncHandler(makeCtx())).rejects.toThrow('integration_settings row for openaev not found');
  });

  it('calls listTenants and runs the inventory and the observation phase for every tenant', async () => {
    mockListTenants.mockResolvedValueOnce([
      { tenant_id: 'oa-tenant-1', tenant_name: 'Tenant A' },
      { tenant_id: 'oa-tenant-2', tenant_name: 'Tenant B' },
    ]);

    await openaevSyncHandler(makeCtx());

    expect(mockSearchAssets).toHaveBeenCalledWith('oa-tenant-1', expect.any(Number));
    expect(mockSearchAssets).toHaveBeenCalledWith('oa-tenant-2', expect.any(Number));
    expect(mockSyncObservationStreams.mock.calls.map(([deps]) => deps.openaevTenantId)).toEqual(['oa-tenant-1', 'oa-tenant-2']);
  });

  describe('snapshot export probe', () => {
    const runLegacyDeps = (): LegacySyncDeps => mockRunLegacySync.mock.calls[0][0];

    it('asks the first OpenAEV tenant, with the connector\'s own url, token and signal, before anything else is read', async () => {
      mockListTenants.mockResolvedValueOnce([
        { tenant_id: 'oa-tenant-1', tenant_name: 'Tenant A' },
        { tenant_id: 'oa-tenant-2', tenant_name: 'Tenant B' },
      ]);
      const readBeforeProbe: Array<string> = [];
      mockProbeSnapshotExport.mockImplementation(() => {
        readBeforeProbe.push(...[mockListTags, mockSearchAssets, mockSyncObservationStreams].filter((mock) => mock.mock.calls.length > 0).map(() => 'something read'));
        return Promise.resolve('available');
      });

      await openaevSyncHandler(makeCtx());

      expect(mockCreateOpenaevLegacyClient).toHaveBeenCalledWith('https://openaev.example.com', 'test-token', expect.any(AbortSignal));
      expect(mockProbeSnapshotExport).toHaveBeenCalledExactlyOnceWith('oa-tenant-1');
      expect(readBeforeProbe).toEqual([]);
    });

    it('runs the snapshot path, and the legacy one not at all, when the snapshot routes answer', async () => {
      mockProbeSnapshotExport.mockResolvedValueOnce('available');

      await openaevSyncHandler(makeCtx());

      expect(mockRunLegacySync).not.toHaveBeenCalled();
      expect(mockSyncObservationStreams).toHaveBeenCalledOnce();
      expect(mockLogWarn).not.toHaveBeenCalledWith(expect.stringContaining('BULK_SNAPSHOT_EXPORT'), expect.anything());
    });

    describe('when the snapshot routes answer 404', () => {
      beforeEach(() => {
        mockProbeSnapshotExport.mockResolvedValue('unavailable');
      });

      it('hands the run to the legacy path, for every OpenAEV tenant', async () => {
        const tenants = [
          { tenant_id: 'oa-tenant-1', tenant_name: 'Tenant A' },
          { tenant_id: 'oa-tenant-2', tenant_name: 'Tenant B' },
        ];
        mockListTenants.mockResolvedValueOnce(tenants);
        const ctx = makeCtx();

        await openaevSyncHandler(ctx);

        expect(mockRunLegacySync).toHaveBeenCalledOnce();
        expect(runLegacyDeps()).toMatchObject({
          ctx,
          connectorId: 'connector-id-abc',
          openaevTenants: tenants,
          client: { probeSnapshotExport: mockProbeSnapshotExport },
        });
        expect(mockProbeSnapshotExport).toHaveBeenCalledOnce();
      });

      it('reads no snapshot stream, and runs neither the inventory nor the descriptions by itself', async () => {
        await openaevSyncHandler(makeCtx());

        expect(mockSyncObservationStreams).not.toHaveBeenCalled();
        expect(mockRetireAttackEvidence).not.toHaveBeenCalled();
        expect(mockRetireCveEvidence).not.toHaveBeenCalled();
        expect(mockListTags).not.toHaveBeenCalled();
        expect(mockSearchAssets).not.toHaveBeenCalled();
        expect(mockSyncDescriptions).not.toHaveBeenCalled();
        expect(mockMarkSynced).not.toHaveBeenCalled();
        expect(mockSaveStateSnapshot).not.toHaveBeenCalled();
      });

      it('warns that BULK_SNAPSHOT_EXPORT is off, naming the instance it asked', async () => {
        await openaevSyncHandler(makeCtx());

        expect(mockLogWarn).toHaveBeenCalledWith(expect.stringContaining('BULK_SNAPSHOT_EXPORT'), expect.objectContaining({ openaevTenantId: 'oa-tenant-1' }));
      });

      it('lends the legacy run the inventory of the snapshot path, one OpenAEV tenant at a time', async () => {
        await openaevSyncHandler(makeCtx());

        const assetIdMap = await runLegacyDeps().buildTenantInventory('oa-tenant-9');

        expect(mockListTags).toHaveBeenCalledWith('oa-tenant-9');
        expect(mockSearchAssets).toHaveBeenCalledWith('oa-tenant-9', 0);
        expect(assetIdMap).toEqual(new Map([['asset-openaev-1', 'sa-uuid-1']]));
        expect(mockUpsertOpenaevAssets).toHaveBeenCalledWith(expect.objectContaining({ connectorId: 'connector-id-abc' }));
        expect(mockMarkSynced).not.toHaveBeenCalled();
      });

      it('lends the legacy run the description phase of the snapshot path, with the budget it is given', async () => {
        mockSyncDescriptions.mockResolvedValueOnce({ calls: 7 });
        await openaevSyncHandler(makeCtx());

        const result = await runLegacyDeps().syncTenantDescriptions('oa-tenant-9', 123);

        expect(result).toEqual({ calls: 7 });
        expect(mockSyncDescriptions).toHaveBeenCalledOnce();
        const deps: DescriptionPhaseDeps = mockSyncDescriptions.mock.calls[0][0];
        expect(deps).toMatchObject({ connectorId: 'connector-id-abc', openaevTenantId: 'oa-tenant-9', budget: 123, concurrency: 8 });
      });

      it('lets the failure of the legacy run fail the job', async () => {
        mockRunLegacySync.mockRejectedValueOnce(new Error('legacy down'));

        await expect(openaevSyncHandler(makeCtx())).rejects.toThrow('legacy down');
      });
    });

    it('fails the run, non-retryable and with nothing written, when the account may not read the snapshot routes', async () => {
      mockProbeSnapshotExport.mockRejectedValueOnce(new RefusedError('OpenAEV refused the snapshot request: the account lacks the ACCESS_SNAPSHOT_OBSERVATION capability (403): '));

      const failure = await openaevSyncHandler(makeCtx()).catch((err: unknown) => err);

      expect(failure).toBeInstanceOf(RefusedError);
      expect(failure).toHaveProperty('message', expect.stringContaining('ACCESS_SNAPSHOT_OBSERVATION'));
      expect(mockRunLegacySync).not.toHaveBeenCalled();
      expect(mockListTags).not.toHaveBeenCalled();
      expect(mockSearchAssets).not.toHaveBeenCalled();
      expect(mockSyncObservationStreams).not.toHaveBeenCalled();
      expect(mockMarkSynced).not.toHaveBeenCalled();
      expect(mockSaveStateSnapshot).not.toHaveBeenCalled();
    });

    it('lets a transient failure of the probe fail the run, to be retried, rather than picking a path', async () => {
      mockProbeSnapshotExport.mockRejectedValueOnce(new Error('OpenAEV error (503): unavailable'));

      await expect(openaevSyncHandler(makeCtx())).rejects.toThrow('OpenAEV error (503)');

      expect(mockRunLegacySync).not.toHaveBeenCalled();
      expect(mockSyncObservationStreams).not.toHaveBeenCalled();
    });

    it('does not probe an OpenAEV with no tenant, which has nothing to read on either path', async () => {
      mockListTenants.mockResolvedValueOnce([]);

      await openaevSyncHandler(makeCtx());

      expect(mockProbeSnapshotExport).not.toHaveBeenCalled();
      expect(mockRunLegacySync).not.toHaveBeenCalled();
      expect(mockSyncObservationStreams).not.toHaveBeenCalled();
    });
  });

  describe('inventory cadence', () => {
    it('runs the inventory when the connector never completed one, and does not rebuild the asset map the phase reads', async () => {
      inventorySyncedHoursAgo(null);
      let mapsRebuiltBeforePhase: number | null = null;
      mockSyncObservationStreams.mockImplementationOnce((deps: ObservationPhaseDeps) => {
        mapsRebuiltBeforePhase = mockGetInventoryAssetIdMap.mock.calls.length;
        return quietPhase(deps);
      });

      await openaevSyncHandler(makeCtx());

      expect(mockSearchAssets).toHaveBeenCalledOnce();
      expect(mapsRebuiltBeforePhase).toBe(0);
    });

    it('runs the inventory when the last one is 25 hours old', async () => {
      inventorySyncedHoursAgo(25);

      await openaevSyncHandler(makeCtx());

      expect(mockSearchAssets).toHaveBeenCalledOnce();
      expect(mockMarkSynced).toHaveBeenCalledOnce();
    });

    it('skips the inventory when the last one is 2 hours old, and rebuilds the asset map from what is on file', async () => {
      inventorySyncedHoursAgo(2);

      await openaevSyncHandler(makeCtx());

      expect(mockListTags).not.toHaveBeenCalled();
      expect(mockSearchAssets).not.toHaveBeenCalled();
      expect(mockFetchPostureCounters).not.toHaveBeenCalled();
      expect(mockGetInventoryAssetIdMap).toHaveBeenCalledWith('connector-id-abc');
      expect(mockSyncObservationStreams).toHaveBeenCalledOnce();
      expect(mockSyncObservationStreams.mock.calls[0][0].assetIdMap).toEqual(new Map([['asset-openaev-1', 'sa-uuid-1']]));
    });

    it('leaves the completion instant alone when no inventory ran', async () => {
      inventorySyncedHoursAgo(2);

      await openaevSyncHandler(makeCtx());

      expect(mockMarkSynced).not.toHaveBeenCalled();
    });

    it('records the completed inventory once, after every tenant\'s, and before the observation phase reads anything', async () => {
      const callOrder: Array<string> = [];
      mockListTenants.mockResolvedValueOnce([
        { tenant_id: 'oa-tenant-1', tenant_name: 'Tenant A' },
        { tenant_id: 'oa-tenant-2', tenant_name: 'Tenant B' },
      ]);
      mockSearchAssets.mockImplementation((openaevTenantId: string) => {
        callOrder.push(`inventory:${openaevTenantId}`);
        return Promise.resolve({ content: [], last: true, totalElements: 0, number: 0, size: 100 });
      });
      mockMarkSynced.mockImplementation(() => {
        callOrder.push('markSynced');
        return Promise.resolve();
      });
      mockSyncObservationStreams.mockImplementation((deps: ObservationPhaseDeps) => {
        callOrder.push(`phase:${deps.openaevTenantId}`);
        return quietPhase(deps);
      });

      await openaevSyncHandler(makeCtx());

      expect(callOrder).toEqual(['inventory:oa-tenant-1', 'inventory:oa-tenant-2', 'markSynced', 'phase:oa-tenant-1', 'phase:oa-tenant-2']);
      expect(mockMarkSynced).toHaveBeenCalledOnce();
      expect(mockMarkSynced).toHaveBeenCalledWith('openaev', expect.any(Date));
    });

    it('does not record an inventory the run was aborted in the middle of', async () => {
      const ctrl = new AbortController();
      mockListTenants.mockResolvedValueOnce([
        { tenant_id: 'oa-tenant-1', tenant_name: 'Tenant A' },
        { tenant_id: 'oa-tenant-2', tenant_name: 'Tenant B' },
      ]);
      mockListTags.mockImplementationOnce(() => {
        ctrl.abort();
        return Promise.resolve([]);
      });

      await openaevSyncHandler(makeCtx({ signal: ctrl.signal }));

      expect(mockMarkSynced).not.toHaveBeenCalled();
      expect(mockSyncObservationStreams).not.toHaveBeenCalled();
    });

    it('checkpoints the completed inventory before the observation phase starts, so a crash between the two does not repeat it', async () => {
      await openaevSyncHandler(makeCtx());

      expect(mockSaveStateSnapshot).toHaveBeenCalledOnce();
      expect(mockSaveStateSnapshot).toHaveBeenCalledWith({ inventoryComplete: true });
      expect(mockSaveStateSnapshot.mock.invocationCallOrder[0]).toBeLessThan(mockSyncObservationStreams.mock.invocationCallOrder[0]);
    });

    it('writes no checkpoint when no inventory ran', async () => {
      inventorySyncedHoursAgo(2);

      await openaevSyncHandler(makeCtx());

      expect(mockSaveStateSnapshot).not.toHaveBeenCalled();
    });

    it('resumes from a checkpointed inventory without running it again, and rebuilds the asset map', async () => {
      inventorySyncedHoursAgo(null);

      await openaevSyncHandler(makeCtx({ state: inventoryDoneState() }));

      expect(mockListTags).not.toHaveBeenCalled();
      expect(mockSearchAssets).not.toHaveBeenCalled();
      expect(mockFindEndpoints).not.toHaveBeenCalled();
      expect(mockSearchAiTargets).not.toHaveBeenCalled();
      expect(mockGetInventoryAssetIdMap).toHaveBeenCalledWith('connector-id-abc');
      expect(mockSyncObservationStreams).toHaveBeenCalledOnce();
      expect(mockSyncObservationStreams.mock.calls[0][0].assetIdMap).toEqual(new Map([['asset-openaev-1', 'sa-uuid-1']]));
      expect(mockMarkSynced).not.toHaveBeenCalled();
    });
  });

  describe('inventory pass', () => {
    it('syncs assets, then machine identities, then AI targets, all before the observation phase reads anything', async () => {
      const callOrder: Array<string> = [];
      mockSearchAssets.mockImplementationOnce(() => {
        callOrder.push('searchAssets');
        return Promise.resolve({ content: [{ asset_id: 'asset-openaev-1', asset_type: 'endpoint', asset_name: 'srv-01', asset_category: 'host' }], last: true, totalElements: 1, number: 0, size: 100 });
      });
      mockFindEndpoints.mockImplementationOnce(() => {
        callOrder.push('findEndpoints');
        return Promise.resolve([]);
      });
      mockSearchAiTargets.mockImplementationOnce(() => {
        callOrder.push('searchAiTargets');
        return Promise.resolve({ content: [], last: true, totalElements: 0, number: 0, size: 100 });
      });
      mockSyncObservationStreams.mockImplementationOnce((deps: ObservationPhaseDeps) => {
        callOrder.push('syncObservationStreams');
        return quietPhase(deps);
      });

      await openaevSyncHandler(makeCtx());

      expect(callOrder).toEqual(['searchAssets', 'findEndpoints', 'searchAiTargets', 'syncObservationStreams']);
    });

    it('upserts the general inventory attributes for every asset', async () => {
      await openaevSyncHandler(makeCtx());
      const firstCallAssets = mockBulkUpsertAssets.mock.calls[0][0];
      expect(firstCallAssets).toEqual([
        expect.objectContaining({ sourceAssetId: 'asset-openaev-1', categoryId: 'host', connectorId: 'connector-id-abc' }),
      ]);
    });

    it('enriches a machine-family asset with hostname/IPs/MACs and its description from /endpoints/find', async () => {
      mockFindEndpoints.mockResolvedValueOnce([{
        asset_id: 'asset-openaev-1',
        asset_description: '  A domain controller  ',
        asset_hostname: 'srv-01.internal',
        asset_ips: ['10.0.0.5'],
        asset_mac_addresses: ['aa:bb:cc:dd:ee:ff'],
      }]);

      await openaevSyncHandler(makeCtx());

      expect(mockFindEndpoints).toHaveBeenCalledWith('oa-tenant-1', ['asset-openaev-1']);
      expect(mockBulkUpsertAssets.mock.calls[0][0]).toEqual([
        expect.objectContaining({
          sourceAssetId: 'asset-openaev-1',
          description: 'A domain controller',
          properties: expect.objectContaining({ family: 'machine', hostname: 'srv-01.internal', ipAddresses: ['10.0.0.5'] }),
        }),
      ]);
    });

    it('looks the machine identities up 100 ids per call, several calls in flight at once', async () => {
      const ids = Array.from({ length: 250 }, (_, i) => `asset-${i}`);
      mockSearchAssets.mockResolvedValueOnce({
        content: ids.map((id) => ({ asset_id: id, asset_type: 'endpoint', asset_name: id, asset_category: 'host' })),
        last: true,
        totalElements: ids.length,
        number: 0,
        size: 250,
      });
      let inFlight = 0;
      let maxInFlight = 0;
      mockFindEndpoints.mockImplementation(async (_tenantId: string, batchIds: Array<string>) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 0));
        inFlight -= 1;
        return batchIds.map((id) => ({ asset_id: id, asset_hostname: `${id}.internal` }));
      });

      await openaevSyncHandler(makeCtx());

      expect(mockFindEndpoints.mock.calls.map(([, batchIds]) => batchIds.length)).toEqual([100, 100, 50]);
      expect(maxInFlight).toBe(3);
      const upserted = mockBulkUpsertAssets.mock.calls.flatMap(([assets]) => assets);
      expect(upserted).toHaveLength(250);
      expect(upserted.every((asset: { properties: { hostname?: string } }) => asset.properties.hostname !== undefined)).toBe(true);
    });

    it('writes an asset once, identity included, never a thin row the matcher cannot resolve', async () => {
      mockFindEndpoints.mockResolvedValueOnce([{ asset_id: 'asset-openaev-1', asset_hostname: 'srv-01.internal' }]);

      await openaevSyncHandler(makeCtx());

      // `bulkUpsertAssets` keeps the canonical id a `(connectorId, sourceAssetId)` pair already
      // holds and never runs the matcher on it again, so an asset upserted before its detail call
      // could never consolidate with the Defender device behind it.
      expect(mockBulkUpsertAssets).toHaveBeenCalledTimes(1);
      expect(mockBulkUpsertAssets.mock.calls[0][0]).toEqual([
        expect.objectContaining({ properties: expect.objectContaining({ hostname: 'srv-01.internal' }) }),
      ]);
    });

    it('never calls findEndpoints for an asset that is not an endpoint row', async () => {
      mockSearchAssets.mockResolvedValueOnce({
        content: [{ asset_id: 'asset-app-1', asset_type: 'asset', asset_name: 'my-app', asset_category: 'saas_application' }],
        last: true,
        totalElements: 1,
        number: 0,
        size: 100,
      });

      await openaevSyncHandler(makeCtx());

      expect(mockFindEndpoints).not.toHaveBeenCalled();
    });

    // `/endpoints/find` is backed by the endpoint repository, so a machine-family category stored
    // as a generic asset comes back from it empty — forever, on every run, in silence.
    it('routes a machine-family category stored as a generic asset away from /endpoints/find, and carries the description, url and linked person already stored', async () => {
      mockSearchAssets.mockResolvedValueOnce({
        content: [{ asset_id: 'asset-cloud-1', asset_type: 'asset', asset_name: 'prod-bucket', asset_category: 'cloud_resource' }],
        last: true,
        totalElements: 1,
        number: 0,
        size: 100,
      });
      mockGetReportedOverviewFields.mockResolvedValueOnce(new Map([['asset-cloud-1', { description: 'The production bucket', url: 'https://bucket.test', linkedPerson: 'Ada Lovelace' }]]));

      await openaevSyncHandler(makeCtx());

      expect(mockFindEndpoints).not.toHaveBeenCalled();
      expect(mockGetReportedOverviewFields).toHaveBeenCalledExactlyOnceWith('connector-id-abc', ['asset-cloud-1']);
      expect(mockBulkUpsertAssets.mock.calls[0][0]).toEqual([
        expect.objectContaining({ sourceAssetId: 'asset-cloud-1', description: 'The production bucket', url: 'https://bucket.test', linkedPerson: 'Ada Lovelace' }),
      ]);
    });

    it('never calls GET /assets/{id} while building the inventory', async () => {
      mockSearchAssets.mockResolvedValueOnce({
        content: [
          { asset_id: 'asset-cloud-1', asset_type: 'asset', asset_name: 'prod-bucket', asset_category: 'cloud_resource' },
          { asset_id: 'asset-app-1', asset_type: 'asset', asset_name: 'payroll', asset_category: 'saas_application' },
        ],
        last: true,
        totalElements: 2,
        number: 0,
        size: 100,
      });

      await openaevSyncHandler(makeCtx());

      expect(mockGetAssetOverview).not.toHaveBeenCalled();
    });

    it('upserts a generic asset with nothing stored yet with no description, url or linked person, rather than guessed ones', async () => {
      mockSearchAssets.mockResolvedValueOnce({
        content: [{ asset_id: 'asset-app-1', asset_type: 'asset', asset_name: 'payroll', asset_category: 'saas_application' }],
        last: true,
        totalElements: 1,
        number: 0,
        size: 100,
      });

      await openaevSyncHandler(makeCtx());

      expect(mockBulkUpsertAssets.mock.calls[0][0]).toEqual([
        expect.objectContaining({ sourceAssetId: 'asset-app-1', description: null, url: null, linkedPerson: null }),
      ]);
    });

    it('reads the stored overview fields of the generic assets only, and only when there is one', async () => {
      await openaevSyncHandler(makeCtx());

      expect(mockGetReportedOverviewFields).not.toHaveBeenCalled();
    });

    it('keeps the description a batch route served over any stored one, and asks the store for generic assets alone', async () => {
      mockSearchAssets.mockResolvedValueOnce({
        content: [
          { asset_id: 'asset-endpoint-1', asset_type: 'endpoint', asset_name: 'srv-01', asset_category: 'host' },
          { asset_id: 'asset-app-1', asset_type: 'asset', asset_name: 'payroll', asset_category: 'saas_application' },
        ],
        last: true,
        totalElements: 2,
        number: 0,
        size: 100,
      });
      mockFindEndpoints.mockResolvedValueOnce([{ asset_id: 'asset-endpoint-1', asset_description: 'The domain controller', asset_hostname: 'srv-01.internal' }]);
      mockGetReportedOverviewFields.mockResolvedValueOnce(new Map([['asset-app-1', { description: 'The payroll application', url: null, linkedPerson: null }]]));

      await openaevSyncHandler(makeCtx());

      expect(mockGetReportedOverviewFields).toHaveBeenCalledExactlyOnceWith('connector-id-abc', ['asset-app-1']);
      expect(mockBulkUpsertAssets.mock.calls[0][0]).toEqual([
        expect.objectContaining({ sourceAssetId: 'asset-endpoint-1', description: 'The domain controller' }),
        expect.objectContaining({ sourceAssetId: 'asset-app-1', description: 'The payroll application' }),
      ]);
    });

    it('never sends a stored linked person, already a name, to the user lookup', async () => {
      mockSearchAssets.mockResolvedValueOnce({
        content: [{ asset_id: 'asset-app-1', asset_type: 'asset', asset_name: 'payroll', asset_category: 'saas_application' }],
        last: true,
        totalElements: 1,
        number: 0,
        size: 100,
      });
      mockGetReportedOverviewFields.mockResolvedValueOnce(new Map([['asset-app-1', { description: null, url: null, linkedPerson: 'Ada Lovelace' }]]));

      await openaevSyncHandler(makeCtx());

      expect(mockFindUsers).not.toHaveBeenCalled();
      expect(mockBulkUpsertAssets.mock.calls[0][0]).toEqual([expect.objectContaining({ linkedPerson: 'Ada Lovelace' })]);
    });

    it('stores an asset\'s linked person as a name, never the OpenAEV user id it arrives as', async () => {
      mockFindEndpoints.mockResolvedValueOnce([{
        asset_id: 'asset-openaev-1',
        asset_hostname: 'srv-01.internal',
        asset_linked_person: 'user-uuid-1',
      }]);
      mockFindUsers.mockResolvedValueOnce([{ user_id: 'user-uuid-1', user_email: 'ada@acme.test', user_firstname: 'Ada', user_lastname: 'Lovelace' }]);

      await openaevSyncHandler(makeCtx());

      expect(mockFindUsers).toHaveBeenCalledWith('oa-tenant-1', ['user-uuid-1']);
      expect(mockBulkUpsertAssets.mock.calls[0][0]).toEqual([
        expect.objectContaining({ linkedPerson: 'Ada Lovelace' }),
      ]);
    });

    it('leaves the linked person empty rather than showing an id the directory could not resolve', async () => {
      mockFindEndpoints.mockResolvedValueOnce([{
        asset_id: 'asset-openaev-1',
        asset_hostname: 'srv-01.internal',
        asset_linked_person: 'user-uuid-gone',
      }]);
      mockFindUsers.mockResolvedValueOnce([]);

      await openaevSyncHandler(makeCtx());

      expect(mockBulkUpsertAssets.mock.calls[0][0]).toEqual([
        expect.objectContaining({ linkedPerson: null }),
      ]);
    });

    it('carries the cloud block off /endpoints/find, which already serves it', async () => {
      mockFindEndpoints.mockResolvedValueOnce([{
        asset_id: 'asset-openaev-1',
        asset_hostname: 'srv-01.internal',
        asset_url: 'https://srv-01.acme.test',
        asset_cloud_provider: 'AZURE',
        asset_cloud_native_type: 'azure_virtual_machine',
        asset_cloud_region: 'westeurope',
      }]);

      await openaevSyncHandler(makeCtx());

      expect(mockBulkUpsertAssets.mock.calls[0][0]).toEqual([
        expect.objectContaining({
          url: 'https://srv-01.acme.test',
          properties: expect.objectContaining({ cloudProvider: 'azure', cloudNativeType: 'azure_virtual_machine', cloudRegion: 'westeurope' }),
        }),
      ]);
    });

    it('enriches an AI target with its provider/model and description from /ai_targets/search', async () => {
      mockSearchAssets.mockResolvedValueOnce({
        content: [{ asset_id: 'asset-ai-1', asset_type: 'ai_target', asset_name: 'gpt-agent', asset_category: 'ai_target' }],
        last: true,
        totalElements: 1,
        number: 0,
        size: 100,
      });
      mockSearchAiTargets.mockResolvedValueOnce({
        content: [{
          asset_id: 'asset-ai-1',
          asset_description: 'An internal chatbot',
          ai_target_provider: 'ANTHROPIC',
          ai_target_endpoint: 'https://api.anthropic.com/v1',
          ai_target_model: 'claude',
        }],
        last: true,
        totalElements: 1,
        number: 0,
        size: 100,
      });

      await openaevSyncHandler(makeCtx());

      expect(mockBulkUpsertAssets.mock.calls[0][0]).toEqual([
        expect.objectContaining({
          sourceAssetId: 'asset-ai-1',
          description: 'An internal chatbot',
          properties: expect.objectContaining({ family: 'ai_target', provider: 'anthropic', model: 'claude' }),
        }),
      ]);
    });

    it('skips enriching a detail row the inventory pass never saw, rather than upserting it with a guessed category', async () => {
      mockFindEndpoints.mockResolvedValueOnce([{ asset_id: 'asset-unknown-to-inventory', asset_hostname: 'ghost' }]);

      await openaevSyncHandler(makeCtx());

      expect(mockBulkUpsertAssets.mock.calls[0][0].map((asset: { sourceAssetId: string }) => asset.sourceAssetId)).toEqual(['asset-openaev-1']);
    });

    it('upserts the tag vocabulary before the assets, then links each asset\'s resolved tags', async () => {
      mockListTags.mockResolvedValueOnce([{ tag_id: 'oa-tag-1', tag_name: 'Critical', tag_color: '#ff0000' }]);
      mockUpsertTagVocabulary.mockResolvedValueOnce(new Map([['oa-tag-1', 'tag-uuid-1']]));
      mockSearchAssets.mockResolvedValueOnce({
        content: [{ asset_id: 'asset-openaev-1', asset_name: 'srv-01', asset_category: 'host', asset_tags: ['oa-tag-1'] }],
        last: true,
        totalElements: 1,
        number: 0,
        size: 100,
      });

      await openaevSyncHandler(makeCtx());

      expect(mockUpsertTagVocabulary).toHaveBeenCalledWith('connector-id-abc', [
        { sourceTagId: 'oa-tag-1', name: 'Critical', color: '#ff0000' },
      ]);
      expect(mockSetAssetTags).toHaveBeenCalledWith('connector-id-abc', [
        { supportingAssetId: 'sa-uuid-1', tagIds: ['tag-uuid-1'] },
      ]);
    });

    // The tag links are keyed on the connector, and one connector spans every OpenAEV tenant of an
    // instance: `setAssetTags` replacing this connector's links means the second sub-tenant's pass
    // would drop the first's tags off an asset the matcher fused across the two, unless the run
    // accumulates them. Moving that accumulator back inside the per-tenant pass must fail here.
    it('unions the tags two OpenAEV sub-tenants report on one consolidated asset, rather than letting the second pass drop the first\'s', async () => {
      mockListTenants.mockResolvedValueOnce([
        { tenant_id: 'oa-tenant-1', tenant_name: 'Tenant A' },
        { tenant_id: 'oa-tenant-2', tenant_name: 'Tenant B' },
      ]);
      mockListTags.mockImplementation((openaevTenantId: string) => Promise.resolve(
        openaevTenantId === 'oa-tenant-1'
          ? [{ tag_id: 'oa-tag-1', tag_name: 'Critical', tag_color: '#ff0000' }]
          : [{ tag_id: 'oa-tag-2', tag_name: 'Production', tag_color: '#00ff00' }],
      ));
      mockUpsertTagVocabulary.mockImplementation((_connectorId: string, tags: Array<{ sourceTagId: string }>) => Promise.resolve(
        new Map(tags.map((tag) => [tag.sourceTagId, tag.sourceTagId === 'oa-tag-1' ? 'tag-uuid-1' : 'tag-uuid-2'])),
      ));
      mockSearchAssets.mockImplementation((openaevTenantId: string) => Promise.resolve({
        content: openaevTenantId === 'oa-tenant-1'
          ? [{ asset_id: 'asset-openaev-1', asset_name: 'srv-01', asset_category: 'host', asset_tags: ['oa-tag-1'] }]
          : [{ asset_id: 'asset-openaev-2', asset_name: 'srv-01', asset_category: 'host', asset_tags: ['oa-tag-2'] }],
        last: true,
        totalElements: 1,
        number: 0,
        size: 100,
      }));
      // Both sub-tenants report the same machine, so the matcher consolidates them onto one
      // canonical asset — the only case where the two passes meet on a single row.
      mockBulkUpsertAssets.mockImplementation((inputs: Array<{ sourceAssetId: string }>) => Promise.resolve(
        new Map(inputs.map((input) => [input.sourceAssetId, 'sa-uuid-1'])),
      ));

      await openaevSyncHandler(makeCtx());

      expect(mockSetAssetTags).toHaveBeenCalledTimes(2);
      expect(mockSetAssetTags).toHaveBeenNthCalledWith(1, 'connector-id-abc', [
        { supportingAssetId: 'sa-uuid-1', tagIds: ['tag-uuid-1'] },
      ]);
      expect(mockSetAssetTags).toHaveBeenNthCalledWith(2, 'connector-id-abc', [
        { supportingAssetId: 'sa-uuid-1', tagIds: ['tag-uuid-1', 'tag-uuid-2'] },
      ]);
    });

    // The per-route lists are built in the inventory loop itself rather than by a later `filter`,
    // so a page mixing the three routes is what tells the routing apart from the order rows happen
    // to arrive in — each of the cases above sees a page holding one asset.
    it('splits one inventory page across all three enrichment routes, and still upserts every asset once', async () => {
      mockSearchAssets.mockResolvedValueOnce({
        content: [
          { asset_id: 'asset-endpoint-1', asset_type: 'endpoint', asset_name: 'srv-01', asset_category: 'host' },
          { asset_id: 'asset-cloud-1', asset_type: 'asset', asset_name: 'prod-bucket', asset_category: 'cloud_resource' },
          { asset_id: 'asset-ai-1', asset_type: 'asset', asset_name: 'support-bot', asset_category: 'ai_target' },
        ],
        last: true,
        totalElements: 3,
        number: 0,
        size: 100,
      });
      mockFindEndpoints.mockResolvedValueOnce([{ asset_id: 'asset-endpoint-1', asset_hostname: 'srv-01.internal' }]);
      mockSearchAiTargets.mockResolvedValueOnce({
        content: [{ asset_id: 'asset-ai-1', asset_name: 'support-bot', ai_target_model: 'gpt-4o' }],
        last: true,
        totalElements: 1,
        number: 0,
        size: 100,
      });
      mockBulkUpsertAssets.mockResolvedValueOnce(new Map([
        ['asset-endpoint-1', 'sa-uuid-1'],
        ['asset-cloud-1', 'sa-uuid-2'],
        ['asset-ai-1', 'sa-uuid-3'],
      ]));

      await openaevSyncHandler(makeCtx());

      expect(mockFindEndpoints).toHaveBeenCalledWith('oa-tenant-1', ['asset-endpoint-1']);
      expect(mockGetAssetOverview).not.toHaveBeenCalled();
      expect(mockGetReportedOverviewFields).toHaveBeenCalledExactlyOnceWith('connector-id-abc', ['asset-cloud-1']);
      expect(mockBulkUpsertAssets).toHaveBeenCalledOnce();
      expect(mockBulkUpsertAssets.mock.calls[0][0]).toEqual([
        expect.objectContaining({ sourceAssetId: 'asset-endpoint-1', properties: expect.objectContaining({ hostname: 'srv-01.internal' }) }),
        expect.objectContaining({ sourceAssetId: 'asset-cloud-1' }),
        expect.objectContaining({ sourceAssetId: 'asset-ai-1', properties: expect.objectContaining({ family: 'ai_target' }) }),
      ]);
    });

    it('registers every inventoried asset once per OpenAEV tenant, flagging the ones only the overview route describes', async () => {
      mockSearchAssets.mockResolvedValueOnce({
        content: [
          { asset_id: 'asset-endpoint-1', asset_type: 'endpoint', asset_name: 'srv-01', asset_category: 'host' },
          { asset_id: 'asset-cloud-1', asset_type: 'asset', asset_name: 'prod-bucket', asset_category: 'cloud_resource' },
          { asset_id: 'asset-ai-1', asset_type: 'asset', asset_name: 'support-bot', asset_category: 'ai_target' },
        ],
        last: true,
        totalElements: 3,
        number: 0,
        size: 100,
      });
      mockBulkUpsertAssets.mockResolvedValueOnce(new Map([
        ['asset-endpoint-1', 'sa-uuid-1'],
        ['asset-cloud-1', 'sa-uuid-2'],
        ['asset-ai-1', 'sa-uuid-3'],
      ]));

      await openaevSyncHandler(makeCtx());

      expect(mockUpsertOpenaevAssets).toHaveBeenCalledOnce();
      expect(mockUpsertOpenaevAssets).toHaveBeenCalledWith({
        connectorId: 'connector-id-abc',
        assets: [
          { sourceAssetId: 'asset-endpoint-1', openaevTenantId: 'oa-tenant-1', needsDescriptionFetch: false },
          { sourceAssetId: 'asset-cloud-1', openaevTenantId: 'oa-tenant-1', needsDescriptionFetch: true },
          { sourceAssetId: 'asset-ai-1', openaevTenantId: 'oa-tenant-1', needsDescriptionFetch: false },
        ],
      });
    });

    it('registers the assets of each OpenAEV tenant under its own tenant id', async () => {
      mockListTenants.mockResolvedValueOnce([
        { tenant_id: 'oa-tenant-1', tenant_name: 'Tenant A' },
        { tenant_id: 'oa-tenant-2', tenant_name: 'Tenant B' },
      ]);

      await openaevSyncHandler(makeCtx());

      expect(mockUpsertOpenaevAssets.mock.calls.map(([input]) => input.assets.map((a: { openaevTenantId: string }) => a.openaevTenantId)))
        .toEqual([['oa-tenant-1'], ['oa-tenant-2']]);
    });

    it('registers no asset for a tenant whose inventory is empty', async () => {
      mockSearchAssets.mockResolvedValueOnce({ content: [], last: true, totalElements: 0, number: 0, size: 100 });

      await openaevSyncHandler(makeCtx());

      expect(mockUpsertOpenaevAssets).not.toHaveBeenCalled();
    });

    describe('retiring and unregistering the assets OpenAEV stopped listing', () => {
      const onePage = (assetIds: Array<string>) => ({
        content: assetIds.map((assetId) => ({ asset_id: assetId, asset_type: 'endpoint', asset_name: assetId, asset_category: 'host' })),
        last: true,
        totalElements: assetIds.length,
        number: 0,
        size: 100,
      });
      const gonePairs = [{ supportingAssetId: 'sa-gone', scope: 'asset-gone' }];

      it('asks which registered assets the completed inventory did not list, against what it reported', async () => {
        mockSearchAssets.mockResolvedValueOnce(onePage(['asset-1', 'asset-2']));
        mockBulkUpsertAssets.mockResolvedValueOnce(new Map([['asset-1', 'sa-1'], ['asset-2', 'sa-2']]));

        await openaevSyncHandler(makeCtx());

        expect(mockListUnreportedAssets).toHaveBeenCalledExactlyOnceWith({
          connectorId: 'connector-id-abc',
          openaevTenantId: 'oa-tenant-1',
          reportedSourceAssetIds: ['asset-1', 'asset-2'],
        });
        expect(mockUpsertOpenaevAssets.mock.invocationCallOrder[0]).toBeLessThan(mockListUnreportedAssets.mock.invocationCallOrder[0]);
      });

      it('retires the CVEs scoped by the unreported assets, then unregisters them, in that order', async () => {
        const callOrder: Array<string> = [];
        mockListUnreportedAssets.mockResolvedValueOnce(['asset-gone']);
        mockFindCveScopePairsSince.mockResolvedValueOnce(gonePairs);
        mockRetireCveEvidence.mockImplementation(() => {
          callOrder.push('retireCve');
          return Promise.resolve();
        });
        mockPruneAssets.mockImplementation(() => {
          callOrder.push('prune');
          return Promise.resolve();
        });

        await openaevSyncHandler(makeCtx());

        expect(mockFindCveScopePairsSince.mock.calls[0]).toEqual(['connector-id-abc', new Date(0), ['asset-gone']]);
        expect(mockRetireCveEvidence.mock.calls[0][0]).toMatchObject({
          connectorId: 'connector-id-abc',
          pairs: [{ supportingAssetId: 'sa-gone', scope: 'asset-gone' }],
          enumeratedAt: expect.any(Date),
        });
        expect(mockPruneAssets).toHaveBeenCalledExactlyOnceWith({ connectorId: 'connector-id-abc', openaevTenantId: 'oa-tenant-1', sourceAssetIds: ['asset-gone'] });
        expect(callOrder.slice(0, 2)).toEqual(['retireCve', 'prune']);
      });

      it('asks OpenAEV for the unreported assets by id, and retires and unregisters only those it no longer lists', async () => {
        mockListUnreportedAssets.mockResolvedValueOnce(['asset-skipped', 'asset-gone']);
        mockFindListedAssetIds.mockResolvedValueOnce(new Set(['asset-skipped']));

        await openaevSyncHandler(makeCtx());

        expect(mockFindListedAssetIds).toHaveBeenCalledExactlyOnceWith('oa-tenant-1', ['asset-skipped', 'asset-gone']);
        expect(mockFindCveScopePairsSince.mock.calls[0]).toEqual(['connector-id-abc', new Date(0), ['asset-gone']]);
        expect(mockPruneAssets).toHaveBeenCalledExactlyOnceWith({ connectorId: 'connector-id-abc', openaevTenantId: 'oa-tenant-1', sourceAssetIds: ['asset-gone'] });
      });

      it('looks the unreported assets up 100 ids per call, and unregisters those no batch lists', async () => {
        const unreported = Array.from({ length: 150 }, (_, i) => `asset-${i}`);
        mockListUnreportedAssets.mockResolvedValueOnce(unreported);
        mockFindListedAssetIds.mockImplementation((_tenantId: string, batchIds: Array<string>) =>
          Promise.resolve(new Set(batchIds.filter((id) => id !== 'asset-0' && id !== 'asset-149'))));

        await openaevSyncHandler(makeCtx());

        expect(mockFindListedAssetIds.mock.calls.map(([, batchIds]) => batchIds.length)).toEqual([100, 50]);
        expect(mockPruneAssets.mock.calls[0][0].sourceAssetIds.sort()).toEqual(['asset-0', 'asset-149']);
      });

      it('retires and unregisters nothing when OpenAEV still lists every unreported asset', async () => {
        mockListUnreportedAssets.mockResolvedValueOnce(['asset-skipped']);
        mockFindListedAssetIds.mockResolvedValueOnce(new Set(['asset-skipped']));

        await openaevSyncHandler(makeCtx());

        expect(mockFindCveScopePairsSince).not.toHaveBeenCalledWith('connector-id-abc', new Date(0), expect.anything());
        expect(mockPruneAssets).not.toHaveBeenCalled();
      });

      it('leaves the assets registered when the retirement fails, for the next inventory to redo it', async () => {
        mockListUnreportedAssets.mockResolvedValueOnce(['asset-gone']);
        mockRetireCveEvidence.mockRejectedValueOnce(new Error('deadlock'));

        await expect(openaevSyncHandler(makeCtx())).rejects.toThrow('deadlock');

        expect(mockPruneAssets).not.toHaveBeenCalled();
      });

      it('retires and unregisters nothing when every registered asset was listed', async () => {
        await openaevSyncHandler(makeCtx());

        expect(mockFindCveScopePairsSince).toHaveBeenCalledOnce();
        expect(mockPruneAssets).not.toHaveBeenCalled();
      });

      it('goes through each OpenAEV tenant against its own inventory', async () => {
        mockListTenants.mockResolvedValueOnce([
          { tenant_id: 'oa-tenant-1', tenant_name: 'Tenant A' },
          { tenant_id: 'oa-tenant-2', tenant_name: 'Tenant B' },
        ]);
        mockSearchAssets.mockResolvedValueOnce(onePage(['asset-a'])).mockResolvedValueOnce(onePage(['asset-b']));

        await openaevSyncHandler(makeCtx());

        expect(mockListUnreportedAssets.mock.calls.map(([input]) => [input.openaevTenantId, input.reportedSourceAssetIds]))
          .toEqual([['oa-tenant-1', ['asset-a']], ['oa-tenant-2', ['asset-b']]]);
      });

      describe.each([
        ['an inventory that listed nothing', () => mockSearchAssets.mockResolvedValueOnce(onePage([]))],
        ['a truncated asset list', () => mockPaginateAll.mockImplementationOnce(
          async (fetchPage: (page: number) => Promise<{ content: Array<unknown>, totalElements: number }>, _signal: AbortSignal, onTruncated: (pages: number) => void) => {
            onTruncated(100);
            const page = await fetchPage(0);
            return { items: page.content, totalElements: page.totalElements };
          },
        )],
        ['a truncated AI target list', () => mockPaginateAll
          .mockImplementationOnce(async (fetchPage: (page: number) => Promise<{ content: Array<unknown>, totalElements: number }>) => {
            const page = await fetchPage(0);
            return { items: page.content, totalElements: page.totalElements };
          })
          .mockImplementationOnce((_fetchPage: unknown, _signal: AbortSignal, onTruncated: (pages: number) => void) => {
            onTruncated(100);
            return Promise.resolve({ items: [], totalElements: 0 });
          })],
        ['an asset list whose pages disagreed on the total', () => mockPaginateAll.mockImplementationOnce(
          async (fetchPage: (page: number) => Promise<{ content: Array<unknown> }>) => ({ items: (await fetchPage(0)).content, totalElements: null }),
        )],
        ['an asset list shorter than the total its pages reported', () => mockSearchAssets.mockResolvedValueOnce({ ...onePage(['asset-a']), totalElements: 2 })],
      ])('with %s', (_name, arrange) => {
        it('asks for nothing, retires nothing and unregisters nothing', async () => {
          arrange();
          mockListUnreportedAssets.mockResolvedValue(['asset-gone']);

          await openaevSyncHandler(makeCtx());

          expect(mockListUnreportedAssets).not.toHaveBeenCalled();
          expect(mockFindCveScopePairsSince).not.toHaveBeenCalledWith('connector-id-abc', new Date(0), expect.anything());
          expect(mockPruneAssets).not.toHaveBeenCalled();
        });
      });

      it('does nothing when the run was aborted before the inventory ended', async () => {
        const ctrl = new AbortController();
        mockBulkUpsertAssets.mockImplementationOnce(() => {
          ctrl.abort();
          return Promise.resolve(new Map([['asset-openaev-1', 'sa-uuid-1']]));
        });

        await openaevSyncHandler(makeCtx({ signal: ctrl.signal }));

        expect(mockListUnreportedAssets).not.toHaveBeenCalled();
        expect(mockPruneAssets).not.toHaveBeenCalled();
      });

      it('does nothing when no inventory ran', async () => {
        inventorySyncedHoursAgo(2);

        await openaevSyncHandler(makeCtx());

        expect(mockListUnreportedAssets).not.toHaveBeenCalled();
      });
    });

    it('clears an asset\'s tags when OpenAEV no longer reports any, rather than leaving the last-known set', async () => {
      mockSearchAssets.mockResolvedValueOnce({
        content: [{ asset_id: 'asset-openaev-1', asset_name: 'srv-01', asset_category: 'host', asset_tags: [] }],
        last: true,
        totalElements: 1,
        number: 0,
        size: 100,
      });

      await openaevSyncHandler(makeCtx());

      expect(mockSetAssetTags).toHaveBeenCalledWith('connector-id-abc', [
        { supportingAssetId: 'sa-uuid-1', tagIds: [] },
      ]);
    });

    it('leaves the posture to OpenAEV: no counters are read during the inventory', async () => {
      await openaevSyncHandler(makeCtx());

      expect(mockSearchAssets).toHaveBeenCalledOnce();
      expect(mockFetchPostureCounters).not.toHaveBeenCalled();
    });
  });

  describe('observation phase', () => {
    const readyWalk = (startedAt: Date): ObservationPhaseResult['attack'] => ({ fullWalk: { startedAt, ready: true }, walked: true, reconcileFrom });

    it('reads the streams of each OpenAEV tenant against the map its inventory just built', async () => {
      await openaevSyncHandler(makeCtx());

      expect(mockSyncObservationStreams).toHaveBeenCalledOnce();
      expect(mockSyncObservationStreams.mock.calls[0][0]).toMatchObject({
        connectorId: 'connector-id-abc',
        openaevTenantId: 'oa-tenant-1',
        assetIdMap: new Map([['asset-openaev-1', 'sa-uuid-1']]),
      });
    });

    describe('inventory on demand', () => {
      it('hands the phase this tenant\'s inventory to run when an observation names an unknown asset and no inventory ran in this run', async () => {
        inventorySyncedHoursAgo(2);
        mockBulkUpsertAssets.mockResolvedValueOnce(new Map([['asset-new', 'sa-uuid-new']]));
        mockSearchAssets.mockResolvedValueOnce({
          content: [{ asset_id: 'asset-new', asset_type: 'endpoint', asset_name: 'new', asset_category: 'host' }],
          last: true,
          totalElements: 1,
          number: 0,
          size: 100,
        });
        let refreshed: Map<string, string> | null = null;
        mockSyncObservationStreams.mockImplementationOnce(async (deps: ObservationPhaseDeps) => {
          refreshed = await deps.ensureInventory();
          return noFullWalk;
        });

        await openaevSyncHandler(makeCtx());

        expect(mockSearchAssets).toHaveBeenCalledWith('oa-tenant-1', expect.any(Number));
        expect(refreshed).toEqual(new Map([['asset-new', 'sa-uuid-new']]));
      });

      it('leaves the completion instant alone, since the inventory of the other tenants did not run', async () => {
        inventorySyncedHoursAgo(2);
        mockSyncObservationStreams.mockImplementationOnce(async (deps: ObservationPhaseDeps) => {
          await deps.ensureInventory();
          return quietPhase(deps);
        });

        await openaevSyncHandler(makeCtx());

        expect(mockMarkSynced).not.toHaveBeenCalled();
      });

      it('has nothing to run when the inventory already ran in this run', async () => {
        let refreshed: Map<string, string> | null | undefined;
        mockSyncObservationStreams.mockImplementationOnce(async (deps: ObservationPhaseDeps) => {
          refreshed = await deps.ensureInventory();
          return quietPhase(deps);
        });

        await openaevSyncHandler(makeCtx());

        expect(refreshed).toBeNull();
        expect(mockSearchAssets).toHaveBeenCalledOnce();
      });

      it('has nothing to run on a resumed job whose inventory was checkpointed', async () => {
        let refreshed: Map<string, string> | null | undefined;
        mockSyncObservationStreams.mockImplementationOnce(async (deps: ObservationPhaseDeps) => {
          refreshed = await deps.ensureInventory();
          return quietPhase(deps);
        });

        await openaevSyncHandler(makeCtx({ state: inventoryDoneState() }));

        expect(refreshed).toBeNull();
        expect(mockSearchAssets).not.toHaveBeenCalled();
      });
    });

    describe('reconciliation after a differential read', () => {
      it('retires the attack evidence of the pairs seen since the instant to reconcile from, then the CVE evidence, after each tenant\'s phase', async () => {
        const callOrder: Array<string> = [];
        mockListTenants.mockResolvedValueOnce([
          { tenant_id: 'oa-tenant-1', tenant_name: 'Tenant A' },
          { tenant_id: 'oa-tenant-2', tenant_name: 'Tenant B' },
        ]);
        mockSyncObservationStreams.mockImplementation((deps: ObservationPhaseDeps) => {
          callOrder.push(`phase:${deps.openaevTenantId}`);
          return quietPhase(deps);
        });
        mockListObservationPairsReportedSince.mockImplementation(({ openaevTenantId }: { openaevTenantId: string }) =>
          Promise.resolve([{ sourceAssetId: `asset-of-${openaevTenantId}`, scenarioId: 'scenario-1' }]));
        mockGetInventoryAssetIdMap.mockResolvedValue(new Map([['asset-of-oa-tenant-1', 'sa-1'], ['asset-of-oa-tenant-2', 'sa-2']]));
        mockGetAssetTenantMap.mockResolvedValue(new Map([['asset-of-oa-tenant-1', 'oa-tenant-1'], ['asset-of-oa-tenant-2', 'oa-tenant-2']]));
        mockRetireAttackEvidence.mockImplementation(() => {
          callOrder.push('retireAttack');
          return Promise.resolve();
        });
        mockRetireCveEvidence.mockImplementation(() => {
          callOrder.push('retireCve');
          return Promise.resolve();
        });

        await openaevSyncHandler(makeCtx());

        expect(callOrder).toEqual(['phase:oa-tenant-1', 'retireAttack', 'retireCve', 'phase:oa-tenant-2', 'retireAttack', 'retireCve']);
        expect(mockListObservationPairsReportedSince).toHaveBeenCalledWith({ connectorId: 'connector-id-abc', openaevTenantId: 'oa-tenant-2', since: reconcileFrom });
        expect(mockRetireAttackEvidence.mock.calls[1][0]).toMatchObject({
          connectorId: 'connector-id-abc',
          mirrorPairs: [{ sourceAssetId: 'asset-of-oa-tenant-2', scenarioId: 'scenario-1' }],
          extraScopePairs: [],
        });
        expect(mockFindCveScopePairsSince).toHaveBeenCalledWith('connector-id-abc', reconcileFrom, expect.anything());
        expect(mockRetireCveEvidence.mock.calls[0][0]).toMatchObject({ connectorId: 'connector-id-abc', enumeratedAt: reconcileFrom });
      });

      it('judges only the CVE sources scoped by an asset of this OpenAEV tenant, enumerated at the instant to reconcile from', async () => {
        mockListSourceAssetIds.mockResolvedValueOnce(['asset-a', 'asset-b']);
        mockFindCveScopePairsSince.mockResolvedValueOnce([{ supportingAssetId: 'sa-1', scope: 'asset-a' }]);

        await openaevSyncHandler(makeCtx());

        expect(mockListSourceAssetIds).toHaveBeenCalledWith({ connectorId: 'connector-id-abc', openaevTenantId: 'oa-tenant-1' });
        expect(mockFindCveScopePairsSince).toHaveBeenCalledWith('connector-id-abc', reconcileFrom, ['asset-a', 'asset-b']);
        expect(mockRetireCveEvidence).toHaveBeenCalledOnce();
        expect(mockRetireCveEvidence.mock.calls[0][0]).toMatchObject({
          connectorId: 'connector-id-abc',
          pairs: [{ supportingAssetId: 'sa-1', scope: 'asset-a' }],
          enumeratedAt: reconcileFrom,
        });
      });

      it('judges the pairs against every asset on file, not against the inventory of this OpenAEV tenant', async () => {
        const registry = new Map([['asset-of-tenant-1', 'sa-1'], ['asset-of-tenant-2', 'sa-2']]);
        mockGetInventoryAssetIdMap.mockResolvedValue(registry);

        await openaevSyncHandler(makeCtx());

        expect(mockRetireAttackEvidence.mock.calls[0][0].assetIdMap).toBe(registry);
      });

      it('judges no pair of an OpenCRQ asset folded from an OpenAEV asset of a tenant whose mirror is not complete', async () => {
        mockListTenants.mockResolvedValueOnce([
          { tenant_id: 'oa-tenant-1', tenant_name: 'Tenant A' },
          { tenant_id: 'oa-tenant-2', tenant_name: 'Tenant B' },
        ]);
        mockListObservationPairsReportedSince.mockResolvedValueOnce([
          { sourceAssetId: 'asset-a', scenarioId: 'scenario-1' },
          { sourceAssetId: 'asset-folded', scenarioId: 'scenario-1' },
        ]);
        mockGetInventoryAssetIdMap.mockResolvedValue(new Map([['asset-a', 'sa-a'], ['asset-folded', 'sa-folded'], ['asset-of-b', 'sa-folded']]));
        mockGetAssetTenantMap.mockResolvedValue(new Map([['asset-a', 'oa-tenant-1'], ['asset-folded', 'oa-tenant-1'], ['asset-of-b', 'oa-tenant-2']]));

        await openaevSyncHandler(makeCtx());

        expect(mockRetireAttackEvidence.mock.calls[0][0].mirrorPairs).toEqual([{ sourceAssetId: 'asset-a', scenarioId: 'scenario-1' }]);
      });

      it('reads neither the registry, the registered tenants nor the stream states, and retires nothing, when no pair was seen', async () => {
        mockListObservationPairsReportedSince.mockResolvedValue([]);

        await openaevSyncHandler(makeCtx());

        expect(mockGetInventoryAssetIdMap).not.toHaveBeenCalled();
        expect(mockGetAssetTenantMap).not.toHaveBeenCalled();
        expect(mockGetStreamStates).not.toHaveBeenCalled();
        expect(mockRetireAttackEvidence).not.toHaveBeenCalled();
        expect(mockMarkStreamReconciled).toHaveBeenCalledWith({ connectorId: 'connector-id-abc', openaevTenantId: 'oa-tenant-1', stream: 'attack' });
      });

      it('hands the phase the instant the run began, taken before anything is read', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
          const runStart = new Date('2026-10-06T10:00:00.000Z');
          vi.setSystemTime(runStart);
          mockSyncObservationStreams.mockImplementationOnce((deps: ObservationPhaseDeps) => {
            vi.setSystemTime(new Date('2026-10-06T10:20:00.000Z'));
            return quietPhase(deps);
          });

          await openaevSyncHandler(makeCtx({ state: inventoryDoneState() }));

          expect(mockSyncObservationStreams.mock.calls[0][0].runStartedAt).toEqual(runStart);
        } finally {
          vi.useRealTimers();
        }
      });

      it('does not delete a mirror row nor retire a whole estate when no full walk completed, and ends no walk', async () => {
        await openaevSyncHandler(makeCtx());

        expect(mockDeleteObservationsNotReportedSince).not.toHaveBeenCalled();
        expect(mockListObservationPairs).not.toHaveBeenCalled();
        expect(mockFindEvidenceScopePairsForConnector).not.toHaveBeenCalled();
        expect(mockRetireAttackEvidence).toHaveBeenCalledOnce();
        expect(mockRetireCveEvidence).toHaveBeenCalledOnce();
        expect(mockCompleteFullWalk).not.toHaveBeenCalled();
      });

      it('marks each stream reconciled once its retirement is done, and not before', async () => {
        const callOrder: Array<string> = [];
        mockRetireAttackEvidence.mockImplementation(() => {
          callOrder.push('retireAttack');
          return Promise.resolve();
        });
        mockRetireCveEvidence.mockImplementation(() => {
          callOrder.push('retireCve');
          return Promise.resolve();
        });
        mockMarkStreamReconciled.mockImplementation(({ stream }: { stream: string }) => {
          callOrder.push(`reconciled:${stream}`);
          return Promise.resolve();
        });

        await openaevSyncHandler(makeCtx());

        expect(callOrder).toEqual(['retireAttack', 'reconciled:attack', 'retireCve', 'reconciled:vulnerability']);
        expect(mockMarkStreamReconciled).toHaveBeenCalledWith({ connectorId: 'connector-id-abc', openaevTenantId: 'oa-tenant-1', stream: 'attack' });
      });
    });

    describe('reconciliation after a full walk', () => {
      const walkStart = new Date('2026-10-01T00:00:00.000Z');
      const key = (stream: 'attack' | 'vulnerability') => ({ connectorId: 'connector-id-abc', openaevTenantId: 'oa-tenant-1', stream });

      it('drops the mirror rows the walk did not see, retires the whole attack estate, then ends the walk and marks the stream reconciled', async () => {
        const callOrder: Array<string> = [];
        const registry = new Map([['asset-a', 'sa-a'], ['asset-b', 'sa-b']]);
        mockSyncObservationStreams.mockResolvedValueOnce({ ...noFullWalk, attack: readyWalk(walkStart) });
        mockListObservationPairs.mockResolvedValueOnce([{ sourceAssetId: 'asset-a', scenarioId: 'scenario-1' }]);
        mockFindEvidenceScopePairsForConnector.mockResolvedValueOnce([{ supportingAssetId: 'sa-b', scope: 'scenario-2' }]);
        mockGetInventoryAssetIdMap.mockResolvedValue(registry);
        mockDeleteObservationsNotReportedSince.mockImplementation(() => {
          callOrder.push('delete');
          return Promise.resolve([]);
        });
        mockRetireAttackEvidence.mockImplementation(() => {
          callOrder.push('retireAttack');
          return Promise.resolve();
        });
        mockCompleteFullWalk.mockImplementation(({ stream }: { stream: string }) => {
          callOrder.push(`complete:${stream}`);
          return Promise.resolve();
        });
        mockMarkStreamReconciled.mockImplementation(({ stream }: { stream: string }) => {
          callOrder.push(`reconciled:${stream}`);
          return Promise.resolve();
        });

        await openaevSyncHandler(makeCtx());

        expect(mockDeleteObservationsNotReportedSince).toHaveBeenCalledWith({ connectorId: 'connector-id-abc', openaevTenantId: 'oa-tenant-1', since: walkStart });
        expect(callOrder.slice(0, 4)).toEqual(['delete', 'retireAttack', 'complete:attack', 'reconciled:attack']);
        expect(mockRetireAttackEvidence).toHaveBeenCalledOnce();
        expect(mockRetireAttackEvidence.mock.calls[0][0]).toMatchObject({
          connectorId: 'connector-id-abc',
          assetIdMap: registry,
          mirrorPairs: [{ sourceAssetId: 'asset-a', scenarioId: 'scenario-1' }],
          extraScopePairs: [{ supportingAssetId: 'sa-b', scope: 'scenario-2' }],
        });
        expect(mockListObservationPairs).toHaveBeenCalledWith('connector-id-abc');
        expect(mockFindEvidenceScopePairsForConnector).toHaveBeenCalledWith('connector-id-abc');
        expect(mockListObservationPairsReportedSince).not.toHaveBeenCalled();
        expect(mockCompleteFullWalk).toHaveBeenCalledWith({ ...key('attack'), completedAt: expect.any(Date), ready: true });
      });

      describe('evidence with no mirror document', () => {
        const extraPairs = [{ supportingAssetId: 'sa-a', scope: 'scenario-2' }, { supportingAssetId: 'sa-b', scope: 'scenario-2' }];
        const attackState = (openaevTenantId: string, lastFullWalkCompletedAt: Date | null, stream: 'attack' | 'vulnerability' = 'attack') =>
          ({ openaevTenantId, stream, lastFullWalkCompletedAt });

        beforeEach(() => {
          mockSyncObservationStreams.mockResolvedValueOnce({ ...noFullWalk, attack: readyWalk(walkStart) });
          mockGetInventoryAssetIdMap.mockResolvedValue(new Map([['asset-a', 'sa-a'], ['asset-b', 'sa-b']]));
          mockFindEvidenceScopePairsForConnector.mockResolvedValueOnce(extraPairs);
          mockGetAssetTenantMap.mockResolvedValue(new Map([['asset-a', 'oa-tenant-1'], ['asset-b', 'oa-tenant-2']]));
        });

        it('is judged only on the assets of the walked tenant and of tenants whose attack walk completed before', async () => {
          mockGetStreamStates.mockResolvedValueOnce([]);

          await openaevSyncHandler(makeCtx());

          expect(mockRetireAttackEvidence.mock.calls[0][0].extraScopePairs).toEqual([{ supportingAssetId: 'sa-a', scope: 'scenario-2' }]);
        });

        it('is judged on the assets of another tenant once its attack walk completed', async () => {
          mockGetStreamStates.mockResolvedValueOnce([attackState('oa-tenant-2', new Date('2026-09-30T00:00:00.000Z'))]);

          await openaevSyncHandler(makeCtx());

          expect(mockGetStreamStates).toHaveBeenCalledWith('connector-id-abc');
          expect(mockRetireAttackEvidence.mock.calls[0][0].extraScopePairs).toEqual(extraPairs);
        });

        it('is not judged on the assets of a tenant whose attack walk never completed, nor on a completed vulnerability walk', async () => {
          mockGetStreamStates.mockResolvedValueOnce([
            attackState('oa-tenant-2', null),
            attackState('oa-tenant-2', new Date('2026-09-30T00:00:00.000Z'), 'vulnerability'),
          ]);

          await openaevSyncHandler(makeCtx());

          expect(mockRetireAttackEvidence.mock.calls[0][0].extraScopePairs).toEqual([{ supportingAssetId: 'sa-a', scope: 'scenario-2' }]);
        });

        it('is not judged on an OpenCRQ asset one of whose OpenAEV assets belongs to a tenant with an incomplete mirror', async () => {
          mockGetInventoryAssetIdMap.mockResolvedValue(new Map([['asset-a', 'sa-a'], ['asset-a-bis', 'sa-a'], ['asset-b', 'sa-b']]));
          mockGetAssetTenantMap.mockResolvedValue(new Map([['asset-a', 'oa-tenant-1'], ['asset-a-bis', 'oa-tenant-2'], ['asset-b', 'oa-tenant-1']]));

          await openaevSyncHandler(makeCtx());

          expect(mockRetireAttackEvidence.mock.calls[0][0].extraScopePairs).toEqual([{ supportingAssetId: 'sa-b', scope: 'scenario-2' }]);
        });

        it('is not judged on an OpenAEV asset of unknown tenant while a tenant of the run is incomplete', async () => {
          mockListTenants.mockResolvedValueOnce([
            { tenant_id: 'oa-tenant-1', tenant_name: 'Tenant A' },
            { tenant_id: 'oa-tenant-2', tenant_name: 'Tenant B' },
          ]);
          mockGetAssetTenantMap.mockResolvedValue(new Map([['asset-a', 'oa-tenant-1']]));

          await openaevSyncHandler(makeCtx());

          expect(mockRetireAttackEvidence.mock.calls[0][0].extraScopePairs).toEqual([{ supportingAssetId: 'sa-a', scope: 'scenario-2' }]);
        });

        it('is judged on an OpenAEV asset of unknown tenant once every tenant of the run is complete', async () => {
          mockListTenants.mockResolvedValueOnce([
            { tenant_id: 'oa-tenant-1', tenant_name: 'Tenant A' },
            { tenant_id: 'oa-tenant-2', tenant_name: 'Tenant B' },
          ]);
          mockGetAssetTenantMap.mockResolvedValue(new Map([['asset-a', 'oa-tenant-1']]));
          mockGetStreamStates.mockResolvedValueOnce([attackState('oa-tenant-2', new Date('2026-09-30T00:00:00.000Z'))]);

          await openaevSyncHandler(makeCtx());

          expect(mockRetireAttackEvidence.mock.calls[0][0].extraScopePairs).toEqual(extraPairs);
        });

        it('drops the mirror pairs of an asset held by a tenant whose mirror is not complete, as for evidence', async () => {
          mockListObservationPairs.mockResolvedValueOnce([
            { sourceAssetId: 'asset-a', scenarioId: 'scenario-1' },
            { sourceAssetId: 'asset-b', scenarioId: 'scenario-1' },
          ]);
          mockGetStreamStates.mockResolvedValueOnce([]);

          await openaevSyncHandler(makeCtx());

          expect(mockRetireAttackEvidence.mock.calls[0][0].mirrorPairs).toEqual([{ sourceAssetId: 'asset-a', scenarioId: 'scenario-1' }]);
        });

        it('keeps the mirror pairs of another tenant once its attack walk completed', async () => {
          mockListObservationPairs.mockResolvedValueOnce([{ sourceAssetId: 'asset-b', scenarioId: 'scenario-1' }]);
          mockGetStreamStates.mockResolvedValueOnce([attackState('oa-tenant-2', new Date('2026-09-30T00:00:00.000Z'))]);

          await openaevSyncHandler(makeCtx());

          expect(mockRetireAttackEvidence.mock.calls[0][0].mirrorPairs).toEqual([{ sourceAssetId: 'asset-b', scenarioId: 'scenario-1' }]);
        });
      });

      it('retires the pairs seen since it must reconcile from, deletes nothing, and still ends the walk, when the snapshot was not ready', async () => {
        mockSyncObservationStreams.mockResolvedValueOnce({
          ...noFullWalk,
          attack: { fullWalk: { startedAt: walkStart, ready: false }, walked: true, reconcileFrom },
          vulnerability: { fullWalk: { startedAt: walkStart, ready: false }, walked: true, reconcileFrom },
        });

        await openaevSyncHandler(makeCtx());

        expect(mockDeleteObservationsNotReportedSince).not.toHaveBeenCalled();
        expect(mockListObservationPairsReportedSince).toHaveBeenCalledWith({ connectorId: 'connector-id-abc', openaevTenantId: 'oa-tenant-1', since: reconcileFrom });
        expect(mockRetireAttackEvidence).toHaveBeenCalledOnce();
        expect(mockRetireAttackEvidence.mock.calls[0][0]).toMatchObject({ extraScopePairs: [] });
        expect(mockRetireCveEvidence).not.toHaveBeenCalled();
        expect(mockCompleteFullWalk).toHaveBeenCalledWith({ ...key('attack'), completedAt: expect.any(Date), ready: false });
        expect(mockCompleteFullWalk).toHaveBeenCalledWith({ ...key('vulnerability'), completedAt: expect.any(Date), ready: false });
        expect(mockMarkStreamReconciled).toHaveBeenCalledWith(key('attack'));
        expect(mockMarkStreamReconciled).toHaveBeenCalledWith(key('vulnerability'));
      });

      it('retires the CVE sources scoped by this OpenAEV tenant\'s assets, against the walk start, then ends the walk', async () => {
        const callOrder: Array<string> = [];
        mockSyncObservationStreams.mockResolvedValueOnce({ ...noFullWalk, vulnerability: { fullWalk: { startedAt: walkStart, ready: true }, walked: true, reconcileFrom } });
        mockListSourceAssetIds.mockResolvedValueOnce(['asset-a', 'asset-b']);
        mockFindCveScopePairsSince.mockResolvedValueOnce([{ supportingAssetId: 'sa-b', scope: 'asset-b' }]);
        mockRetireCveEvidence.mockImplementation(() => {
          callOrder.push('retireCve');
          return Promise.resolve();
        });
        mockCompleteFullWalk.mockImplementation(({ stream }: { stream: string }) => {
          callOrder.push(`complete:${stream}`);
          return Promise.resolve();
        });
        mockMarkStreamReconciled.mockImplementation(({ stream }: { stream: string }) => {
          callOrder.push(`reconciled:${stream}`);
          return Promise.resolve();
        });

        await openaevSyncHandler(makeCtx());

        expect(mockListSourceAssetIds).toHaveBeenCalledWith({ connectorId: 'connector-id-abc', openaevTenantId: 'oa-tenant-1' });
        expect(mockFindCveScopePairsSince).toHaveBeenCalledWith('connector-id-abc', new Date(0), ['asset-a', 'asset-b']);
        expect(mockRetireCveEvidence).toHaveBeenCalledOnce();
        expect(mockRetireCveEvidence.mock.calls[0][0]).toMatchObject({
          connectorId: 'connector-id-abc',
          pairs: [{ supportingAssetId: 'sa-b', scope: 'asset-b' }],
          enumeratedAt: walkStart,
        });
        expect(callOrder.slice(-3)).toEqual(['retireCve', 'complete:vulnerability', 'reconciled:vulnerability']);
        expect(mockDeleteObservationsNotReportedSince).not.toHaveBeenCalled();
      });

      it('judges no CVE source whose scope this OpenAEV tenant does not register, whichever the read', async () => {
        mockSyncObservationStreams.mockResolvedValueOnce({ ...noFullWalk, vulnerability: { fullWalk: { startedAt: walkStart, ready: true }, walked: true, reconcileFrom } });
        mockListObservationPairsReportedSince.mockResolvedValueOnce([]);
        mockListSourceAssetIds.mockResolvedValueOnce(['asset-a']);

        await openaevSyncHandler(makeCtx());

        expect(mockGetAssetTenantMap).not.toHaveBeenCalled();
        expect(mockFindCveScopePairsSince).toHaveBeenCalledExactlyOnceWith('connector-id-abc', new Date(0), ['asset-a']);
      });

      it('retires the CVE evidence of a walk only on a vulnerability walk, and the attack estate only on an attack walk', async () => {
        mockSyncObservationStreams.mockResolvedValueOnce({ ...noFullWalk, attack: readyWalk(walkStart) });

        await openaevSyncHandler(makeCtx());

        expect(mockRetireCveEvidence).toHaveBeenCalledOnce();
        expect(mockFindCveScopePairsSince).toHaveBeenCalledWith('connector-id-abc', reconcileFrom, expect.anything());
        expect(mockRetireCveEvidence.mock.calls[0][0].enumeratedAt).toEqual(reconcileFrom);
        expect(mockCompleteFullWalk).toHaveBeenCalledOnce();
      });

      it('runs no differential CVE retirement on a vulnerability walk still in progress, and leaves its stream unreconciled', async () => {
        mockSyncObservationStreams.mockResolvedValueOnce({
          ...noFullWalk,
          vulnerability: { fullWalk: null, walked: true, reconcileFrom },
        });

        await openaevSyncHandler(makeCtx());

        expect(mockRetireCveEvidence).not.toHaveBeenCalled();
        expect(mockRetireAttackEvidence).toHaveBeenCalledOnce();
        expect(mockCompleteFullWalk).not.toHaveBeenCalled();
        expect(mockMarkStreamReconciled).toHaveBeenCalledOnce();
        expect(mockMarkStreamReconciled).toHaveBeenCalledWith(key('attack'));
      });

      it('keeps the differential attack retirement on a walk that is cut short, and the CVE one on an attack walk', async () => {
        mockSyncObservationStreams.mockResolvedValueOnce({
          ...noFullWalk,
          attack: { fullWalk: null, walked: true, reconcileFrom },
        });
        mockListObservationPairsReportedSince.mockResolvedValueOnce([{ sourceAssetId: 'asset-a', scenarioId: 'scenario-1' }]);
        mockGetInventoryAssetIdMap.mockResolvedValue(new Map([['asset-a', 'sa-a']]));
        mockGetAssetTenantMap.mockResolvedValue(new Map([['asset-a', 'oa-tenant-1']]));

        await openaevSyncHandler(makeCtx());

        expect(mockDeleteObservationsNotReportedSince).not.toHaveBeenCalled();
        expect(mockRetireAttackEvidence).toHaveBeenCalledOnce();
        expect(mockRetireAttackEvidence.mock.calls[0][0]).toMatchObject({
          mirrorPairs: [{ sourceAssetId: 'asset-a', scenarioId: 'scenario-1' }],
          extraScopePairs: [],
        });
        expect(mockRetireCveEvidence).toHaveBeenCalledOnce();
        expect(mockCompleteFullWalk).not.toHaveBeenCalled();
      });

      it('leaves the walk open and the stream unreconciled when the attack retirement fails', async () => {
        mockSyncObservationStreams.mockResolvedValueOnce({ ...noFullWalk, attack: readyWalk(walkStart) });
        mockRetireAttackEvidence.mockRejectedValueOnce(new Error('deadlock'));

        await expect(openaevSyncHandler(makeCtx())).rejects.toThrow('deadlock');

        expect(mockCompleteFullWalk).not.toHaveBeenCalled();
        expect(mockMarkStreamReconciled).not.toHaveBeenCalled();
        expect(mockRetireCveEvidence).not.toHaveBeenCalled();
      });

      it('leaves the vulnerability walk open and its stream unreconciled when the CVE retirement fails', async () => {
        mockSyncObservationStreams.mockResolvedValueOnce({
          ...noFullWalk,
          vulnerability: { fullWalk: { startedAt: walkStart, ready: true }, walked: true, reconcileFrom },
        });
        mockRetireCveEvidence.mockRejectedValueOnce(new Error('deadlock'));

        await expect(openaevSyncHandler(makeCtx())).rejects.toThrow('deadlock');

        expect(mockCompleteFullWalk).not.toHaveBeenCalled();
        expect(mockMarkStreamReconciled).toHaveBeenCalledOnce();
        expect(mockMarkStreamReconciled).toHaveBeenCalledWith(key('attack'));
      });
    });

    describe('description phase', () => {
      it('runs once per OpenAEV tenant, after that tenant\'s observation phase and its retirements', async () => {
        const callOrder: Array<string> = [];
        mockListTenants.mockResolvedValueOnce([
          { tenant_id: 'oa-tenant-1', tenant_name: 'Tenant A' },
          { tenant_id: 'oa-tenant-2', tenant_name: 'Tenant B' },
        ]);
        mockSyncObservationStreams.mockImplementation((deps: ObservationPhaseDeps) => {
          callOrder.push(`phase:${deps.openaevTenantId}`);
          return quietPhase(deps);
        });
        mockRetireAttackEvidence.mockImplementation(() => {
          callOrder.push('retireAttack');
          return Promise.resolve();
        });
        mockRetireCveEvidence.mockImplementation(() => {
          callOrder.push('retireCve');
          return Promise.resolve();
        });
        mockSyncDescriptions.mockImplementation((deps: DescriptionPhaseDeps) => {
          callOrder.push(`descriptions:${deps.openaevTenantId}`);
          return Promise.resolve({ calls: 0 });
        });

        await openaevSyncHandler(makeCtx());

        expect(callOrder).toEqual([
          'phase:oa-tenant-1', 'retireAttack', 'retireCve', 'descriptions:oa-tenant-1',
          'phase:oa-tenant-2', 'retireAttack', 'retireCve', 'descriptions:oa-tenant-2',
        ]);
      });

      it('is handed the connector, the tenant, the client, the concurrency cap and the full budget', async () => {
        await openaevSyncHandler(makeCtx());

        expect(mockSyncDescriptions).toHaveBeenCalledOnce();
        expect(mockSyncDescriptions.mock.calls[0][0]).toMatchObject({
          client: mockCreateOpenaevClient.mock.results[0].value,
          connectorId: 'connector-id-abc',
          openaevTenantId: 'oa-tenant-1',
          budget: 500,
          concurrency: 8,
        });
      });

      it('gives each OpenAEV tenant an even share of what the run has left, carrying what one leaves unspent to the next', async () => {
        mockListTenants.mockResolvedValueOnce([
          { tenant_id: 'oa-tenant-1', tenant_name: 'Tenant A' },
          { tenant_id: 'oa-tenant-2', tenant_name: 'Tenant B' },
          { tenant_id: 'oa-tenant-3', tenant_name: 'Tenant C' },
        ]);
        mockSyncDescriptions
          .mockResolvedValueOnce({ calls: 166 })
          .mockResolvedValueOnce({ calls: 20 })
          .mockResolvedValueOnce({ calls: 0 });

        await openaevSyncHandler(makeCtx());

        expect(mockSyncDescriptions.mock.calls.map(([deps]) => [deps.openaevTenantId, deps.budget])).toEqual([
          ['oa-tenant-1', 166],
          ['oa-tenant-2', 167],
          ['oa-tenant-3', 314],
        ]);
      });

      it('runs on a run that skipped the inventory, since descriptions have their own cadence', async () => {
        inventorySyncedHoursAgo(2);

        await openaevSyncHandler(makeCtx());

        expect(mockSearchAssets).not.toHaveBeenCalled();
        expect(mockSyncDescriptions).toHaveBeenCalledOnce();
      });

      it('reports its progress as a message, without touching the observation counter', async () => {
        mockSyncDescriptions.mockImplementation(async (deps: DescriptionPhaseDeps) => {
          await deps.onProgress?.({ processed: 100, total: 250 });
          return { calls: 100 };
        });

        await openaevSyncHandler(makeCtx());

        const descriptionProgress = mockUpdateProgress.mock.calls
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- vi mock.calls is unknown[][]; cast needed to read the typed argument
          .map(([progress]) => progress as ProgressUpdate)
          .filter((progress) => progress.message?.includes('descriptions'));
        expect(descriptionProgress).toEqual([{ message: 'Fetching OpenAEV asset descriptions of tenant oa-tenant-1, 100 of 250' }]);
      });

      it('does not start once the run is aborted, after the retirements of the tenant', async () => {
        const ctrl = new AbortController();
        mockRetireCveEvidence.mockImplementation(() => {
          ctrl.abort();
          return Promise.resolve();
        });

        await openaevSyncHandler(makeCtx({ signal: ctrl.signal, state: inventoryDoneState() }));

        expect(mockSyncDescriptions).not.toHaveBeenCalled();
      });

      it('does not run for a tenant whose observation phase failed, the run failing with it', async () => {
        mockSyncObservationStreams.mockRejectedValueOnce(new Error('OpenAEV snapshot route not found'));

        await expect(openaevSyncHandler(makeCtx())).rejects.toThrow('OpenAEV snapshot route not found');

        expect(mockSyncDescriptions).not.toHaveBeenCalled();
      });

      it('lets a failure of the phase fail the run', async () => {
        mockSyncDescriptions.mockRejectedValueOnce(new Error('database unavailable'));

        await expect(openaevSyncHandler(makeCtx())).rejects.toThrow('database unavailable');
      });
    });

    describe('progress', () => {
      const countedProgress = () =>
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- vi mock.calls is unknown[][]; cast needed to read the typed argument
        (mockUpdateProgress.mock.calls as Array<[ProgressUpdate]>)
          .map(([progress]) => progress.processedTotal)
          .filter((processed) => processed !== undefined);

      it('counts the observations received across both streams and every tenant, with no total to announce', async () => {
        mockListTenants.mockResolvedValueOnce([
          { tenant_id: 'oa-tenant-1', tenant_name: 'Tenant A' },
          { tenant_id: 'oa-tenant-2', tenant_name: 'Tenant B' },
        ]);
        mockSyncObservationStreams.mockImplementation(async (deps: ObservationPhaseDeps) => {
          await deps.onProgress?.({ stream: 'attack', pages: 1, observations: 3 });
          await deps.onProgress?.({ stream: 'attack', pages: 2, observations: 5 });
          await deps.onProgress?.({ stream: 'vulnerability', pages: 1, observations: 2 });
          return quietPhase(deps);
        });

        await openaevSyncHandler(makeCtx());

        expect(countedProgress()).toEqual([3, 5, 7, 10, 12, 14]);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- vi mock.calls is unknown[][]; cast needed to read the typed argument
        const announced = (mockUpdateProgress.mock.calls as Array<[ProgressUpdate]>).filter(([progress]) => progress.expectedTotal !== undefined && progress.expectedTotal !== null);
        expect(announced).toEqual([]);
      });
    });

    describe('stopping', () => {
      it('starts no further tenant once aborted, and retires nothing from the phase that was cut short', async () => {
        const ctrl = new AbortController();
        mockListTenants.mockResolvedValueOnce([
          { tenant_id: 'oa-tenant-1', tenant_name: 'Tenant A' },
          { tenant_id: 'oa-tenant-2', tenant_name: 'Tenant B' },
        ]);
        mockSyncObservationStreams.mockImplementation(() => {
          ctrl.abort();
          return Promise.resolve({ ...noFullWalk, attack: { fullWalk: { startedAt: new Date(), ready: true }, walked: true, reconcileFrom } });
        });

        await openaevSyncHandler(makeCtx({ signal: ctrl.signal, state: inventoryDoneState() }));

        expect(mockSyncObservationStreams).toHaveBeenCalledOnce();
        expect(mockRetireAttackEvidence).not.toHaveBeenCalled();
        expect(mockRetireCveEvidence).not.toHaveBeenCalled();
        expect(mockCompleteFullWalk).not.toHaveBeenCalled();
        expect(mockMarkStreamReconciled).not.toHaveBeenCalled();
      });

      it('starts no further tenant once aborted between two tenants', async () => {
        const ctrl = new AbortController();
        mockListTenants.mockResolvedValueOnce([
          { tenant_id: 'oa-tenant-1', tenant_name: 'Tenant A' },
          { tenant_id: 'oa-tenant-2', tenant_name: 'Tenant B' },
        ]);
        mockRetireCveEvidence.mockImplementation(() => {
          ctrl.abort();
          return Promise.resolve();
        });

        await openaevSyncHandler(makeCtx({ signal: ctrl.signal, state: inventoryDoneState() }));

        expect(mockSyncObservationStreams).toHaveBeenCalledOnce();
        expect(mockRetireAttackEvidence).toHaveBeenCalledOnce();
      });

      it('lets a failure of the phase fail the run, and retires nothing on its account', async () => {
        mockSyncObservationStreams.mockRejectedValueOnce(new Error('OpenAEV snapshot route not found'));

        await expect(openaevSyncHandler(makeCtx())).rejects.toThrow('OpenAEV snapshot route not found');

        expect(mockRetireAttackEvidence).not.toHaveBeenCalled();
        expect(mockRetireCveEvidence).not.toHaveBeenCalled();
      });
    });
  });
});
