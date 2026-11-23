import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobContext, ProgressUpdate } from '@app/module';
import type { OpenaevSyncPayload, OpenaevSyncState } from '../openaev-types';
import type { LegacySyncDeps } from './openaev-legacy-sync';
import { DESCRIPTION_FETCH_BUDGET } from '../openaev-description-phase';
import { OpenaevNotFoundError } from '../openaev-api-client';
import { runLegacySync } from './openaev-legacy-sync';

vi.mock('../../../utils/logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    logFromError: vi.fn(),
    logTrace: vi.fn(),
    logWarn: vi.fn(),
    logError: vi.fn(),
    logTraceFromError: vi.fn(),
    logFatalError: vi.fn(),
    logFromFatalError: vi.fn(),
    enrich: vi.fn(),
  }),
}));

vi.mock('../../../utils', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sleep: vi.fn().mockResolvedValue(undefined),
}));

const DAY_MS = 86_400_000;
const CONNECTOR_ID = 'connector-id-abc';

const mocks = {
  forgetSnapshotState: vi.fn(),
  getIntegrationSettings: vi.fn(),
  markSynced: vi.fn(),
  getInventoryAssetIdMap: vi.fn(),
  bulkUpsertEvidence: vi.fn(),
  markAssetsEnumerated: vi.fn(),
  recomputeEvidenceStateForAssets: vi.fn(),
  findCveScopePairsSince: vi.fn(),
  markScopesEnumerated: vi.fn(),
  upsertCves: vi.fn(),
  getCveIdMap: vi.fn(),
  getTechniqueIdsByExternalIds: vi.fn(),
  searchExercises: vi.fn(),
  getExercise: vi.fn(),
  getScenario: vi.fn(),
  getExerciseExpectations: vi.fn(),
  getInject: vi.fn(),
  searchFindings: vi.fn(),
  buildTenantInventory: vi.fn(),
  syncTenantDescriptions: vi.fn(),
  updateProgress: vi.fn(),
  saveStateSnapshot: vi.fn(),
};

const makeCtx = (overrides: Partial<JobContext<OpenaevSyncPayload, OpenaevSyncState>> = {}): JobContext<OpenaevSyncPayload, OpenaevSyncState> => ({
  jobId: 'job-1',
  tenantId: 'tenant-abc',
  kind: 'openaev-findings-sync',
  interactive: true,
  payload: { serviceAccountId: 'service-account-1' },
  attempt: 1,
  state: null,
  signal: new AbortController().signal,
  updateProgress: mocks.updateProgress,
  saveStateSnapshot: mocks.saveStateSnapshot,
  ...overrides,
});

const TENANT_1 = { tenant_id: 'oa-tenant-1', tenant_name: 'Tenant A' };
const TENANT_2 = { tenant_id: 'oa-tenant-2', tenant_name: 'Tenant B' };

const makeDeps = (overrides: Partial<LegacySyncDeps> = {}): LegacySyncDeps => ({
  ctx: makeCtx(),
  svc: {
    openaevConnector: { forgetSnapshotState: mocks.forgetSnapshotState },
    integrationSettings: { getIntegrationSettings: mocks.getIntegrationSettings, markSynced: mocks.markSynced },
    supportingAssets: {
      getInventoryAssetIdMap: mocks.getInventoryAssetIdMap,
      bulkUpsertEvidence: mocks.bulkUpsertEvidence,
      markAssetsEnumerated: mocks.markAssetsEnumerated,
      recomputeEvidenceStateForAssets: mocks.recomputeEvidenceStateForAssets,
      findCveScopePairsSince: mocks.findCveScopePairsSince,
      markScopesEnumerated: mocks.markScopesEnumerated,
    },
    mitreAttack: { getTechniqueIdsByExternalIds: mocks.getTechniqueIdsByExternalIds },
  },
  inCveFindingsTransaction: (work) => work({
    cve: { upsertCves: mocks.upsertCves, getCveIdMap: mocks.getCveIdMap },
    supportingAssets: { bulkUpsertEvidence: mocks.bulkUpsertEvidence },
  }),
  connectorId: CONNECTOR_ID,
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- only the calls the legacy run makes are provided
  client: {
    searchExercises: mocks.searchExercises,
    getExercise: mocks.getExercise,
    getScenario: mocks.getScenario,
    getExerciseExpectations: mocks.getExerciseExpectations,
    getInject: mocks.getInject,
    searchFindings: mocks.searchFindings,
  } as unknown as LegacySyncDeps['client'],
  openaevTenants: [TENANT_1],
  buildTenantInventory: mocks.buildTenantInventory,
  syncTenantDescriptions: mocks.syncTenantDescriptions,
  ...overrides,
});

const makeExpectation = (overrides: Record<string, unknown> = {}) => ({
  inject_expectation_id: 'exp-1',
  inject_expectation_type: 'DETECTION',
  inject_expectation_inject: 'inject-1',
  inject_expectation_asset: 'asset-openaev-1',
  inject_expectation_status: 'FAILED',
  inject_expectation_score: 0,
  inject_expectation_expected_score: 100,
  inject_expectation_results: [{ sourcePlatform: 'SIEM', score: 0 }],
  ...overrides,
});

