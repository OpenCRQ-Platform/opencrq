import { describe, expect, it, vi } from 'vitest';
import { NonRetryableError } from '@app/module';
import type { AttackObservation, SnapshotPage, VulnerabilityObservation } from './openaev-types';
import type { ObservationPhaseDeps, ObservationPhaseServices, ObservationStreamState } from './openaev-observation-phase';
import { syncObservationStreams } from './openaev-observation-phase';

vi.mock('../../utils/logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    logFromError: vi.fn(),
    logTrace: vi.fn(),
    logWarn: vi.fn(),
    logError: vi.fn(),
  }),
}));

type Client = ObservationPhaseDeps['client'];

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-06T12:00:00.000Z');
const RUN_STARTED_AT = new Date('2026-10-06T11:55:00.000Z');
const CONNECTOR_ID = 'connector-1';
const OA_TENANT = 'oa-tenant-1';
const KEY_ATTACK = { connectorId: CONNECTOR_ID, openaevTenantId: OA_TENANT, stream: 'attack' };
const KEY_VULNERABILITY = { connectorId: CONNECTOR_ID, openaevTenantId: OA_TENANT, stream: 'vulnerability' };

const makeAttack = (overrides: Partial<AttackObservation> = {}): AttackObservation => ({
  id: 'obs-1',
  updated_at: '2026-10-05T10:00:00.000Z',
  asset_id: 'asset-1',
  scenario_id: 'scenario-1',
  scenario_name: 'Credential Harvesting',
  last_simulation_id: 'sim-1',
  last_simulation_name: 'Run 1',
  last_simulation_start_date: '2026-10-05T09:00:00.000Z',
  last_simulation_status: 'FINISHED',
  last_inject_id: 'inject-1',
  attack_pattern_external_id: 'T1110.001',
  expectation_type: 'DETECTION',
  expectation_status: 'FAILED',
  platform_types_reporting: ['SIEM'],
  platform_types_succeeded: [],
  last_verified_at: '2026-10-05T10:00:00.000Z',
  ...overrides,
});

const makeVulnerability = (overrides: Partial<VulnerabilityObservation> = {}): VulnerabilityObservation => ({
  id: 'vuln-1',
  updated_at: '2026-10-05T10:00:00.000Z',
  asset_id: 'asset-1',
  last_finding_id: 'finding-1',
  last_scenario_id: 'scenario-1',
  last_simulation_id: 'sim-1',
  last_simulation_name: 'Run 1',
  finding_type: 'CVE',
  finding_value: 'CVE-2024-1234',
  last_verified_at: '2026-10-05T10:00:00.000Z',
  ...overrides,
});

const makePage = <T>(
  observations: Array<T>,
  { next, hasMore = false, ready = true }: { next: string | null, hasMore?: boolean, ready?: boolean },
): SnapshotPage<T> => ({ observations, next_cursor: next, has_more: hasMore, snapshot_ready: ready });

const idleState = (stream: 'attack' | 'vulnerability', overrides: Partial<ObservationStreamState> = {}): ObservationStreamState => ({
  openaevTenantId: OA_TENANT,
  stream,
  cursor: stream === 'attack' ? 'a0' : 'v0',
  fullWalkStartedAt: null,
  lastFullWalkCompletedAt: new Date(NOW.getTime() - DAY_MS),
  lastFullWalkAttemptedAt: new Date(NOW.getTime() - DAY_MS),
  unreconciledSince: null,
  ...overrides,
});

const makeSvc = (states: Array<ObservationStreamState>) => {
  const upsertAttackObservations = vi.fn<ObservationPhaseServices['openaevConnector']['upsertAttackObservations']>().mockResolvedValue(undefined);
  const svc = {
    openaevConnector: {
      getStreamStates: vi.fn<ObservationPhaseServices['openaevConnector']['getStreamStates']>().mockResolvedValue(states),
      saveStreamCursor: vi.fn<ObservationPhaseServices['openaevConnector']['saveStreamCursor']>().mockResolvedValue(undefined),
      startFullWalk: vi.fn<ObservationPhaseServices['openaevConnector']['startFullWalk']>().mockResolvedValue(undefined),
      markStreamUnreconciled: vi.fn<ObservationPhaseServices['openaevConnector']['markStreamUnreconciled']>().mockResolvedValue(undefined),
      upsertAttackObservations,
      // Every document of the page just mirrored is current, unless a test says otherwise.
      findCurrentObservations: vi.fn<ObservationPhaseServices['openaevConnector']['findCurrentObservations']>().mockImplementation(
        () => Promise.resolve((upsertAttackObservations.mock.lastCall?.[0].observations ?? []).map(({ observationId }) => ({ observationId }))),
      ),
      markEvidenceWritten: vi.fn<ObservationPhaseServices['openaevConnector']['markEvidenceWritten']>().mockResolvedValue(undefined),
    },
    supportingAssets: {
      bulkUpsertEvidence: vi.fn<ObservationPhaseServices['supportingAssets']['bulkUpsertEvidence']>().mockResolvedValue(undefined),
    },
    cve: {
      upsertCves: vi.fn<ObservationPhaseServices['cve']['upsertCves']>().mockResolvedValue(undefined),
      getCveIdMap: vi.fn<ObservationPhaseServices['cve']['getCveIdMap']>().mockResolvedValue(new Map([['CVE-2024-1234', 'cve-uuid-1']])),
    },
    mitreAttack: {
      getTechniqueIdsByExternalIds: vi.fn<ObservationPhaseServices['mitreAttack']['getTechniqueIdsByExternalIds']>()
        .mockResolvedValue(new Map([['T1110.001', 'tech-uuid-1']])),
    },
  };
  return svc;
};