const injectWith = (...externalIds: Array<string>) => ({
  inject_id: 'inject-1',
  inject_attack_patterns: externalIds.map((externalId) => ({ attack_pattern_id: `ap-${externalId}`, attack_pattern_external_id: externalId })),
});

const cveFinding = (overrides: Record<string, unknown> = {}) => ({
  finding_id: 'finding-1',
  finding_type: 'cve',
  finding_value: 'CVE-2024-1234',
  finding_assets: [{ asset_id: 'asset-openaev-1' }],
  ...overrides,
});

const page = <T>(content: Array<T>) => ({ content, last: true, totalElements: content.length, number: 0, size: 100 });

/** A resumed-job state that already carries a complete inventory and CVE findings phase, so a test focused on the exercises exercises neither. */
const inventoryDoneState = (overrides: Partial<OpenaevSyncState> = {}): OpenaevSyncState => ({
  exerciseEntries: [],
  currentExerciseIndex: 0,
  syncStartedAt: new Date().toISOString(),
  inventoryComplete: true,
  cveFindingsComplete: true,
  ...overrides,
});

const snapshotsSaved = () => mocks.saveStateSnapshot.mock.calls
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- vi mock.calls is unknown[][]; cast needed to read the typed argument
  .map(([snapshot]) => snapshot as OpenaevSyncState);

const evidenceWritten = () => mocks.bulkUpsertEvidence.mock.calls.flat(2);