const makeClient = () => ({
  searchAttackObservations: vi.fn<Client['searchAttackObservations']>().mockImplementation(
    (_tenantId, { cursor }) => Promise.resolve(makePage<AttackObservation>([], { next: cursor })),
  ),
  searchVulnerabilityObservations: vi.fn<Client['searchVulnerabilityObservations']>().mockImplementation(
    (_tenantId, { cursor }) => Promise.resolve(makePage<VulnerabilityObservation>([], { next: cursor })),
  ),
});

const makeHarness = (
  states: Array<ObservationStreamState> = [idleState('attack'), idleState('vulnerability')],
  overrides: Partial<ObservationPhaseDeps> = {},
) => {
  const svc = makeSvc(states);
  const client = makeClient();
  const ensureInventory = vi.fn<ObservationPhaseDeps['ensureInventory']>().mockResolvedValue(null);
  const deps: ObservationPhaseDeps = {
    client,
    svc,
    connectorId: CONNECTOR_ID,
    openaevTenantId: OA_TENANT,
    runStartedAt: RUN_STARTED_AT,
    assetIdMap: new Map([['asset-1', 'sa-1']]),
    ensureInventory,
    signal: new AbortController().signal,
    now: () => NOW,
    ...overrides,
  };
  return { svc, client, ensureInventory, deps };
};

const cursorsSaved = (svc: ReturnType<typeof makeSvc>, key: { stream: string }) =>
  svc.openaevConnector.saveStreamCursor.mock.calls
    .filter(([input]) => input.stream === key.stream)
    .map(([input]) => input.cursor);