describe('runLegacySync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.forgetSnapshotState.mockResolvedValue(undefined);
    mocks.getIntegrationSettings.mockResolvedValue({ lastReportedAt: null });
    mocks.markSynced.mockResolvedValue(undefined);
    mocks.getInventoryAssetIdMap.mockResolvedValue(new Map([['asset-openaev-1', 'sa-uuid-1']]));
    mocks.bulkUpsertEvidence.mockResolvedValue(undefined);
    mocks.markAssetsEnumerated.mockResolvedValue(undefined);
    mocks.recomputeEvidenceStateForAssets.mockResolvedValue(0);
    mocks.findCveScopePairsSince.mockResolvedValue([]);
    mocks.upsertCves.mockResolvedValue(undefined);
    mocks.getCveIdMap.mockResolvedValue(new Map([['CVE-2024-1234', 'cve-uuid-1']]));
    mocks.getTechniqueIdsByExternalIds.mockResolvedValue(new Map([['T1110.001', 'tech-uuid-1']]));
    mocks.searchExercises.mockResolvedValue(page([{ exercise_id: 'ex-1', exercise_status: 'FINISHED' }]));
    mocks.getExercise.mockResolvedValue({ exercise_id: 'ex-1', exercise_scenario: 'scenario-1' });
    mocks.getScenario.mockResolvedValue({ scenario_id: 'scenario-1', scenario_name: 'Credential Harvesting' });
    mocks.getExerciseExpectations.mockResolvedValue([]);
    mocks.getInject.mockResolvedValue({ inject_id: 'inject-1', inject_attack_patterns: [] });
    mocks.searchFindings.mockResolvedValue(page([]));
    mocks.buildTenantInventory.mockResolvedValue(new Map([['asset-openaev-1', 'sa-uuid-1']]));
    mocks.syncTenantDescriptions.mockResolvedValue({ calls: 0 });
    mocks.updateProgress.mockResolvedValue(undefined);
    mocks.saveStateSnapshot.mockResolvedValue(undefined);
  });

  describe('what it forgets', () => {
    it('forgets the snapshot state of the connector before it reads anything', async () => {
      const order: Array<string> = [];
      mocks.forgetSnapshotState.mockImplementation(() => {
        order.push('forget');
        return Promise.resolve();
      });
      mocks.buildTenantInventory.mockImplementation(() => {
        order.push('inventory');
        return Promise.resolve(new Map());
      });

      await runLegacySync(makeDeps());

      expect(mocks.forgetSnapshotState).toHaveBeenCalledExactlyOnceWith(CONNECTOR_ID);
      expect(order).toEqual(['forget', 'inventory']);
    });

    it('says which mode it runs in, as its first progress message', async () => {
      await runLegacySync(makeDeps());

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- vi mock.calls is unknown[][]; cast needed to read the typed argument
      const [first] = mocks.updateProgress.mock.calls[0] as [ProgressUpdate];
      expect(first.message).toContain('snapshot export is off');
    });
  });

  describe('inventory', () => {
    it('builds the inventory of every OpenAEV tenant, before the findings and the exercises are read', async () => {
      const order: Array<string> = [];
      mocks.buildTenantInventory.mockImplementation((openaevTenantId: string) => {
        order.push(`inventory:${openaevTenantId}`);
        return Promise.resolve(new Map());
      });
      mocks.searchFindings.mockImplementation(() => {
        order.push('findings');
        return Promise.resolve(page([]));
      });
      mocks.searchExercises.mockImplementation(() => {
        order.push('exercises');
        return Promise.resolve(page([]));
      });

      await runLegacySync(makeDeps({ openaevTenants: [TENANT_1, TENANT_2] }));

      expect(order).toEqual(['inventory:oa-tenant-1', 'inventory:oa-tenant-2', 'findings', 'findings', 'exercises', 'exercises']);
    });

    it('resolves a tenant\'s findings and expectations against the map its own inventory built', async () => {
      mocks.buildTenantInventory.mockImplementation((openaevTenantId: string) =>
        Promise.resolve(openaevTenantId === 'oa-tenant-1' ? new Map([['asset-openaev-1', 'sa-of-tenant-1']]) : new Map([['asset-openaev-1', 'sa-of-tenant-2']])));
      mocks.searchFindings.mockImplementation((openaevTenantId: string) =>
        Promise.resolve(page(openaevTenantId === 'oa-tenant-2' ? [cveFinding()] : [])));

      await runLegacySync(makeDeps({ openaevTenants: [TENANT_1, TENANT_2] }));

      expect(evidenceWritten()).toEqual([expect.objectContaining({ supportingAssetId: 'sa-of-tenant-2' })]);
    });

    it('rebuilds the map from what is on file, without running the inventory, on a resumed job that completed it', async () => {
      mocks.getExerciseExpectations.mockResolvedValueOnce([makeExpectation()]);
      mocks.getInject.mockResolvedValueOnce(injectWith('T1110.001'));

      await runLegacySync(makeDeps({ ctx: makeCtx({ state: inventoryDoneState() }) }));

      expect(mocks.buildTenantInventory).not.toHaveBeenCalled();
      expect(mocks.getInventoryAssetIdMap).toHaveBeenCalledWith(CONNECTOR_ID);
      expect(evidenceWritten()).toEqual([expect.objectContaining({ supportingAssetId: 'sa-uuid-1' })]);
    });

    it('stops before the findings when the inventory was cut short by an abort', async () => {
      const controller = new AbortController();
      mocks.buildTenantInventory.mockImplementation(() => {
        controller.abort();
        return Promise.resolve(new Map());
      });

      await runLegacySync(makeDeps({ ctx: makeCtx({ signal: controller.signal }) }));

      expect(mocks.searchFindings).not.toHaveBeenCalled();
      expect(mocks.saveStateSnapshot).not.toHaveBeenCalled();
      expect(mocks.markSynced).not.toHaveBeenCalled();
    });

    it('checkpoints the inventory and the findings phase before the exercises are listed, so a crash between them repeats neither', async () => {
      const order: Array<string> = [];
      mocks.saveStateSnapshot.mockImplementation(() => {
        order.push('checkpoint');
        return Promise.resolve();
      });
      mocks.searchExercises.mockImplementation(() => {
        order.push('exercises');
        return Promise.resolve(page([]));
      });

      await runLegacySync(makeDeps());

      expect(order).toEqual(['checkpoint', 'exercises']);
      expect(snapshotsSaved()[0]).toMatchObject({ inventoryComplete: true, cveFindingsComplete: true, exerciseEntries: [], currentExerciseIndex: 0 });
    });
  });

  describe('exercise window', () => {
    it('reads the exercises changed since the last completed run', async () => {
      mocks.getIntegrationSettings.mockResolvedValue({ lastReportedAt: new Date(Date.now() - 2 * DAY_MS) });
      mocks.searchExercises.mockResolvedValue(page([
        { exercise_id: 'ex-new', exercise_status: 'FINISHED', exercise_updated_at: new Date(Date.now() - DAY_MS).toISOString() },
        { exercise_id: 'ex-old', exercise_status: 'FINISHED', exercise_updated_at: new Date(Date.now() - 3 * DAY_MS).toISOString() },
      ]));

      await runLegacySync(makeDeps());

      expect(mocks.getExercise.mock.calls.map(([, exerciseId]) => exerciseId)).toEqual(['ex-new']);
    });

    it('never reads back further than seven days, however long ago the last run completed', async () => {
      mocks.getIntegrationSettings.mockResolvedValue({ lastReportedAt: new Date(Date.now() - 30 * DAY_MS) });
      mocks.searchExercises.mockResolvedValue(page([
        { exercise_id: 'ex-recent', exercise_status: 'FINISHED', exercise_updated_at: new Date(Date.now() - 6 * DAY_MS).toISOString() },
        { exercise_id: 'ex-too-old', exercise_status: 'FINISHED', exercise_updated_at: new Date(Date.now() - 8 * DAY_MS).toISOString() },
      ]));

      await runLegacySync(makeDeps());

      expect(mocks.getExercise.mock.calls.map(([, exerciseId]) => exerciseId)).toEqual(['ex-recent']);
    });

    it('reads the last seven days when no run ever completed', async () => {
      mocks.getIntegrationSettings.mockResolvedValue({ lastReportedAt: null });
      mocks.searchExercises.mockResolvedValue(page([
        { exercise_id: 'ex-recent', exercise_status: 'FINISHED', exercise_updated_at: new Date(Date.now() - 6 * DAY_MS).toISOString() },
        { exercise_id: 'ex-too-old', exercise_status: 'FINISHED', exercise_updated_at: new Date(Date.now() - 8 * DAY_MS).toISOString() },
      ]));

      await runLegacySync(makeDeps());

      expect(mocks.getExercise.mock.calls.map(([, exerciseId]) => exerciseId)).toEqual(['ex-recent']);
    });

    it('includes an exercise whose exercise_updated_at is missing', async () => {
      mocks.getIntegrationSettings.mockResolvedValue({ lastReportedAt: new Date(Date.now() - 2 * DAY_MS) });
      mocks.searchExercises.mockResolvedValue(page([{ exercise_id: 'ex-no-date', exercise_status: 'FINISHED' }]));

      await runLegacySync(makeDeps());

      expect(mocks.getExercise).toHaveBeenCalledWith('oa-tenant-1', 'ex-no-date');
    });

    it('lists the exercises of every OpenAEV tenant', async () => {
      await runLegacySync(makeDeps({ openaevTenants: [TENANT_1, TENANT_2] }));

      expect(mocks.searchExercises).toHaveBeenCalledWith('oa-tenant-1', 0);
      expect(mocks.searchExercises).toHaveBeenCalledWith('oa-tenant-2', 0);
    });

    it('processes the exercises oldest first even though they arrive newest first', async () => {
      mocks.searchExercises.mockResolvedValue(page([
        { exercise_id: 'ex-newest', exercise_status: 'FINISHED', exercise_updated_at: new Date(Date.now() - 1 * DAY_MS).toISOString() },
        { exercise_id: 'ex-middle', exercise_status: 'FINISHED', exercise_updated_at: new Date(Date.now() - 2 * DAY_MS).toISOString() },
        { exercise_id: 'ex-oldest', exercise_status: 'FINISHED', exercise_updated_at: new Date(Date.now() - 3 * DAY_MS).toISOString() },
      ]));

      await runLegacySync(makeDeps());

      expect(mocks.getExerciseExpectations.mock.calls.map(([, exerciseId]) => exerciseId)).toEqual(['ex-oldest', 'ex-middle', 'ex-newest']);
    });

    it('restores the exercises from the checkpoint and reads each from the tenant it came from', async () => {
      const state = inventoryDoneState({
        exerciseEntries: [{ exerciseId: 'ex-tenant2', openaevTenantId: 'oa-tenant-2', exerciseUpdatedAt: null, exerciseName: null }],
      });

      await runLegacySync(makeDeps({ ctx: makeCtx({ state }), openaevTenants: [TENANT_1, TENANT_2] }));

      expect(mocks.searchExercises).not.toHaveBeenCalled();
      expect(mocks.getExerciseExpectations).toHaveBeenCalledExactlyOnceWith('oa-tenant-2', 'ex-tenant2');
    });

    it('resumes after the exercises the checkpoint says are done', async () => {
      const state = inventoryDoneState({
        exerciseEntries: [
          { exerciseId: 'ex-done', openaevTenantId: 'oa-tenant-1', exerciseUpdatedAt: null, exerciseName: null },
          { exerciseId: 'ex-todo', openaevTenantId: 'oa-tenant-1', exerciseUpdatedAt: null, exerciseName: null },
        ],
        currentExerciseIndex: 1,
      });

      await runLegacySync(makeDeps({ ctx: makeCtx({ state }) }));

      expect(mocks.getExerciseExpectations).toHaveBeenCalledExactlyOnceWith('oa-tenant-1', 'ex-todo');
    });

    it('checkpoints after the inventory and after each exercise, and counts them', async () => {
      mocks.searchExercises.mockResolvedValueOnce(page([{ exercise_id: 'ex-1' }, { exercise_id: 'ex-2' }]));

      await runLegacySync(makeDeps());

      expect(mocks.saveStateSnapshot).toHaveBeenCalledTimes(3);
      expect(snapshotsSaved().map((snapshot) => snapshot.currentExerciseIndex)).toEqual([0, 1, 2]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- vi mock.calls is unknown[][]; cast needed to read the typed argument
      const counted = (mocks.updateProgress.mock.calls as Array<[ProgressUpdate]>)
        .map(([progress]) => progress)
        .filter((progress) => progress.processedTotal !== undefined);
      expect(counted).toEqual([
        { processedTotal: 0, expectedTotal: 2 },
        { processedTotal: 1, expectedTotal: 2 },
        { processedTotal: 2, expectedTotal: 2 },
      ]);
    });

    it('skips an exercise OpenAEV no longer knows (404) instead of failing the run', async () => {
      const state = inventoryDoneState({
        exerciseEntries: [
          { exerciseId: 'ex-missing', openaevTenantId: 'oa-tenant-1', exerciseUpdatedAt: null, exerciseName: null },
          { exerciseId: 'ex-ok', openaevTenantId: 'oa-tenant-1', exerciseUpdatedAt: null, exerciseName: null },
        ],
      });
      mocks.getExerciseExpectations
        .mockRejectedValueOnce(new OpenaevNotFoundError('OpenAEV resource not found (404): exercise deleted'))
        .mockResolvedValueOnce([]);

      await expect(runLegacySync(makeDeps({ ctx: makeCtx({ state }) }))).resolves.toBeUndefined();

      expect(mocks.getExerciseExpectations.mock.calls.map(([, exerciseId]) => exerciseId)).toEqual(['ex-missing', 'ex-ok']);
      expect(mocks.saveStateSnapshot).toHaveBeenCalledTimes(2);
      expect(mocks.markSynced).toHaveBeenCalled();
    });

    it('continues without the scenario name when the scenario is gone', async () => {
      mocks.getScenario.mockRejectedValueOnce(new OpenaevNotFoundError('OpenAEV resource not found (404): scenario deleted'));
      mocks.getExerciseExpectations.mockResolvedValueOnce([makeExpectation()]);
      mocks.getInject.mockResolvedValueOnce(injectWith('T1110.001'));

      await runLegacySync(makeDeps());

      expect(evidenceWritten()).toEqual([expect.objectContaining({ sourceScenarioId: 'scenario-1', sourceScenarioName: null })]);
    });

    it('lets any other error fail the run, and records no completion', async () => {
      const state = inventoryDoneState({
        exerciseEntries: [{ exerciseId: 'ex-1', openaevTenantId: 'oa-tenant-1', exerciseUpdatedAt: null, exerciseName: null }],
      });
      mocks.getExerciseExpectations.mockRejectedValueOnce(new Error('boom'));

      await expect(runLegacySync(makeDeps({ ctx: makeCtx({ state }) }))).rejects.toThrow('boom');

      expect(mocks.markSynced).not.toHaveBeenCalled();
    });

    it('keys the scenario to the exercise itself when it belongs to none', async () => {
      mocks.getExercise.mockResolvedValueOnce({ exercise_id: 'ex-1', exercise_scenario: null });
      mocks.getExerciseExpectations.mockResolvedValueOnce([makeExpectation()]);
      mocks.getInject.mockResolvedValueOnce(injectWith('T1110.001'));

      await runLegacySync(makeDeps());

      expect(mocks.getScenario).not.toHaveBeenCalled();
      expect(evidenceWritten()).toEqual([expect.objectContaining({ sourceScenarioId: 'ex-1', scope: 'ex-1' })]);
    });
  });

  describe('attack evidence', () => {
    it('skips an expectation without an asset', async () => {
      mocks.getExerciseExpectations.mockResolvedValueOnce([makeExpectation({ inject_expectation_asset: null })]);

      await runLegacySync(makeDeps());

      expect(mocks.bulkUpsertEvidence).not.toHaveBeenCalled();
    });

    it('skips an inject without attack patterns', async () => {
      mocks.getExerciseExpectations.mockResolvedValueOnce([makeExpectation()]);

      await runLegacySync(makeDeps());

      expect(mocks.bulkUpsertEvidence).not.toHaveBeenCalled();
    });

    it('skips an expectation whose asset the inventory never resolved, rather than creating it on the spot', async () => {
      mocks.buildTenantInventory.mockResolvedValue(new Map());
      mocks.getExerciseExpectations.mockResolvedValueOnce([makeExpectation()]);
      mocks.getInject.mockResolvedValueOnce(injectWith('T1110.001'));

      await runLegacySync(makeDeps());

      expect(mocks.bulkUpsertEvidence).not.toHaveBeenCalled();
      expect(mocks.markAssetsEnumerated).not.toHaveBeenCalled();
    });

    it('writes evidence for a valid expectation on a known technique, keyed on the scenario', async () => {
      mocks.getExerciseExpectations.mockResolvedValueOnce([makeExpectation({ inject_expectation_results: [{ sourcePlatform: 'SIEM', score: 0 }] })]);
      mocks.getInject.mockResolvedValueOnce({ ...injectWith('T1110.001'), inject_title: 'Brute force' });

      await runLegacySync(makeDeps());

      expect(mocks.bulkUpsertEvidence).toHaveBeenCalledOnce();
      expect(evidenceWritten()).toEqual([expect.objectContaining({
        supportingAssetId: 'sa-uuid-1',
        mitreTechniqueId: 'tech-uuid-1',
        cveId: null,
        expectationType: 'detection',
        isExposed: true,
        securityPlatformType: 'SIEM',
        sourceScenarioId: 'scenario-1',
        sourceScenarioName: 'Credential Harvesting',
        sourceSimulationId: 'ex-1',
        sourceInjectId: 'inject-1',
        sourceFindingId: 'scenario-scenario-1',
        scope: 'scenario-1',
        reason: 'Not detected by SIEM in simulation ex-1 (inject: Brute force)',
      })]);
    });

    it('takes the best score of a platform type, and gives each family its own verdict', async () => {
      mocks.getExerciseExpectations.mockResolvedValueOnce([makeExpectation({
        inject_expectation_status: 'SUCCESS',
        inject_expectation_results: [
          { sourcePlatform: 'EDR', score: 100 },
          { sourcePlatform: 'SIEM', score: 0 },
          { sourcePlatform: 'SIEM', score: 0 },
        ],
      })]);
      mocks.getInject.mockResolvedValueOnce(injectWith('T1110.001'));

      await runLegacySync(makeDeps());

      const rows = evidenceWritten();
      expect(rows).toHaveLength(2);
      expect(rows.find((row) => row.securityPlatformType === 'EDR')).toMatchObject({ isExposed: false });
      expect(rows.find((row) => row.securityPlatformType === 'SIEM')).toMatchObject({ isExposed: true });
    });

    it('reads each inject once, however many expectations name it', async () => {
      mocks.getExerciseExpectations.mockResolvedValueOnce([
        makeExpectation({ inject_expectation_id: 'exp-1' }),
        makeExpectation({ inject_expectation_id: 'exp-2', inject_expectation_type: 'PREVENTION' }),
      ]);
      mocks.getInject.mockResolvedValue(injectWith('T1110.001'));

      await runLegacySync(makeDeps());

      expect(mocks.getInject).toHaveBeenCalledOnce();
      expect(evidenceWritten()).toHaveLength(2);
    });

    it('marks the assets it visited as enumerated under the scenario, then recomputes their evidence', async () => {
      mocks.getExerciseExpectations.mockResolvedValueOnce([makeExpectation()]);
      mocks.getInject.mockResolvedValueOnce(injectWith('T1110.001'));

      await runLegacySync(makeDeps());

      expect(mocks.markAssetsEnumerated).toHaveBeenCalledWith({
        connectorId: CONNECTOR_ID,
        supportingAssetIds: ['sa-uuid-1'],
        scope: 'scenario-1',
        enumeratedAt: expect.any(Date),
      });
      expect(mocks.recomputeEvidenceStateForAssets).toHaveBeenCalledWith({
        supportingAssetIds: ['sa-uuid-1'],
        reason: 'No longer reported by OpenAEV',
      });
    });

    it('takes the enumeration instant before the exercise\'s evidence is written, so that evidence compares fresher than the mark', async () => {
      mocks.getExerciseExpectations.mockResolvedValueOnce([makeExpectation()]);
      mocks.getInject.mockResolvedValueOnce(injectWith('T1110.001'));
      let evidenceWrittenAt = 0;
      mocks.bulkUpsertEvidence.mockImplementation(() => {
        evidenceWrittenAt = Date.now();
        return Promise.resolve();
      });

      await runLegacySync(makeDeps());

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- vi mock.calls is unknown[][]; cast needed to read the typed argument
      const [{ enumeratedAt }] = mocks.markAssetsEnumerated.mock.calls[0] as [{ enumeratedAt: Date }];
      expect(enumeratedAt.getTime()).toBeLessThanOrEqual(evidenceWrittenAt);
    });
  });

  describe('CVE evidence', () => {
    it('writes CVE evidence from a CVE finding, keyed and scoped by the OpenAEV asset and without the scenario', async () => {
      mocks.searchFindings.mockResolvedValueOnce(page([cveFinding({
        finding_inject: { inject_id: 'inject-1' },
        finding_simulation: { exercise_id: 'ex-1', exercise_name: 'Exercise 1' },
      })]));

      await runLegacySync(makeDeps());

      expect(mocks.upsertCves).toHaveBeenCalledWith([{ cveId: 'CVE-2024-1234' }]);
      expect(evidenceWritten()).toEqual([expect.objectContaining({
        cveId: 'cve-uuid-1',
        mitreTechniqueId: null,
        expectationType: null,
        isExposed: true,
        securityPlatformType: null,
        sourceScenarioId: null,
        sourceScenarioName: null,
        scope: 'asset-openaev-1',
        sourceSimulationId: 'ex-1',
        sourceFindingId: 'asset-openaev-1:CVE-2024-1234',
        externalReference: 'finding-1',
      })]);
    });

    it('ingests a CVE from an atomic test, with no simulation in the evidence or the reason', async () => {
      mocks.searchFindings.mockResolvedValueOnce(page([cveFinding({ finding_inject: { inject_id: 'inject-atomic-1' } })]));

      await runLegacySync(makeDeps());

      expect(evidenceWritten()).toEqual([expect.objectContaining({ sourceSimulationId: null, sourceInjectId: 'inject-atomic-1', reason: 'Reported by OpenAEV' })]);
    });

    it('ingests a vulnerability finding whose name names a CVE, and ignores one whose name does not', async () => {
      mocks.getCveIdMap.mockResolvedValueOnce(new Map([['CVE-2024-7777', 'cve-uuid-7777']]));
      mocks.searchFindings.mockResolvedValueOnce(page([
        cveFinding({ finding_id: 'finding-vuln-cve', finding_type: 'vulnerability', finding_value: 'Missing patch CVE-2024-7777 [vulnerable]' }),
        cveFinding({ finding_id: 'finding-vuln-nocve', finding_type: 'vulnerability', finding_value: 'EternalBlue [vulnerable]' }),
      ]));

      await runLegacySync(makeDeps());

      expect(mocks.upsertCves).toHaveBeenCalledWith([{ cveId: 'CVE-2024-7777' }]);
      expect(evidenceWritten()).toEqual([expect.objectContaining({ cveId: 'cve-uuid-7777', supportingAssetId: 'sa-uuid-1' })]);
    });

    it('ignores a CVE finding on an asset absent from the inventory, rather than creating it on the spot', async () => {
      mocks.searchFindings.mockResolvedValueOnce(page([cveFinding({ finding_assets: [{ asset_id: 'asset-unknown-to-inventory' }] })]));

      await runLegacySync(makeDeps());

      expect(mocks.bulkUpsertEvidence).not.toHaveBeenCalled();
    });

    it('ignores a finding older than the window', async () => {
      mocks.searchFindings.mockResolvedValueOnce(page([cveFinding({ finding_updated_at: new Date(Date.now() - 8 * DAY_MS).toISOString() })]));

      await runLegacySync(makeDeps());

      expect(mocks.bulkUpsertEvidence).not.toHaveBeenCalled();
    });

    it('reads the findings once per OpenAEV tenant, not once per exercise', async () => {
      mocks.searchExercises.mockResolvedValueOnce(page([{ exercise_id: 'ex-1' }, { exercise_id: 'ex-2' }]));

      await runLegacySync(makeDeps({ openaevTenants: [TENANT_1, TENANT_2] }));

      expect(mocks.searchFindings.mock.calls.map(([openaevTenantId]) => openaevTenantId)).toEqual(['oa-tenant-1', 'oa-tenant-2']);
    });

    it('ingests the findings of a run with no exercise at all', async () => {
      mocks.searchExercises.mockResolvedValueOnce(page([]));
      mocks.searchFindings.mockResolvedValueOnce(page([cveFinding()]));

      await runLegacySync(makeDeps());

      expect(mocks.getExerciseExpectations).not.toHaveBeenCalled();
      expect(evidenceWritten()).toEqual([expect.objectContaining({ cveId: 'cve-uuid-1' })]);
    });

    it('hands both rows of an (asset, CVE) pair seen twice to one write, without choosing between them', async () => {
      mocks.searchFindings.mockResolvedValueOnce(page([
        cveFinding({ finding_id: 'finding-newer', finding_updated_at: new Date(Date.now() - 1 * DAY_MS).toISOString() }),
        cveFinding({ finding_id: 'finding-older', finding_updated_at: new Date(Date.now() - 2 * DAY_MS).toISOString() }),
      ]));

      await runLegacySync(makeDeps());

      expect(mocks.bulkUpsertEvidence).toHaveBeenCalledOnce();
      expect(mocks.bulkUpsertEvidence.mock.calls[0][0].map((row: { externalReference: string }) => row.externalReference)).toEqual(['finding-newer', 'finding-older']);
    });

    it('skips the findings phase on a resumed job that already completed it', async () => {
      await runLegacySync(makeDeps({ ctx: makeCtx({ state: inventoryDoneState() }) }));

      expect(mocks.searchFindings).not.toHaveBeenCalled();
      expect(mocks.markSynced).toHaveBeenCalledWith('openaev', expect.any(Date));
    });

    it('runs the findings phase on a checkpoint that carries no flag for it, and records it', async () => {
      const state = inventoryDoneState();
      delete state.cveFindingsComplete;

      await runLegacySync(makeDeps({ ctx: makeCtx({ state }) }));

      expect(mocks.searchFindings).toHaveBeenCalledWith('oa-tenant-1', 0);
      expect(snapshotsSaved().some((snapshot) => snapshot.cveFindingsComplete === true)).toBe(true);
    });

    it('does not fail the run when the findings call is refused, and holds the completion back with the phase unmarked', async () => {
      mocks.searchFindings.mockRejectedValueOnce(new Error('OpenAEV auth error (403): missing ACCESS_FINDINGS'));

      await expect(runLegacySync(makeDeps())).resolves.toBeUndefined();

      expect(mocks.bulkUpsertEvidence).not.toHaveBeenCalled();
      expect(mocks.getExerciseExpectations).toHaveBeenCalledWith('oa-tenant-1', 'ex-1');
      expect(mocks.markSynced).not.toHaveBeenCalled();
      expect(snapshotsSaved()).not.toHaveLength(0);
      expect(snapshotsSaved().every((snapshot) => snapshot.cveFindingsComplete === false)).toBe(true);
    });

    it('still syncs the tenants whose findings call succeeded when another tenant\'s is refused', async () => {
      mocks.searchFindings
        .mockRejectedValueOnce(new Error('OpenAEV auth error (403): missing ACCESS_FINDINGS'))
        .mockResolvedValueOnce(page([cveFinding()]));

      await runLegacySync(makeDeps({ openaevTenants: [TENANT_1, TENANT_2] }));

      expect(mocks.searchFindings).toHaveBeenCalledWith('oa-tenant-2', 0);
      expect(evidenceWritten()).toEqual([expect.objectContaining({ cveId: 'cve-uuid-1' })]);
      expect(mocks.markSynced).not.toHaveBeenCalled();
    });

    it('does not checkpoint the findings phase as complete when the run is aborted while it is going', async () => {
      const controller = new AbortController();
      mocks.searchFindings.mockImplementationOnce(() => {
        controller.abort();
        return Promise.resolve(page([]));
      });

      await runLegacySync(makeDeps({ ctx: makeCtx({ signal: controller.signal }) }));

      expect(snapshotsSaved().some((snapshot) => snapshot.cveFindingsComplete === true)).toBe(false);
    });

    it('enumerates the CVE coverage once for the whole run, under the scope of each OpenAEV asset that reported one, from what was written since the run started', async () => {
      const pairs = [{ supportingAssetId: 'sa-uuid-1', scope: 'asset-a' }, { supportingAssetId: 'sa-uuid-1', scope: 'asset-b' }];
      mocks.findCveScopePairsSince.mockResolvedValueOnce(pairs);
      mocks.searchExercises.mockResolvedValueOnce(page([{ exercise_id: 'ex-1' }, { exercise_id: 'ex-2' }]));

      await runLegacySync(makeDeps());

      expect(mocks.findCveScopePairsSince).toHaveBeenCalledOnce();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- vi mock.calls is unknown[][]; cast needed to read the typed argument
      const [connectorId, since] = mocks.findCveScopePairsSince.mock.calls[0] as [string, Date];
      expect(connectorId).toBe(CONNECTOR_ID);
      expect(mocks.markScopesEnumerated).toHaveBeenCalledExactlyOnceWith({ connectorId: CONNECTOR_ID, pairs, enumeratedAt: since });
      expect(mocks.recomputeEvidenceStateForAssets).toHaveBeenCalledWith({
        supportingAssetIds: ['sa-uuid-1'],
        reason: 'No longer reported by OpenAEV',
      });
    });

    it('enumerates from the instant the checkpoint records when the run is a resumed one', async () => {
      const startedAt = new Date(Date.now() - 3_600_000);
      mocks.findCveScopePairsSince.mockResolvedValueOnce([{ supportingAssetId: 'sa-uuid-1', scope: 'asset-a' }]);

      await runLegacySync(makeDeps({ ctx: makeCtx({ state: inventoryDoneState({ syncStartedAt: startedAt.toISOString() }) }) }));

      expect(mocks.findCveScopePairsSince).toHaveBeenCalledWith(CONNECTOR_ID, startedAt);
      expect(mocks.markSynced).toHaveBeenCalledWith('openaev', startedAt);
    });

    it('marks no CVE enumeration when no asset reported a CVE', async () => {
      mocks.getExerciseExpectations.mockResolvedValueOnce([makeExpectation()]);
      mocks.getInject.mockResolvedValueOnce(injectWith('T1110.001'));

      await runLegacySync(makeDeps());

      expect(mocks.markScopesEnumerated).not.toHaveBeenCalled();
    });
  });

  describe('completion', () => {
    it('records the instant the run started as the last completed run', async () => {
      await runLegacySync(makeDeps());

      expect(mocks.markSynced).toHaveBeenCalledExactlyOnceWith('openaev', expect.any(Date));
    });

    it('records nothing when the run is aborted', async () => {
      const controller = new AbortController();
      mocks.getExerciseExpectations.mockImplementation(() => {
        controller.abort();
        return Promise.resolve([]);
      });

      await runLegacySync(makeDeps({ ctx: makeCtx({ signal: controller.signal }) }));

      expect(mocks.markSynced).not.toHaveBeenCalled();
      expect(mocks.syncTenantDescriptions).not.toHaveBeenCalled();
    });
  });

  describe('descriptions', () => {
    it('runs for each OpenAEV tenant, after the completion is recorded', async () => {
      const order: Array<string> = [];
      mocks.markSynced.mockImplementation(() => {
        order.push('markSynced');
        return Promise.resolve();
      });
      mocks.syncTenantDescriptions.mockImplementation((openaevTenantId: string) => {
        order.push(`descriptions:${openaevTenantId}`);
        return Promise.resolve({ calls: 0 });
      });

      await runLegacySync(makeDeps({ openaevTenants: [TENANT_1, TENANT_2] }));

      expect(order).toEqual(['markSynced', 'descriptions:oa-tenant-1', 'descriptions:oa-tenant-2']);
    });

    it('gives each OpenAEV tenant an even share of what the run has left, carrying what one leaves unspent to the next', async () => {
      mocks.syncTenantDescriptions.mockResolvedValueOnce({ calls: 120 }).mockResolvedValueOnce({ calls: 30 });

      await runLegacySync(makeDeps({ openaevTenants: [TENANT_1, TENANT_2] }));

      expect(mocks.syncTenantDescriptions.mock.calls).toEqual([
        ['oa-tenant-1', DESCRIPTION_FETCH_BUDGET / 2],
        ['oa-tenant-2', DESCRIPTION_FETCH_BUDGET - 120],
      ]);
    });

    it('runs even when the findings phase was refused, since descriptions have their own cadence', async () => {
      mocks.searchFindings.mockRejectedValueOnce(new Error('OpenAEV auth error (403): missing ACCESS_FINDINGS'));

      await runLegacySync(makeDeps());

      expect(mocks.syncTenantDescriptions).toHaveBeenCalledOnce();
    });

    it('lets a failure of the phase fail the run', async () => {
      mocks.syncTenantDescriptions.mockRejectedValueOnce(new Error('descriptions down'));

      await expect(runLegacySync(makeDeps())).rejects.toThrow('descriptions down');
    });

    it('starts no further tenant once the run is aborted', async () => {
      const controller = new AbortController();
      mocks.syncTenantDescriptions.mockImplementationOnce(() => {
        controller.abort();
        return Promise.resolve({ calls: 0 });
      });

      await runLegacySync(makeDeps({ ctx: makeCtx({ signal: controller.signal }), openaevTenants: [TENANT_1, TENANT_2] }));

      expect(mocks.syncTenantDescriptions).toHaveBeenCalledOnce();
    });
  });
});