describe('syncObservationStreams', () => {
  describe('cursor handling', () => {
    it('resumes each stream from its stored cursor and saves the cursor after every page', async () => {
      const { svc, client, deps } = makeHarness();
      client.searchAttackObservations
        .mockResolvedValueOnce(makePage([makeAttack({ id: 'obs-1' })], { next: 'a1', hasMore: true }))
        .mockResolvedValueOnce(makePage([makeAttack({ id: 'obs-2' })], { next: 'a2' }));
      client.searchVulnerabilityObservations.mockResolvedValueOnce(makePage([], { next: 'v1' }));

      await syncObservationStreams(deps);

      expect(client.searchAttackObservations.mock.calls.map(([, input]) => input.cursor)).toEqual(['a0', 'a1']);
      expect(client.searchAttackObservations).toHaveBeenCalledWith(OA_TENANT, { cursor: 'a0' });
      expect(client.searchVulnerabilityObservations.mock.calls.map(([, input]) => input.cursor)).toEqual(['v0']);
      expect(cursorsSaved(svc, KEY_ATTACK)).toEqual(['a1', 'a2']);
      expect(cursorsSaved(svc, KEY_VULNERABILITY)).toEqual(['v1']);
      expect(svc.openaevConnector.saveStreamCursor).toHaveBeenCalledWith({ ...KEY_ATTACK, cursor: 'a1' });
      expect(svc.openaevConnector.startFullWalk).not.toHaveBeenCalled();
    });

    it('saves the echoed cursor of an empty last page and writes no evidence', async () => {
      const { svc, client, deps } = makeHarness();
      client.searchAttackObservations.mockResolvedValueOnce(makePage([], { next: 'a0' }));
      client.searchVulnerabilityObservations.mockResolvedValueOnce(makePage([], { next: 'v0' }));

      const result = await syncObservationStreams(deps);

      expect(cursorsSaved(svc, KEY_ATTACK)).toEqual(['a0']);
      expect(cursorsSaved(svc, KEY_VULNERABILITY)).toEqual(['v0']);
      expect(svc.supportingAssets.bulkUpsertEvidence).not.toHaveBeenCalled();
      expect(svc.openaevConnector.markEvidenceWritten).not.toHaveBeenCalled();
      expect(result.attack).toEqual({ fullWalk: null, walked: false, reconcileFrom: RUN_STARTED_AT });
      expect(result.vulnerability).toEqual({ fullWalk: null, walked: false, reconcileFrom: RUN_STARTED_AT });
    });

    it('keeps the cursor it sent when the page carries none', async () => {
      const { svc, client, deps } = makeHarness([idleState('attack', { cursor: null }), idleState('vulnerability')]);
      client.searchAttackObservations.mockResolvedValueOnce(makePage([], { next: null }));

      await syncObservationStreams(deps);

      expect(client.searchAttackObservations).toHaveBeenCalledWith(OA_TENANT, { cursor: null });
      expect(cursorsSaved(svc, KEY_ATTACK)).toEqual([null]);
    });

    it('ends the stream on an empty page even when it claims more, rather than asking for the same cursor forever', async () => {
      const { svc, client, deps } = makeHarness();
      client.searchAttackObservations.mockResolvedValue(makePage([], { next: 'a0', hasMore: true }));

      await syncObservationStreams(deps);

      expect(client.searchAttackObservations).toHaveBeenCalledTimes(1);
      expect(cursorsSaved(svc, KEY_ATTACK)).toEqual(['a0']);
    });
  });

  describe('full walks', () => {
    it.each([true, false])('starts a due walk, reads without a cursor and reports its last page with snapshot_ready %s, leaving it in progress', async (ready) => {
      const { svc, client, deps } = makeHarness([
        idleState('attack', { lastFullWalkCompletedAt: new Date(NOW.getTime() - 8 * DAY_MS), lastFullWalkAttemptedAt: new Date(NOW.getTime() - 8 * DAY_MS) }),
        idleState('vulnerability'),
      ]);
      client.searchAttackObservations
        .mockResolvedValueOnce(makePage([makeAttack()], { next: 'w1', hasMore: true, ready: false }))
        .mockResolvedValueOnce(makePage([], { next: 'w1', ready }));

      const result = await syncObservationStreams(deps);

      expect(svc.openaevConnector.startFullWalk).toHaveBeenCalledTimes(1);
      expect(svc.openaevConnector.startFullWalk).toHaveBeenCalledWith({ ...KEY_ATTACK, startedAt: NOW });
      expect(client.searchAttackObservations.mock.calls.map(([, input]) => input.cursor)).toEqual([null, 'w1']);
      expect(result.attack.fullWalk).toEqual({ startedAt: NOW, ready });
      expect(result.vulnerability.fullWalk).toBeNull();
      expect(svc.openaevConnector.startFullWalk.mock.invocationCallOrder[0])
        .toBeLessThan(client.searchAttackObservations.mock.invocationCallOrder[0]);
    });

    it('starts the walk of a stream that was never read', async () => {
      const { svc, client, deps } = makeHarness([]);
      client.searchAttackObservations.mockResolvedValueOnce(makePage([], { next: null }));
      client.searchVulnerabilityObservations.mockResolvedValueOnce(makePage([], { next: null }));

      const result = await syncObservationStreams(deps);

      expect(svc.openaevConnector.startFullWalk).toHaveBeenCalledWith({ ...KEY_ATTACK, startedAt: NOW });
      expect(svc.openaevConnector.startFullWalk).toHaveBeenCalledWith({ ...KEY_VULNERABILITY, startedAt: NOW });
      expect(client.searchAttackObservations).toHaveBeenCalledWith(OA_TENANT, { cursor: null });
      expect(client.searchVulnerabilityObservations).toHaveBeenCalledWith(OA_TENANT, { cursor: null });
      expect(result.attack.fullWalk).toEqual({ startedAt: NOW, ready: true });
      expect(result.vulnerability.fullWalk).toEqual({ startedAt: NOW, ready: true });
    });

    it('resumes a walk in progress from its stored cursor without starting a new one', async () => {
      const walkStartedAt = new Date(NOW.getTime() - 2 * 60 * 60 * 1000);
      const { svc, client, deps } = makeHarness([
        idleState('attack', { cursor: 'w5', fullWalkStartedAt: walkStartedAt }),
        idleState('vulnerability'),
      ]);
      client.searchAttackObservations.mockResolvedValueOnce(makePage([], { next: 'w5', ready: false }));

      const result = await syncObservationStreams(deps);

      expect(svc.openaevConnector.startFullWalk).not.toHaveBeenCalled();
      expect(client.searchAttackObservations).toHaveBeenCalledWith(OA_TENANT, { cursor: 'w5' });
      expect(result.attack.fullWalk).toEqual({ startedAt: walkStartedAt, ready: false });
    });

    it('reports no completed walk when the run aborts mid-way, and leaves the last processed page as the cursor', async () => {
      const controller = new AbortController();
      const { svc, client, deps } = makeHarness([
        idleState('attack', { cursor: null, fullWalkStartedAt: new Date(NOW.getTime() - 1000) }),
        idleState('vulnerability'),
      ], { signal: controller.signal });
      client.searchAttackObservations
        .mockResolvedValueOnce(makePage([makeAttack({ id: 'obs-1' })], { next: 'w1', hasMore: true }))
        .mockResolvedValueOnce(makePage([makeAttack({ id: 'obs-2' })], { next: 'w2', hasMore: true }));
      svc.openaevConnector.saveStreamCursor.mockImplementation(() => {
        controller.abort();
        return Promise.resolve();
      });

      const result = await syncObservationStreams(deps);

      expect(client.searchAttackObservations).toHaveBeenCalledTimes(1);
      expect(cursorsSaved(svc, KEY_ATTACK)).toEqual(['w1']);
      expect(client.searchVulnerabilityObservations).not.toHaveBeenCalled();
      expect(result.attack.fullWalk).toBeNull();
    });

    it('reports a walk cut short by an abort as walked, without a completed walk', async () => {
      const stale = new Date(NOW.getTime() - 8 * DAY_MS);
      const controller = new AbortController();
      const { svc, client, deps } = makeHarness([
        idleState('attack', { cursor: null, fullWalkStartedAt: new Date(NOW.getTime() - 1000) }),
        idleState('vulnerability', { lastFullWalkCompletedAt: stale, lastFullWalkAttemptedAt: stale }),
      ], { signal: controller.signal });
      client.searchAttackObservations.mockResolvedValueOnce(makePage([makeAttack({ id: 'obs-1' })], { next: 'w1', hasMore: true }));
      svc.openaevConnector.saveStreamCursor.mockImplementation(() => {
        controller.abort();
        return Promise.resolve();
      });

      const interrupted = await syncObservationStreams(deps);

      // A walk cut short by an abort has read part of the stream, and says so without completing.
      expect(interrupted.attack).toMatchObject({ fullWalk: null, walked: true });
      // The vulnerability stream was never reached.
      expect(interrupted.vulnerability).toEqual({ fullWalk: null, walked: false, reconcileFrom: RUN_STARTED_AT });
    });

    it('reports a completed walk as walked, ready or not', async () => {
      const stale = new Date(NOW.getTime() - 8 * DAY_MS);
      const { client, deps } = makeHarness([
        idleState('attack', { lastFullWalkCompletedAt: stale, lastFullWalkAttemptedAt: stale }),
        idleState('vulnerability', { lastFullWalkCompletedAt: stale, lastFullWalkAttemptedAt: stale }),
      ]);
      client.searchAttackObservations.mockResolvedValueOnce(makePage([], { next: null, ready: true }));
      client.searchVulnerabilityObservations.mockResolvedValueOnce(makePage([], { next: null, ready: false }));

      const result = await syncObservationStreams(deps);

      expect(result.attack).toMatchObject({ fullWalk: { startedAt: NOW, ready: true }, walked: true });
      expect(result.vulnerability).toMatchObject({ fullWalk: { startedAt: NOW, ready: false }, walked: true });
    });

    it('reports a walk resumed from an earlier run as walked', async () => {
      const { client, deps } = makeHarness([
        idleState('attack'),
        idleState('vulnerability', { cursor: 'w5', fullWalkStartedAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000) }),
      ]);
      client.searchVulnerabilityObservations.mockResolvedValueOnce(makePage([], { next: 'w5' }));

      const result = await syncObservationStreams(deps);

      expect(result.vulnerability.walked).toBe(true);
      expect(result.attack.walked).toBe(false);
    });

    it('starts nothing when the run is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();
      const { svc, client, deps } = makeHarness([], { signal: controller.signal });

      await syncObservationStreams(deps);

      expect(svc.openaevConnector.startFullWalk).not.toHaveBeenCalled();
      expect(client.searchAttackObservations).not.toHaveBeenCalled();
    });
  });

  describe('attack stream', () => {
    it('mirrors every document, writes evidence for the finished ones and stamps those, in that order, before the cursor', async () => {
      const { svc, client, deps } = makeHarness();
      client.searchAttackObservations.mockResolvedValueOnce(makePage([
        makeAttack({ id: 'obs-1', platform_types_reporting: ['SIEM', 'EDR'], platform_types_succeeded: ['EDR'] }),
        makeAttack({ id: 'obs-2', attack_pattern_external_id: 'T9999' }),
      ], { next: 'a1' }));

      await syncObservationStreams(deps);

      expect(svc.openaevConnector.upsertAttackObservations).toHaveBeenCalledWith({
        connectorId: CONNECTOR_ID,
        openaevTenantId: OA_TENANT,
        observations: [
          {
            observationId: 'obs-1',
            sourceAssetId: 'asset-1',
            scenarioId: 'scenario-1',
            attackPatternExternalId: 'T1110.001',
            expectationType: 'DETECTION',
            simulationStartDate: new Date('2026-10-05T09:00:00.000Z'),
            simulationStatus: 'FINISHED',
          },
          expect.objectContaining({ observationId: 'obs-2', attackPatternExternalId: 'T9999' }),
        ],
        reportedAt: NOW,
      });
      expect(svc.mitreAttack.getTechniqueIdsByExternalIds).toHaveBeenCalledWith(expect.arrayContaining(['T1110.001', 'T9999']));
      const [evidence] = svc.supportingAssets.bulkUpsertEvidence.mock.calls[0];
      expect(evidence).toHaveLength(2);
      expect(evidence).toEqual(expect.arrayContaining([
        expect.objectContaining({ supportingAssetId: 'sa-1', mitreTechniqueId: 'tech-uuid-1', securityPlatformType: 'SIEM', isExposed: true, connectorId: CONNECTOR_ID }),
        expect.objectContaining({ supportingAssetId: 'sa-1', mitreTechniqueId: 'tech-uuid-1', securityPlatformType: 'EDR', isExposed: false }),
      ]));
      expect(svc.openaevConnector.markEvidenceWritten).toHaveBeenCalledWith({
        connectorId: CONNECTOR_ID,
        entries: [{ observationId: 'obs-1', platformTypes: ['SIEM', 'EDR'] }],
        writtenAt: NOW,
      });
      const order = [
        svc.openaevConnector.upsertAttackObservations,
        svc.openaevConnector.findCurrentObservations,
        svc.supportingAssets.bulkUpsertEvidence,
        svc.openaevConnector.markEvidenceWritten,
        svc.openaevConnector.saveStreamCursor,
      ].map((fn) => fn.mock.invocationCallOrder[0]);
      expect(order).toEqual([...order].sort((a, b) => a - b));
    });

    it('mirrors a RUNNING observation but writes no evidence and does not stamp it', async () => {
      const { svc, client, deps } = makeHarness();
      client.searchAttackObservations.mockResolvedValueOnce(makePage([
        makeAttack({ id: 'obs-running', last_simulation_status: 'RUNNING' }),
      ], { next: 'a1' }));

      await syncObservationStreams(deps);

      expect(svc.openaevConnector.upsertAttackObservations).toHaveBeenCalledWith(expect.objectContaining({
        observations: [expect.objectContaining({ observationId: 'obs-running', simulationStatus: 'RUNNING' })],
      }));
      expect(svc.supportingAssets.bulkUpsertEvidence).not.toHaveBeenCalled();
      expect(svc.openaevConnector.markEvidenceWritten).not.toHaveBeenCalled();
      expect(cursorsSaved(svc, KEY_ATTACK)).toEqual(['a1']);
    });

    it('mirrors a document with no start date or an unparseable one as null', async () => {
      const { svc, client, deps } = makeHarness();
      client.searchAttackObservations.mockResolvedValueOnce(makePage([
        makeAttack({ id: 'obs-1', last_simulation_start_date: null }),
        makeAttack({ id: 'obs-2', last_simulation_start_date: 'not a date' }),
      ], { next: 'a1' }));

      await syncObservationStreams(deps);

      expect(svc.openaevConnector.upsertAttackObservations).toHaveBeenCalledWith(expect.objectContaining({
        observations: [
          expect.objectContaining({ observationId: 'obs-1', simulationStartDate: null }),
          expect.objectContaining({ observationId: 'obs-2', simulationStartDate: null }),
        ],
      }));
    });

    it('does not stamp a finished document whose technique is unknown locally', async () => {
      const { svc, client, deps } = makeHarness();
      client.searchAttackObservations.mockResolvedValueOnce(makePage([
        makeAttack({ id: 'obs-unknown-technique', attack_pattern_external_id: 'T9999' }),
      ], { next: 'a1' }));

      await syncObservationStreams(deps);

      expect(svc.supportingAssets.bulkUpsertEvidence).not.toHaveBeenCalled();
      expect(svc.openaevConnector.markEvidenceWritten).not.toHaveBeenCalled();
    });

    it('stamps the platform types of each document, unknown included, and nothing for a document that wrote no row', async () => {
      const { svc, client, deps } = makeHarness();
      client.searchAttackObservations.mockResolvedValueOnce(makePage([
        makeAttack({ id: 'obs-1', platform_types_reporting: ['SIEM', 'EDR'] }),
        makeAttack({ id: 'obs-2', attack_pattern_external_id: 'T1059', platform_types_reporting: [] }),
        makeAttack({ id: 'obs-3', asset_id: 'asset-ghost' }),
      ], { next: 'a1' }));
      svc.mitreAttack.getTechniqueIdsByExternalIds.mockResolvedValue(new Map([['T1110.001', 'tech-uuid-1'], ['T1059', 'tech-uuid-2']]));

      await syncObservationStreams(deps);

      expect(svc.openaevConnector.markEvidenceWritten).toHaveBeenCalledWith({
        connectorId: CONNECTOR_ID,
        entries: [
          { observationId: 'obs-1', platformTypes: ['SIEM', 'EDR'] },
          { observationId: 'obs-2', platformTypes: ['unknown'] },
        ],
        writtenAt: NOW,
      });
    });

    it('asks which documents are current for the distinct (asset, scenario) pairs of the page, unknown assets included', async () => {
      const { svc, client, deps } = makeHarness();
      client.searchAttackObservations
        .mockResolvedValueOnce(makePage([
          makeAttack({ id: 'obs-1' }),
          makeAttack({ id: 'obs-2', attack_pattern_external_id: 'T1059' }),
          makeAttack({ id: 'obs-3', scenario_id: 'scenario-2' }),
        ], { next: 'a1', hasMore: true }))
        .mockResolvedValueOnce(makePage([
          makeAttack({ id: 'obs-4', asset_id: 'asset-ghost' }),
        ], { next: 'a2' }));

      await syncObservationStreams(deps);

      const asked = svc.openaevConnector.findCurrentObservations.mock.calls.map(([input]) => input);
      expect(asked).toHaveLength(2);
      expect(asked[0].connectorId).toBe(CONNECTOR_ID);
      expect(asked[0].pairs).toHaveLength(2);
      expect(asked[0].pairs).toEqual(expect.arrayContaining([
        { sourceAssetId: 'asset-1', scenarioId: 'scenario-1' },
        { sourceAssetId: 'asset-1', scenarioId: 'scenario-2' },
      ]));
      expect(asked[1].pairs).toEqual([{ sourceAssetId: 'asset-ghost', scenarioId: 'scenario-1' }]);
    });

    it('writes no evidence for a document a later replay superseded, nor stamps it, but keeps its mirror row', async () => {
      const { svc, client, deps } = makeHarness();
      client.searchAttackObservations.mockResolvedValueOnce(makePage([
        makeAttack({ id: 'obs-old', attack_pattern_external_id: 'T1059' }),
        makeAttack({ id: 'obs-current' }),
      ], { next: 'a1' }));
      svc.openaevConnector.findCurrentObservations.mockResolvedValue([{ observationId: 'obs-current' }]);
      svc.mitreAttack.getTechniqueIdsByExternalIds.mockResolvedValue(new Map([['T1110.001', 'tech-uuid-1'], ['T1059', 'tech-uuid-2']]));

      await syncObservationStreams(deps);

      expect(svc.openaevConnector.upsertAttackObservations).toHaveBeenCalledWith(expect.objectContaining({
        observations: [expect.objectContaining({ observationId: 'obs-old' }), expect.objectContaining({ observationId: 'obs-current' })],
      }));
      const [evidence] = svc.supportingAssets.bulkUpsertEvidence.mock.calls[0];
      expect(evidence.map((row) => row.mitreTechniqueId)).toEqual(['tech-uuid-1']);
      expect(svc.openaevConnector.markEvidenceWritten).toHaveBeenCalledWith(expect.objectContaining({
        entries: [{ observationId: 'obs-current', platformTypes: ['SIEM'] }],
      }));
    });

    it('writes nothing at all for a page whose documents are all superseded', async () => {
      const { svc, client, deps } = makeHarness();
      client.searchAttackObservations.mockResolvedValueOnce(makePage([makeAttack({ id: 'obs-old' })], { next: 'a1' }));
      svc.openaevConnector.findCurrentObservations.mockResolvedValue([]);

      await syncObservationStreams(deps);

      expect(svc.supportingAssets.bulkUpsertEvidence).not.toHaveBeenCalled();
      expect(svc.openaevConnector.markEvidenceWritten).not.toHaveBeenCalled();
      expect(cursorsSaved(svc, KEY_ATTACK)).toEqual(['a1']);
    });
  });

  describe('reconciliation bookkeeping', () => {
    it('notes each stream unreconciled from the start of the run, before it reads anything of it', async () => {
      const { svc, client, deps } = makeHarness();

      await syncObservationStreams(deps);

      expect(svc.openaevConnector.markStreamUnreconciled).toHaveBeenCalledTimes(2);
      expect(svc.openaevConnector.markStreamUnreconciled).toHaveBeenCalledWith({ ...KEY_ATTACK, since: RUN_STARTED_AT });
      expect(svc.openaevConnector.markStreamUnreconciled).toHaveBeenCalledWith({ ...KEY_VULNERABILITY, since: RUN_STARTED_AT });
      const [attackNote, vulnerabilityNote] = svc.openaevConnector.markStreamUnreconciled.mock.invocationCallOrder;
      expect(attackNote).toBeLessThan(client.searchAttackObservations.mock.invocationCallOrder[0]);
      expect(vulnerabilityNote).toBeLessThan(client.searchVulnerabilityObservations.mock.invocationCallOrder[0]);
    });

    it('notes a walk before it starts it', async () => {
      const { svc, deps } = makeHarness([]);

      await syncObservationStreams(deps);

      expect(svc.openaevConnector.markStreamUnreconciled.mock.invocationCallOrder[0])
        .toBeLessThan(svc.openaevConnector.startFullWalk.mock.invocationCallOrder[0]);
    });

    it('reports the run start as the instant to reconcile from when the stream has nothing pending', async () => {
      const { deps } = makeHarness();

      const result = await syncObservationStreams(deps);

      expect(result.attack.reconcileFrom).toEqual(RUN_STARTED_AT);
      expect(result.vulnerability.reconcileFrom).toEqual(RUN_STARTED_AT);
    });

    it('reports the instant an earlier run left pending, per stream', async () => {
      const pending = new Date('2026-10-05T08:00:00.000Z');
      const { deps } = makeHarness([idleState('attack', { unreconciledSince: pending }), idleState('vulnerability')]);

      const result = await syncObservationStreams(deps);

      expect(result.attack.reconcileFrom).toEqual(pending);
      expect(result.vulnerability.reconcileFrom).toEqual(RUN_STARTED_AT);
    });

    it('reports the pending instant for a stream it did not reach because the run was aborted, and notes nothing for it', async () => {
      const controller = new AbortController();
      controller.abort();
      const pending = new Date('2026-10-05T08:00:00.000Z');
      const { svc, deps } = makeHarness([idleState('attack', { unreconciledSince: pending }), idleState('vulnerability')], { signal: controller.signal });

      const result = await syncObservationStreams(deps);

      expect(result.attack).toEqual({ fullWalk: null, walked: false, reconcileFrom: pending });
      expect(svc.openaevConnector.markStreamUnreconciled).not.toHaveBeenCalled();
    });
  });

  describe('unknown assets', () => {
    it('runs the inventory once, resolves the page again against the map it returns, and skips a later unknown asset', async () => {
      const { svc, client, ensureInventory, deps } = makeHarness();
      const refreshed = new Map([['asset-1', 'sa-1'], ['asset-2', 'sa-2']]);
      ensureInventory.mockResolvedValueOnce(refreshed);
      client.searchAttackObservations
        .mockResolvedValueOnce(makePage([
          makeAttack({ id: 'obs-1', asset_id: 'asset-1' }),
          makeAttack({ id: 'obs-2', asset_id: 'asset-2' }),
        ], { next: 'a1', hasMore: true }))
        .mockResolvedValueOnce(makePage([
          makeAttack({ id: 'obs-3', asset_id: 'asset-ghost' }),
        ], { next: 'a2' }));

      await syncObservationStreams(deps);

      expect(ensureInventory).toHaveBeenCalledTimes(1);
      const [firstWrite, secondWrite] = svc.supportingAssets.bulkUpsertEvidence.mock.calls.map(([rows]) => rows);
      expect(svc.supportingAssets.bulkUpsertEvidence).toHaveBeenCalledTimes(1);
      expect(firstWrite.map((row) => row.supportingAssetId).sort()).toEqual(['sa-1', 'sa-2']);
      expect(secondWrite).toBeUndefined();
      expect(svc.openaevConnector.upsertAttackObservations).toHaveBeenCalledTimes(2);
      expect(svc.openaevConnector.upsertAttackObservations).toHaveBeenLastCalledWith(expect.objectContaining({
        observations: [expect.objectContaining({ observationId: 'obs-3', sourceAssetId: 'asset-ghost' })],
      }));
      expect(cursorsSaved(svc, KEY_ATTACK)).toEqual(['a1', 'a2']);
    });

    it('skips an unknown asset and still advances the cursor when the inventory already ran this run', async () => {
      const { svc, client, ensureInventory, deps } = makeHarness();
      ensureInventory.mockResolvedValue(null);
      client.searchAttackObservations.mockResolvedValueOnce(makePage([
        makeAttack({ id: 'obs-ghost', asset_id: 'asset-ghost' }),
      ], { next: 'a1' }));

      await syncObservationStreams(deps);

      expect(ensureInventory).toHaveBeenCalledTimes(1);
      expect(svc.supportingAssets.bulkUpsertEvidence).not.toHaveBeenCalled();
      expect(svc.openaevConnector.upsertAttackObservations).toHaveBeenCalledTimes(1);
      expect(cursorsSaved(svc, KEY_ATTACK)).toEqual(['a1']);
    });

    it('runs the inventory once for both streams', async () => {
      const { client, ensureInventory, deps } = makeHarness();
      ensureInventory.mockResolvedValueOnce(new Map([['asset-1', 'sa-1']]));
      client.searchAttackObservations.mockResolvedValueOnce(makePage([makeAttack({ asset_id: 'asset-ghost' })], { next: 'a1' }));
      client.searchVulnerabilityObservations.mockResolvedValueOnce(makePage([makeVulnerability({ asset_id: 'asset-ghost-2' })], { next: 'v1' }));

      await syncObservationStreams(deps);

      expect(ensureInventory).toHaveBeenCalledTimes(1);
    });

    it('does not run the inventory when every asset is known', async () => {
      const { client, ensureInventory, deps } = makeHarness();
      client.searchAttackObservations.mockResolvedValueOnce(makePage([makeAttack()], { next: 'a1' }));

      await syncObservationStreams(deps);

      expect(ensureInventory).not.toHaveBeenCalled();
    });

    it('drops the page and keeps the cursor when the run aborts during the inventory', async () => {
      const controller = new AbortController();
      const { svc, client, ensureInventory, deps } = makeHarness(undefined, { signal: controller.signal });
      ensureInventory.mockImplementation(() => {
        controller.abort();
        return Promise.resolve(new Map());
      });
      client.searchAttackObservations.mockResolvedValueOnce(makePage([makeAttack({ asset_id: 'asset-ghost' })], { next: 'a1' }));

      const result = await syncObservationStreams(deps);

      expect(svc.openaevConnector.upsertAttackObservations).not.toHaveBeenCalled();
      expect(svc.supportingAssets.bulkUpsertEvidence).not.toHaveBeenCalled();
      expect(svc.openaevConnector.saveStreamCursor).not.toHaveBeenCalled();
      expect(client.searchVulnerabilityObservations).not.toHaveBeenCalled();
      expect(result.attack.fullWalk).toBeNull();
    });
  });

  describe('vulnerability stream', () => {
    it('writes CVE evidence under the normalised identifier and ignores what is not a CVE', async () => {
      const { svc, client, deps } = makeHarness();
      client.searchVulnerabilityObservations.mockResolvedValueOnce(makePage([
        makeVulnerability({ id: 'vuln-1', finding_value: ' cve-2024-1234 ', finding_type: 'cve' }),
        makeVulnerability({ id: 'vuln-2', finding_value: 'CVE-2024-1234', last_finding_id: 'finding-2' }),
        makeVulnerability({ id: 'vuln-3', finding_type: 'CWE', finding_value: 'CWE-79' }),
        makeVulnerability({ id: 'vuln-4', finding_value: 'not a cve' }),
        makeVulnerability({ id: 'vuln-5', asset_id: 'asset-ghost' }),
      ], { next: 'v1' }));

      await syncObservationStreams(deps);

      expect(svc.cve.upsertCves).toHaveBeenCalledWith([{ cveId: 'CVE-2024-1234' }]);
      expect(svc.cve.getCveIdMap).toHaveBeenCalledWith(['CVE-2024-1234']);
      const [evidence] = svc.supportingAssets.bulkUpsertEvidence.mock.calls[0];
      expect(evidence.length).toBeGreaterThanOrEqual(1);
      for (const row of evidence) {
        expect(row).toEqual(expect.objectContaining({
          supportingAssetId: 'sa-1',
          cveId: 'cve-uuid-1',
          isExposed: true,
          scope: 'asset-1',
          sourceFindingId: 'asset-1:CVE-2024-1234',
          connectorId: CONNECTOR_ID,
        }));
      }
      expect(svc.openaevConnector.upsertAttackObservations).not.toHaveBeenCalled();
      expect(cursorsSaved(svc, KEY_VULNERABILITY)).toEqual(['v1']);
    });

    it('writes nothing for a page with no usable CVE and still saves the cursor', async () => {
      const { svc, client, deps } = makeHarness();
      client.searchVulnerabilityObservations.mockResolvedValueOnce(makePage([
        makeVulnerability({ finding_type: 'CWE', finding_value: 'CWE-79' }),
      ], { next: 'v1' }));

      await syncObservationStreams(deps);

      expect(svc.cve.upsertCves).not.toHaveBeenCalled();
      expect(svc.supportingAssets.bulkUpsertEvidence).not.toHaveBeenCalled();
      expect(cursorsSaved(svc, KEY_VULNERABILITY)).toEqual(['v1']);
    });

    it('reports a due vulnerability walk without touching the attack stream state', async () => {
      const { svc, client, deps } = makeHarness([idleState('attack'), idleState('vulnerability', { lastFullWalkCompletedAt: null, lastFullWalkAttemptedAt: null })]);
      client.searchVulnerabilityObservations.mockResolvedValueOnce(makePage([], { next: null, ready: false }));

      const result = await syncObservationStreams(deps);

      expect(svc.openaevConnector.startFullWalk).toHaveBeenCalledTimes(1);
      expect(svc.openaevConnector.startFullWalk).toHaveBeenCalledWith({ ...KEY_VULNERABILITY, startedAt: NOW });
      expect(result.vulnerability.fullWalk).toEqual({ startedAt: NOW, ready: false });
      expect(result.attack.fullWalk).toBeNull();
    });
  });

  describe('failures and progress', () => {
    it('propagates a NonRetryableError of the client and saves no cursor for the failed page', async () => {
      const { svc, client, deps } = makeHarness();
      client.searchAttackObservations.mockRejectedValueOnce(new NonRetryableError('OpenAEV snapshot export is disabled (404)'));

      await expect(syncObservationStreams(deps)).rejects.toBeInstanceOf(NonRetryableError);

      expect(svc.openaevConnector.saveStreamCursor).not.toHaveBeenCalled();
      expect(client.searchVulnerabilityObservations).not.toHaveBeenCalled();
    });

    it('keeps the cursor of the last written page when a write fails', async () => {
      const { svc, client, deps } = makeHarness();
      client.searchAttackObservations
        .mockResolvedValueOnce(makePage([makeAttack({ id: 'obs-1' })], { next: 'a1', hasMore: true }))
        .mockResolvedValueOnce(makePage([makeAttack({ id: 'obs-2' })], { next: 'a2' }));
      svc.supportingAssets.bulkUpsertEvidence
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('deadlock'));

      await expect(syncObservationStreams(deps)).rejects.toThrow('deadlock');

      expect(cursorsSaved(svc, KEY_ATTACK)).toEqual(['a1']);
    });

    it('reports progress after every page of every stream', async () => {
      const onProgress = vi.fn<NonNullable<ObservationPhaseDeps['onProgress']>>().mockResolvedValue(undefined);
      const { client, deps } = makeHarness(undefined, { onProgress });
      client.searchAttackObservations
        .mockResolvedValueOnce(makePage([makeAttack({ id: 'obs-1' }), makeAttack({ id: 'obs-2' })], { next: 'a1', hasMore: true }))
        .mockResolvedValueOnce(makePage([makeAttack({ id: 'obs-3' })], { next: 'a2' }));
      client.searchVulnerabilityObservations.mockResolvedValueOnce(makePage([makeVulnerability()], { next: 'v1' }));

      await syncObservationStreams(deps);

      expect(onProgress.mock.calls.map(([progress]) => progress)).toEqual([
        { stream: 'attack', pages: 1, observations: 2 },
        { stream: 'attack', pages: 2, observations: 3 },
        { stream: 'vulnerability', pages: 1, observations: 1 },
      ]);
    });
  });
});
