import type { EventOrigin } from '@app/module';
import { assetEvidence, assetEvidenceHistory, assetEvidenceSources, integrationSettings, openaevAssets, openaevAttackObservations, openaevSyncStreams, supportingAssets, supportingAssetSources } from '@app/module';
import { createJobContext } from '@app/back/src/engines/job-runtime/job-context-factory';
import { openaevSyncHandler } from '@app/back/src/features/openaev-sync/openaev-sync-handler';
import { and, asc, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttackDocumentInput, FakeOpenaev, FakeOpenaevTenant } from '../../helpers/fake-openaev';
import { createTenantWithAdmin } from '../../helpers/factories';
import { evidenceRowsOfAsset } from '../../helpers/evidence-rows';
import { expectReplayedSyncSilent } from '../../helpers/replayed-sync';
import { startFakeOpenaev } from '../../helpers/fake-openaev';
import { testConnectorsConfig } from '../../setup/mock';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

// The handler builds its services on the backend's own db engine, which reads the connection from
// `config()`: this file's mock must therefore carry the worker database next to the connectors that
// `setup/mock.ts` otherwise serves. The connection is resolved inside the factory because the
// engine reads it while the handler's module graph is still being evaluated.
vi.mock('../../../../back/src/config', async () => {
  const { getWorkerDbName, pgConfig } = await import('../../setup/pg-config');
  const { testConnectorsConfig: connectors } = await import('../../setup/mock');
  return {
    config: () => ({ postgres: { ...pgConfig, database: getWorkerDbName() }, connectors }),
    pmConfig: {},
    getProcessName: () => 'test',
  };
});

const services = createTestServices(db);

const RETIRED = 'No longer reported by OpenAEV';
const DAY_MS = 86_400_000;
const daysAgo = (days: number): Date => new Date(Date.now() - days * DAY_MS);

const OAEV_TENANT = 'oaev-main';
const OLD_START = new Date('2026-09-01T00:00:00.000Z');
const NEW_START = new Date('2026-09-10T00:00:00.000Z');

/** The label a finding is read back under: technique, expectation type, platform type and scenario. */
const attackLabel = (technique: string, platformType = 'EDR', scenarioId = 'scn-1', expectationType = 'detection') =>
  `${technique}/${expectationType}/${platformType}/${scenarioId}`;

describe('OpenAEV snapshot sync against a fake OpenAEV', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;
  let serviceAccountId: string;
  let connectorId: string;
  let fake: FakeOpenaev;
  let main: FakeOpenaevTenant;

  const attackDoc = (overrides: Partial<AttackDocumentInput> & Pick<AttackDocumentInput, 'technique'>): AttackDocumentInput => ({
    assetId: 'ep-1',
    scenarioId: 'scn-1',
    simulationId: 'sim-1',
    simulationStartDate: OLD_START,
    reporting: ['EDR'],
    verifiedAt: daysAgo(1),
    ...overrides,
  });

  /** Runs the handler once; `abortOn` stops it, the way a cancelled or timed-out run stops, as soon as it announces a matching progress message. */
  const runSync = async (abortOn?: RegExp): Promise<void> => {
    const controller = new AbortController();
    const ctx = createJobContext({
      jobId: uuidv7(),
      tenantId,
      kind: 'openaev-findings-sync',
      interactive: false,
      payload: {},
      attempt: 1,
      state: null,
      signal: controller.signal,
      deps: {
        updateProgress: (_jobId, progress) => {
          if (abortOn !== undefined && abortOn.test(progress.message ?? '')) {
            controller.abort();
          }
          return Promise.resolve();
        },
        saveStateSnapshot: () => Promise.resolve(),
      },
      runDb: db,
    });
    await openaevSyncHandler({ ...ctx, payload: { serviceAccountId }, state: null });
  };

  const supportingAssetIdOf = async (sourceAssetId: string): Promise<string> => {
    const registry = await services.withOrigin(adminOrigin).supportingAssets.getInventoryAssetIdMap(connectorId);
    const supportingAssetId = registry.get(sourceAssetId);
    if (supportingAssetId === undefined) {
      throw new Error(`asset ${sourceAssetId} was never inventoried`);
    }
    return supportingAssetId;
  };

  interface EvidenceView {
    id: string,
    state: string,
    reason: string | null,
    evaluatedAt: Date | null,
    simulationId: string | null,
  }

  /** Every evidence of an asset, by `attackLabel` for a technique or by CVE identifier. */
  const evidenceOf = async (sourceAssetId: string): Promise<Map<string, EvidenceView>> => {
    const rows = await evidenceRowsOfAsset(await supportingAssetIdOf(sourceAssetId));
    return new Map(rows.map((row) => [
      row.cveId ?? attackLabel(
        row.mitreTechniqueExternalId ?? '',
        row.securityPlatformType ?? '',
        row.sourceScenarioId ?? '',
        row.expectationType ?? '',
      ),
      {
        id: row.id,
        state: row.currentState ?? 'none',
        reason: row.stateReason,
        evaluatedAt: row.evaluatedAt,
        simulationId: row.sourceSimulationId,
      },
    ]));
  };

  const stateOf = async (sourceAssetId: string, label: string) => {
    const view = (await evidenceOf(sourceAssetId)).get(label);
    return view === undefined ? undefined : { state: view.state, reason: view.reason };
  };

  const historyOf = async (sourceAssetId: string, label: string): Promise<Array<{ state: string, reason: string | null }>> => {
    const view = (await evidenceOf(sourceAssetId)).get(label);
    if (view === undefined) {
      throw new Error(`no evidence ${label} on ${sourceAssetId}`);
    }
    const rows = await db.select({ state: assetEvidenceHistory.state, reason: assetEvidenceHistory.reason })
      .from(assetEvidenceHistory)
      .where(eq(assetEvidenceHistory.assetEvidenceId, view.id))
      .orderBy(asc(assetEvidenceHistory.stateChangedAt), asc(assetEvidenceHistory.id));
    return rows;
  };

  const lastReportedAtOf = async (sourceAssetId: string, label: string): Promise<Date> => {
    const view = (await evidenceOf(sourceAssetId)).get(label);
    if (view === undefined) {
      throw new Error(`no evidence ${label} on ${sourceAssetId}`);
    }
    const [source] = await db.select({ lastReportedAt: assetEvidenceSources.lastReportedAt })
      .from(assetEvidenceSources)
      .where(eq(assetEvidenceSources.assetEvidenceId, view.id));
    if (source === undefined) {
      throw new Error(`no source for ${label}`);
    }
    return source.lastReportedAt;
  };

  const streamStates = () => db.select().from(openaevSyncStreams).where(eq(openaevSyncStreams.connectorId, connectorId));
  const streamState = async (stream: 'attack' | 'vulnerability', openaevTenantId = OAEV_TENANT) => {
    const state = (await streamStates()).find((row) => row.stream === stream && row.openaevTenantId === openaevTenantId);
    if (state === undefined) {
      throw new Error(`no ${stream} stream state for ${openaevTenantId}`);
    }
    return state;
  };
  const mirrorRows = () => db.select().from(openaevAttackObservations).where(eq(openaevAttackObservations.connectorId, connectorId));

  /** Makes the full walk of the streams due again, without waiting a week. */
  const makeFullWalkDue = async (openaevTenantId?: string): Promise<void> => {
    const stale = daysAgo(8);
    await db.update(openaevSyncStreams)
      .set({ lastFullWalkCompletedAt: stale, lastFullWalkAttemptedAt: stale })
      .where(openaevTenantId === undefined
        ? eq(openaevSyncStreams.connectorId, connectorId)
        : and(eq(openaevSyncStreams.connectorId, connectorId), eq(openaevSyncStreams.openaevTenantId, openaevTenantId)));
  };

  /** Ages every description fetch stamp past the day a description is left alone. */
  const makeDescriptionsDue = async (): Promise<void> => {
    await db.update(openaevAssets).set({ descriptionFetchedAt: daysAgo(2) }).where(eq(openaevAssets.connectorId, connectorId));
  };

  /** What a write moves on the assets, their sources and their evidence. */
  const writeStamps = async () => ({
    assets: await db.select({ id: supportingAssets.id, updatedAt: supportingAssets.updatedAt }).from(supportingAssets).orderBy(asc(supportingAssets.id)),
    sources: await db.select({ id: supportingAssetSources.id, updatedAt: supportingAssetSources.updatedAt }).from(supportingAssetSources).orderBy(asc(supportingAssetSources.id)),
    evidence: await db.select({ id: assetEvidence.id, updatedAt: assetEvidence.updatedAt }).from(assetEvidence).orderBy(asc(assetEvidence.id)),
    evidenceSources: await db.select({ id: assetEvidenceSources.id, updatedAt: assetEvidenceSources.updatedAt, lastReportedAt: assetEvidenceSources.lastReportedAt })
      .from(assetEvidenceSources).orderBy(asc(assetEvidenceSources.id)),
    history: await db.select({ id: assetEvidenceHistory.id }).from(assetEvidenceHistory).orderBy(asc(assetEvidenceHistory.id)),
  });

  const attackSearches = (openaevTenantId = OAEV_TENANT) =>
    fake.requestsTo('POST', '/snapshot/attack-observations/search', openaevTenantId);

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;

    serviceAccountId = uuidv7();
    await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'OpenAEV bot' });
    await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('openaev', serviceAccountId);
    connectorId = (await services.withOrigin(adminOrigin).integrationSettings.getConnectorId('openaev'))!;

    fake = await startFakeOpenaev();
    main = fake.addTenant(OAEV_TENANT, 'Main');
    main.setEndpoints([
      { id: 'ep-1', name: 'server-1', hostname: 'server-1.test' },
      { id: 'ep-2', name: 'server-2', hostname: 'server-2.test' },
    ]);
    testConnectorsConfig['openaev'] = { [tenantId]: { url: fake.url, token: fake.token } };
  });

  afterEach(async () => {
    delete testConnectorsConfig['openaev'];
    await fake.close();
  });

  describe('first run', () => {
    it('should read both streams page by page from a full walk and write the evidence of an old verdict', async () => {
      main.attack.maxPageSize = 2;
      main.putAttack(attackDoc({ technique: 'T1003', verifiedAt: daysAgo(20) }));
      main.putAttack(attackDoc({ technique: 'T1059', expectationType: 'PREVENTION', reporting: ['EDR', 'SIEM'], succeeded: ['SIEM'], verifiedAt: daysAgo(20) }));
      main.putAttack(attackDoc({ assetId: 'ep-2', technique: 'T1566', verifiedAt: daysAgo(20) }));
      main.putVulnerability({ assetId: 'ep-1', cve: 'CVE-2024-1111', verifiedAt: daysAgo(20) });

      await runSync();

      const attackRequests = attackSearches();
      expect(attackRequests).toHaveLength(2);
      expect(attackRequests.map((request) => request.body)).toEqual([
        { page_size: 1000 },
        { cursor: expect.any(String), page_size: 1000 },
      ]);
      expect(fake.requestsTo('POST', '/snapshot/vulnerability-observations/search', OAEV_TENANT).map((request) => request.body)).toEqual([{ page_size: 1000 }]);

      const server1 = await evidenceOf('ep-1');
      expect(server1.get(attackLabel('T1003'))).toMatchObject({ state: 'applicable', reason: 'Not detected by EDR in simulation Simulation sim-1' });
      expect(server1.get(attackLabel('T1059', 'EDR', 'scn-1', 'prevention'))).toMatchObject({ state: 'applicable', reason: 'Not prevented by EDR in simulation Simulation sim-1' });
      expect(server1.get(attackLabel('T1059', 'SIEM', 'scn-1', 'prevention'))).toMatchObject({ state: 'dismissed', reason: 'Prevented by SIEM in simulation Simulation sim-1' });
      expect(server1.get('CVE-2024-1111')).toMatchObject({ state: 'applicable' });
      expect(await stateOf('ep-2', attackLabel('T1566'))).toEqual({ state: 'applicable', reason: 'Not detected by EDR in simulation Simulation sim-1' });
      // No watermark: a verdict older than a week is written all the same, with its own date.
      expect(server1.get(attackLabel('T1003'))?.evaluatedAt?.getTime()).toBeLessThan(daysAgo(19).getTime());

      for (const stream of ['attack', 'vulnerability'] as const) {
        expect(await streamState(stream)).toMatchObject({ fullWalkStartedAt: null, lastFullWalkCompletedAt: expect.any(Date), lastFullWalkAttemptedAt: expect.any(Date), cursor: expect.any(String) });
      }
      const mirror = await mirrorRows();
      expect(mirror).toHaveLength(3);
      expect(mirror.every((row) => row.evidenceWrittenAt !== null)).toBe(true);
      expect((await db.select().from(assetEvidenceHistory)).filter((row) => row.reason === RETIRED)).toEqual([]);
    });
  });

  describe('a run where nothing changed in OpenAEV', () => {
    it('should rewrite no asset, source or evidence, even with the inventory due again', async () => {
      main.putAttack(attackDoc({ technique: 'T1003' }));
      main.putAttack(attackDoc({ assetId: 'ep-2', technique: 'T1059' }));
      main.putVulnerability({ assetId: 'ep-1', cve: 'CVE-2024-1111', verifiedAt: daysAgo(1) });
      await runSync();
      await db.update(integrationSettings).set({ lastReportedAt: daysAgo(2) }).where(eq(integrationSettings.id, connectorId));
      const before = await writeStamps();
      expect(before.evidence.length).toBeGreaterThan(0);

      await expectReplayedSyncSilent(() => runSync(), { bookkeepingTables: ['openaev_sync_streams', 'openaev_assets'] });

      expect(await writeStamps()).toEqual(before);
      expect((await db.select({ lastReportedAt: integrationSettings.lastReportedAt }).from(integrationSettings).where(eq(integrationSettings.id, connectorId)))[0].lastReportedAt!.getTime())
        .toBeGreaterThan(daysAgo(1).getTime());
    });
  });

  describe('a replay that supersedes an older one', () => {
    it('should retire the technique the newer FINISHED replay no longer plays and keep the one it plays', async () => {
      main.putAttack(attackDoc({ technique: 'T1003' }));
      main.putAttack(attackDoc({ technique: 'T1059' }));
      await runSync();
      expect(await stateOf('ep-1', attackLabel('T1059'))).toMatchObject({ state: 'applicable' });

      main.putAttack(attackDoc({ technique: 'T1003', simulationId: 'sim-2', simulationStartDate: NEW_START }));
      await runSync();

      expect(await stateOf('ep-1', attackLabel('T1003'))).toMatchObject({ state: 'applicable', reason: 'Not detected by EDR in simulation Simulation sim-1' });
      expect(await stateOf('ep-1', attackLabel('T1059'))).toEqual({ state: 'dismissed', reason: RETIRED });
      expect(await historyOf('ep-1', attackLabel('T1059'))).toEqual([
        { state: 'applicable', reason: 'Not detected by EDR in simulation Simulation sim-1' },
        { state: 'dismissed', reason: RETIRED },
      ]);

      // The next run has nothing to say, and changes nothing.
      await runSync();
      expect(await stateOf('ep-1', attackLabel('T1003'))).toMatchObject({ state: 'applicable' });
      expect(await stateOf('ep-1', attackLabel('T1059'))).toEqual({ state: 'dismissed', reason: RETIRED });
      expect(await historyOf('ep-1', attackLabel('T1059'))).toHaveLength(2);
      expect(await historyOf('ep-1', attackLabel('T1003'))).toHaveLength(1);
    });
  });

  describe('a late verdict on one technique', () => {
    it('should leave the other techniques of the same asset and scenario applicable', async () => {
      main.putAttack(attackDoc({ technique: 'T1003' }));
      main.putAttack(attackDoc({ technique: 'T1059' }));
      await runSync();
      const secondRunStart = new Date();

      // Same simulation, same start date: only the verdict of one collector arrived late.
      main.putAttack(attackDoc({ technique: 'T1003', succeeded: ['EDR'], verifiedAt: new Date() }));
      await runSync();

      expect(await stateOf('ep-1', attackLabel('T1003'))).toEqual({ state: 'dismissed', reason: 'Detected by EDR in simulation Simulation sim-1' });
      expect(await stateOf('ep-1', attackLabel('T1059'))).toMatchObject({ state: 'applicable' });
      expect(await historyOf('ep-1', attackLabel('T1059'))).toHaveLength(1);
      // Kept alive by the retirement rather than rewritten.
      expect((await lastReportedAtOf('ep-1', attackLabel('T1059'))).getTime()).toBeGreaterThanOrEqual(secondRunStart.getTime());
    });
  });

  describe('a replay in progress', () => {
    it('should keep the previous evidence while it runs, then update it once FINISHED', async () => {
      main.putAttack(attackDoc({ technique: 'T1003' }));
      await runSync();

      main.putAttack(attackDoc({ technique: 'T1003', simulationId: 'sim-2', simulationStartDate: NEW_START, status: 'RUNNING', succeeded: ['EDR'] }));
      await runSync();

      expect(await stateOf('ep-1', attackLabel('T1003'))).toEqual({ state: 'applicable', reason: 'Not detected by EDR in simulation Simulation sim-1' });
      expect((await evidenceOf('ep-1')).get(attackLabel('T1003'))?.simulationId).toBe('sim-1');
      expect(await historyOf('ep-1', attackLabel('T1003'))).toHaveLength(1);
      expect((await mirrorRows()).map((row) => row.simulationStatus)).toEqual(['RUNNING']);

      main.putAttack(attackDoc({ technique: 'T1003', simulationId: 'sim-2', simulationStartDate: NEW_START, status: 'FINISHED', succeeded: ['EDR'] }));
      await runSync();

      expect(await stateOf('ep-1', attackLabel('T1003'))).toEqual({ state: 'dismissed', reason: 'Detected by EDR in simulation Simulation sim-2' });
      expect((await evidenceOf('ep-1')).get(attackLabel('T1003'))?.simulationId).toBe('sim-2');
      expect((await historyOf('ep-1', attackLabel('T1003'))).map((row) => row.state)).toEqual(['applicable', 'dismissed']);
      expect((await mirrorRows()).map((row) => row.simulationStatus)).toEqual(['FINISHED']);
    });
  });

  describe('a document that disappeared', () => {
    const seedAndRemoveOne = async (): Promise<void> => {
      main.putAttack(attackDoc({ technique: 'T1003' }));
      const removed = main.putAttack(attackDoc({ technique: 'T1059' }));
      await runSync();
      expect(await stateOf('ep-1', attackLabel('T1059'))).toMatchObject({ state: 'applicable' });
      main.attack.remove(removed);
      await makeFullWalkDue();
    };

    it('should retire its evidence and mirror row after a full walk that ended ready', async () => {
      await seedAndRemoveOne();

      await runSync();

      expect(await stateOf('ep-1', attackLabel('T1059'))).toEqual({ state: 'dismissed', reason: RETIRED });
      expect(await stateOf('ep-1', attackLabel('T1003'))).toMatchObject({ state: 'applicable' });
      expect((await mirrorRows()).map((row) => row.attackPatternExternalId)).toEqual(['T1003']);
      expect((await streamState('attack')).lastFullWalkCompletedAt!.getTime()).toBeGreaterThan(daysAgo(1).getTime());
    });

    it('should keep its evidence and mirror row after a full walk that ended not ready, then retire it on the retry', async () => {
      await seedAndRemoveOne();
      main.attack.ready = false;
      const staleCompletion = (await streamState('attack')).lastFullWalkCompletedAt!;

      await runSync();

      expect(await stateOf('ep-1', attackLabel('T1059'))).toMatchObject({ state: 'applicable' });
      expect((await mirrorRows()).map((row) => row.attackPatternExternalId).sort()).toEqual(['T1003', 'T1059']);
      const notReady = await streamState('attack');
      expect(notReady.lastFullWalkCompletedAt?.getTime()).toBe(staleCompletion.getTime());
      expect(notReady.lastFullWalkAttemptedAt!.getTime()).toBeGreaterThan(daysAgo(1).getTime());
      expect(notReady.fullWalkStartedAt).toBeNull();

      // Tried again only a day later.
      const walksBefore = attackSearches().filter((request) => request.cursor === null).length;
      await runSync();
      expect(attackSearches().filter((request) => request.cursor === null)).toHaveLength(walksBefore);

      main.attack.ready = true;
      await db.update(openaevSyncStreams)
        .set({ lastFullWalkAttemptedAt: new Date(Date.now() - 25 * 3_600_000) })
        .where(eq(openaevSyncStreams.connectorId, connectorId));
      await runSync();

      expect(await stateOf('ep-1', attackLabel('T1059'))).toEqual({ state: 'dismissed', reason: RETIRED });
      expect((await mirrorRows()).map((row) => row.attackPatternExternalId)).toEqual(['T1003']);
    });
  });

  describe('a full walk that redelivers a superseded document', () => {
    it('should leave the technique the newer replay no longer plays dismissed, without a new history row', async () => {
      main.putAttack(attackDoc({ technique: 'T1003' }));
      main.putAttack(attackDoc({ technique: 'T1059' }));
      await runSync();
      main.putAttack(attackDoc({ technique: 'T1003', simulationId: 'sim-2', simulationStartDate: NEW_START }));
      await runSync();
      expect(await stateOf('ep-1', attackLabel('T1059'))).toEqual({ state: 'dismissed', reason: RETIRED });

      // OpenAEV serves the old document of T1059 again: the weekly walk starts from the beginning.
      await makeFullWalkDue();
      await runSync();

      expect(await stateOf('ep-1', attackLabel('T1059'))).toEqual({ state: 'dismissed', reason: RETIRED });
      expect(await historyOf('ep-1', attackLabel('T1059'))).toHaveLength(2);
      expect(await stateOf('ep-1', attackLabel('T1003'))).toMatchObject({ state: 'applicable' });
      expect(await historyOf('ep-1', attackLabel('T1003'))).toHaveLength(1);
    });
  });

  describe('a document that drops a platform type', () => {
    it('should keep the dropped type dismissed when another technique of the pair changes later', async () => {
      main.putAttack(attackDoc({ technique: 'T1003', reporting: ['EDR', 'SIEM'] }));
      main.putAttack(attackDoc({ technique: 'T1059' }));
      await runSync();
      expect(await stateOf('ep-1', attackLabel('T1003', 'SIEM'))).toMatchObject({ state: 'applicable' });

      main.putAttack(attackDoc({ technique: 'T1003', reporting: ['EDR'], verifiedAt: new Date() }));
      await runSync();
      expect(await stateOf('ep-1', attackLabel('T1003', 'SIEM'))).toEqual({ state: 'dismissed', reason: RETIRED });
      expect(await stateOf('ep-1', attackLabel('T1003', 'EDR'))).toMatchObject({ state: 'applicable' });

      main.putAttack(attackDoc({ technique: 'T1059', succeeded: ['EDR'], verifiedAt: new Date() }));
      await runSync();

      expect(await stateOf('ep-1', attackLabel('T1059'))).toEqual({ state: 'dismissed', reason: 'Detected by EDR in simulation Simulation sim-1' });
      expect(await stateOf('ep-1', attackLabel('T1003', 'SIEM'))).toEqual({ state: 'dismissed', reason: RETIRED });
      expect(await historyOf('ep-1', attackLabel('T1003', 'SIEM'))).toHaveLength(2);
      expect(await stateOf('ep-1', attackLabel('T1003', 'EDR'))).toMatchObject({ state: 'applicable' });
    });
  });

  describe('a run that fails after reading the attack stream', () => {
    it('should retire at the retry what a page of the failed run superseded', async () => {
      main.putAttack(attackDoc({ technique: 'T1003' }));
      main.putAttack(attackDoc({ technique: 'T1059' }));
      await runSync();

      main.putAttack(attackDoc({ technique: 'T1003', simulationId: 'sim-2', simulationStartDate: NEW_START }));
      main.vulnerability.failWith = 500;
      await expect(runSync()).rejects.toThrow();
      expect(await stateOf('ep-1', attackLabel('T1059'))).toMatchObject({ state: 'applicable' });
      expect((await streamState('attack')).unreconciledSince).not.toBeNull();

      main.vulnerability.failWith = null;
      await runSync();

      expect(await stateOf('ep-1', attackLabel('T1059'))).toEqual({ state: 'dismissed', reason: RETIRED });
      expect(await stateOf('ep-1', attackLabel('T1003'))).toMatchObject({ state: 'applicable' });
      expect((await streamState('attack')).unreconciledSince).toBeNull();
      expect((await streamState('vulnerability')).unreconciledSince).toBeNull();
    });

    it('should not note an attack walk as completed until the run that read it has retired, then finish it at the retry', async () => {
      main.putAttack(attackDoc({ technique: 'T1003' }));
      const removed = main.putAttack(attackDoc({ technique: 'T1059' }));
      await runSync();
      main.attack.remove(removed);
      await makeFullWalkDue();
      const staleCompletion = (await streamState('attack')).lastFullWalkCompletedAt!;

      main.vulnerability.failWith = 500;
      await expect(runSync()).rejects.toThrow();

      const interrupted = await streamState('attack');
      expect(interrupted.fullWalkStartedAt).not.toBeNull();
      expect(interrupted.lastFullWalkCompletedAt?.getTime()).toBe(staleCompletion.getTime());
      expect(await stateOf('ep-1', attackLabel('T1059'))).toMatchObject({ state: 'applicable' });
      expect(await mirrorRows()).toHaveLength(2);

      main.vulnerability.failWith = null;
      await runSync();

      expect(await stateOf('ep-1', attackLabel('T1059'))).toEqual({ state: 'dismissed', reason: RETIRED });
      expect(await stateOf('ep-1', attackLabel('T1003'))).toMatchObject({ state: 'applicable' });
      expect((await mirrorRows()).map((row) => row.attackPatternExternalId)).toEqual(['T1003']);
      const completed = await streamState('attack');
      expect(completed.fullWalkStartedAt).toBeNull();
      expect(completed.lastFullWalkCompletedAt!.getTime()).toBeGreaterThan(staleCompletion.getTime());
    });
  });

  describe('two OpenAEV assets folded onto one asset', () => {
    it('should keep applicable the technique only the other asset carries when the differential brings the first one alone', async () => {
      main.setEndpoints([
        { id: 'ep-1', name: 'server-1', hostname: 'server-1.test', macAddresses: ['aa:bb:cc:dd:ee:01'] },
        { id: 'ep-2', name: 'server-1-bis', hostname: 'server-1.test', macAddresses: ['aa:bb:cc:dd:ee:01'] },
      ]);
      main.putAttack(attackDoc({ assetId: 'ep-1', technique: 'T1003' }));
      main.putAttack(attackDoc({ assetId: 'ep-2', technique: 'T1059' }));
      await runSync();
      expect(await supportingAssetIdOf('ep-2')).toBe(await supportingAssetIdOf('ep-1'));
      expect(await stateOf('ep-1', attackLabel('T1059'))).toMatchObject({ state: 'applicable' });

      main.putAttack(attackDoc({ assetId: 'ep-1', technique: 'T1003', succeeded: ['EDR'], verifiedAt: new Date() }));
      await runSync();

      expect(await stateOf('ep-1', attackLabel('T1003'))).toEqual({ state: 'dismissed', reason: 'Detected by EDR in simulation Simulation sim-1' });
      expect(await stateOf('ep-1', attackLabel('T1059'))).toMatchObject({ state: 'applicable' });
      expect(await historyOf('ep-1', attackLabel('T1059'))).toHaveLength(1);
    });
  });

  describe('a first backfill that serves the superseded document first', () => {
    it('should retire it at the end of the run, even though its page came before the one that supersedes it', async () => {
      main.attack.maxPageSize = 1;
      main.putAttack(attackDoc({ technique: 'T1059' }));
      main.putAttack(attackDoc({ technique: 'T1003', simulationId: 'sim-2', simulationStartDate: NEW_START }));

      await runSync();

      expect(attackSearches().filter((request) => request.cursor === null)).toHaveLength(1);
      expect(await stateOf('ep-1', attackLabel('T1059'))).toEqual({ state: 'dismissed', reason: RETIRED });
      expect(await stateOf('ep-1', attackLabel('T1003'))).toMatchObject({ state: 'applicable' });
    });
  });

  describe('CVE evidence', () => {
    it('should retire the CVEs an asset no longer reports once it receives a new one, and leave other assets alone', async () => {
      main.putVulnerability({ assetId: 'ep-1', cve: 'CVE-2024-1111', verifiedAt: daysAgo(2) });
      main.putVulnerability({ assetId: 'ep-1', cve: 'CVE-2024-2222', verifiedAt: daysAgo(2) });
      main.putVulnerability({ assetId: 'ep-2', cve: 'CVE-2024-9999', verifiedAt: daysAgo(2) });
      await runSync();
      expect(await stateOf('ep-1', 'CVE-2024-1111')).toMatchObject({ state: 'applicable' });

      main.putVulnerability({ assetId: 'ep-1', cve: 'CVE-2024-3333', verifiedAt: new Date() });
      await runSync();

      expect(await stateOf('ep-1', 'CVE-2024-3333')).toMatchObject({ state: 'applicable' });
      expect(await stateOf('ep-1', 'CVE-2024-1111')).toEqual({ state: 'dismissed', reason: RETIRED });
      expect(await stateOf('ep-1', 'CVE-2024-2222')).toEqual({ state: 'dismissed', reason: RETIRED });
      expect(await stateOf('ep-2', 'CVE-2024-9999')).toMatchObject({ state: 'applicable' });
    });
  });

  describe('OpenAEV assets folded onto one asset, as far as their CVEs go', () => {
    const MAC = 'aa:bb:cc:dd:ee:09';

    /** One OpenCRQ asset, fed by the endpoint `first` of the main tenant and the endpoint `second` of `secondTenant`. */
    const foldEndpoints = (second: { tenant: FakeOpenaevTenant, id: string }) => {
      main.setEndpoints([{ id: 'ep-1', name: 'folded', hostname: 'folded.test', macAddresses: [MAC] }, ...(second.tenant === main ? [{ id: second.id, name: 'folded-bis', hostname: 'folded.test', macAddresses: [MAC] }] : [])]);
      if (second.tenant !== main) {
        second.tenant.setEndpoints([{ id: second.id, name: 'folded-bis', hostname: 'folded.test', macAddresses: [MAC] }]);
      }
    };

    const seedAndRun = async (second: { tenant: FakeOpenaevTenant, id: string }) => {
      foldEndpoints(second);
      main.putVulnerability({ assetId: 'ep-1', cve: 'CVE-2024-0001', verifiedAt: daysAgo(2) });
      second.tenant.putVulnerability({ assetId: second.id, cve: 'CVE-2024-0002', verifiedAt: daysAgo(2) });
      await runSync();
      expect(await supportingAssetIdOf(second.id)).toBe(await supportingAssetIdOf('ep-1'));
      expect(await stateOf('ep-1', 'CVE-2024-0001')).toMatchObject({ state: 'applicable' });
      expect(await stateOf('ep-1', 'CVE-2024-0002')).toMatchObject({ state: 'applicable' });
    };

    it('should keep the CVE of an asset of another OpenAEV tenant when the full walk of the first one ends', async () => {
      const other = fake.addTenant('oaev-other', 'Other');
      await seedAndRun({ tenant: other, id: 'ey-1' });
      const gone = main.putVulnerability({ assetId: 'ep-1', cve: 'CVE-2024-0003', verifiedAt: daysAgo(2) });
      await runSync();
      expect(await stateOf('ep-1', 'CVE-2024-0003')).toMatchObject({ state: 'applicable' });
      main.vulnerability.remove(gone);
      await makeFullWalkDue(OAEV_TENANT);

      await runSync();

      expect(await stateOf('ep-1', 'CVE-2024-0003')).toEqual({ state: 'dismissed', reason: RETIRED });
      expect(await stateOf('ep-1', 'CVE-2024-0001')).toMatchObject({ state: 'applicable' });
      expect(await stateOf('ep-1', 'CVE-2024-0002')).toMatchObject({ state: 'applicable' });
      expect(await historyOf('ep-1', 'CVE-2024-0002')).toHaveLength(1);
    });

    it('should retire only what the first OpenAEV tenant stopped reporting when its differential brings a new CVE', async () => {
      const other = fake.addTenant('oaev-other', 'Other');
      await seedAndRun({ tenant: other, id: 'ey-1' });

      main.putVulnerability({ assetId: 'ep-1', cve: 'CVE-2024-0004', verifiedAt: new Date() });
      await runSync();

      expect(await stateOf('ep-1', 'CVE-2024-0004')).toMatchObject({ state: 'applicable' });
      expect(await stateOf('ep-1', 'CVE-2024-0001')).toEqual({ state: 'dismissed', reason: RETIRED });
      expect(await stateOf('ep-1', 'CVE-2024-0002')).toMatchObject({ state: 'applicable' });
      expect(await historyOf('ep-1', 'CVE-2024-0002')).toHaveLength(1);
    });

    it('should keep the CVE a cut walk delivered when the walk of the first OpenAEV tenant ends, and the second tenant then reads a differential', async () => {
      const other = fake.addTenant('oaev-other', 'Other');
      foldEndpoints({ tenant: other, id: 'ey-1' });
      other.putVulnerability({ assetId: 'ey-1', cve: 'CVE-2024-0002', verifiedAt: daysAgo(2) });
      await runSync();
      expect(await supportingAssetIdOf('ey-1')).toBe(await supportingAssetIdOf('ep-1'));

      // One document per page: the walk of the first tenant delivers the first CVE in a run that is
      // cut, and the second in the next one, where it ends ready.
      main.vulnerability.maxPageSize = 1;
      main.putVulnerability({ assetId: 'ep-1', cve: 'CVE-2024-0001', verifiedAt: daysAgo(2) });
      main.putVulnerability({ assetId: 'ep-1', cve: 'CVE-2024-0003', verifiedAt: daysAgo(2) });
      await makeFullWalkDue(OAEV_TENANT);
      await runSync(/vulnerability observations of tenant oaev-main, page 1$/);
      expect((await streamState('vulnerability')).fullWalkStartedAt).not.toBeNull();
      expect(await stateOf('ep-1', 'CVE-2024-0001')).toMatchObject({ state: 'applicable' });
      expect(await stateOf('ep-1', 'CVE-2024-0003')).toBeUndefined();

      await runSync();

      expect((await streamState('vulnerability')).fullWalkStartedAt).toBeNull();
      const otherReads = fake.requestsTo('POST', '/snapshot/vulnerability-observations/search', 'oaev-other');
      expect(otherReads.at(-1)?.cursor).toEqual(expect.any(String));
      for (const cve of ['CVE-2024-0001', 'CVE-2024-0002', 'CVE-2024-0003']) {
        expect(await stateOf('ep-1', cve)).toMatchObject({ state: 'applicable' });
        expect(await historyOf('ep-1', cve)).toHaveLength(1);
      }
    });

    it('should do the same for two OpenAEV assets of one OpenAEV tenant', async () => {
      await seedAndRun({ tenant: main, id: 'ep-2' });

      main.putVulnerability({ assetId: 'ep-1', cve: 'CVE-2024-0004', verifiedAt: new Date() });
      await runSync();

      expect(await stateOf('ep-1', 'CVE-2024-0004')).toMatchObject({ state: 'applicable' });
      expect(await stateOf('ep-1', 'CVE-2024-0001')).toEqual({ state: 'dismissed', reason: RETIRED });
      expect(await stateOf('ep-1', 'CVE-2024-0002')).toMatchObject({ state: 'applicable' });
      expect(await historyOf('ep-1', 'CVE-2024-0002')).toHaveLength(1);
    });

    it('should keep a CVE two of the OpenAEV assets report applicable while one of them still does', async () => {
      await seedAndRun({ tenant: main, id: 'ep-2' });
      const second = main.putVulnerability({ assetId: 'ep-2', cve: 'CVE-2024-0001', verifiedAt: daysAgo(1) });
      await runSync();

      main.vulnerability.remove(second);
      main.putVulnerability({ assetId: 'ep-2', cve: 'CVE-2024-0005', verifiedAt: new Date() });
      await runSync();

      expect(await stateOf('ep-1', 'CVE-2024-0001')).toMatchObject({ state: 'applicable' });
    });
  });

  describe('a vulnerability walk that spans two runs', () => {
    it('should dismiss no CVE of an asset whose CVEs straddle the runs, and retire only what the walk never re-delivered', async () => {
      main.putVulnerability({ assetId: 'ep-1', cve: 'CVE-2024-0001', verifiedAt: daysAgo(2) });
      main.putVulnerability({ assetId: 'ep-2', cve: 'CVE-2024-0003', verifiedAt: daysAgo(2) });
      main.putVulnerability({ assetId: 'ep-1', cve: 'CVE-2024-0002', verifiedAt: daysAgo(2) });
      const gone = main.putVulnerability({ assetId: 'ep-1', cve: 'CVE-2024-0004', verifiedAt: daysAgo(2) });
      await runSync();
      expect(await stateOf('ep-1', 'CVE-2024-0004')).toMatchObject({ state: 'applicable' });

      // One document per page, in the order 0001 (ep-1), 0003 (ep-2), 0002 (ep-1): the second CVE of
      // ep-1 only arrives in the run after the one that delivered its first.
      main.vulnerability.remove(gone);
      main.vulnerability.maxPageSize = 1;
      await makeFullWalkDue();
      await runSync(/vulnerability observations.*page 1$/);

      expect((await streamState('vulnerability')).fullWalkStartedAt).not.toBeNull();
      for (const [sourceAssetId, cve] of [['ep-1', 'CVE-2024-0001'], ['ep-1', 'CVE-2024-0002'], ['ep-2', 'CVE-2024-0003'], ['ep-1', 'CVE-2024-0004']] as const) {
        expect(await stateOf(sourceAssetId, cve)).toMatchObject({ state: 'applicable' });
      }
      const resumedFrom = fake.requestsTo('POST', '/snapshot/vulnerability-observations/search', OAEV_TENANT).length;

      await runSync();

      const resumed = fake.requestsTo('POST', '/snapshot/vulnerability-observations/search', OAEV_TENANT).slice(resumedFrom);
      expect(resumed[0]?.cursor).toEqual(expect.any(String));
      expect((await streamState('vulnerability')).fullWalkStartedAt).toBeNull();
      expect(await stateOf('ep-1', 'CVE-2024-0004')).toEqual({ state: 'dismissed', reason: RETIRED });
      expect(await historyOf('ep-1', 'CVE-2024-0004')).toHaveLength(2);
      for (const [sourceAssetId, cve] of [['ep-1', 'CVE-2024-0001'], ['ep-1', 'CVE-2024-0002'], ['ep-2', 'CVE-2024-0003']] as const) {
        expect(await stateOf(sourceAssetId, cve)).toMatchObject({ state: 'applicable' });
        // Never dismissed, so never brought back: a single applicable row, no flap.
        expect(await historyOf(sourceAssetId, cve)).toEqual([{ state: 'applicable', reason: expect.any(String) }]);
      }
    });
  });

  describe('two OpenAEV tenants', () => {
    it('should retire only what the full walk of its own tenant proves gone', async () => {
      main.setEndpoints([
        { id: 'ex-1', name: 'x-1', hostname: 'x-1.test' },
        { id: 'ex-2', name: 'x-2', hostname: 'x-2.test' },
      ]);
      const other = fake.addTenant('oaev-other', 'Other');
      other.setEndpoints([
        { id: 'ey-1', name: 'y-1', hostname: 'y-1.test' },
        { id: 'ey-2', name: 'y-2', hostname: 'y-2.test' },
      ]);

      for (const [tenant, prefix] of [[main, 'ex'], [other, 'ey']] as const) {
        tenant.putAttack(attackDoc({ assetId: `${prefix}-1`, technique: 'T1003' }));
        tenant.putAttack(attackDoc({ assetId: `${prefix}-1`, technique: 'T1059' }));
        tenant.putAttack(attackDoc({ assetId: `${prefix}-2`, scenarioId: 'scn-2', technique: 'T1003' }));
        tenant.putVulnerability({ assetId: `${prefix}-1`, cve: 'CVE-2024-5555', verifiedAt: daysAgo(2) });
      }
      await runSync();
      for (const prefix of ['ex', 'ey']) {
        expect(await stateOf(`${prefix}-2`, attackLabel('T1003', 'EDR', 'scn-2'))).toMatchObject({ state: 'applicable' });
        expect(await stateOf(`${prefix}-1`, 'CVE-2024-5555')).toMatchObject({ state: 'applicable' });
      }
      const otherCompletion = (await streamState('attack', 'oaev-other')).lastFullWalkCompletedAt!;

      // OpenAEV stopped serving the same documents on both sides, but only one tenant is walked.
      for (const [tenant, prefix] of [[main, 'ex'], [other, 'ey']] as const) {
        tenant.attack.remove(tenant.attackIdOf(attackDoc({ assetId: `${prefix}-2`, scenarioId: 'scn-2', technique: 'T1003' })));
        tenant.vulnerability.remove(tenant.vulnerabilityIdOf({ assetId: `${prefix}-1`, cve: 'CVE-2024-5555', verifiedAt: daysAgo(2) }));
      }
      await makeFullWalkDue(OAEV_TENANT);

      await runSync();

      expect(await stateOf('ex-2', attackLabel('T1003', 'EDR', 'scn-2'))).toEqual({ state: 'dismissed', reason: RETIRED });
      expect(await stateOf('ex-1', 'CVE-2024-5555')).toEqual({ state: 'dismissed', reason: RETIRED });
      expect(await stateOf('ex-1', attackLabel('T1003'))).toMatchObject({ state: 'applicable' });
      expect(await stateOf('ex-1', attackLabel('T1059'))).toMatchObject({ state: 'applicable' });
      for (const [sourceAssetId, label] of [['ey-1', attackLabel('T1003')], ['ey-1', attackLabel('T1059')], ['ey-2', attackLabel('T1003', 'EDR', 'scn-2')], ['ey-1', 'CVE-2024-5555']] as const) {
        expect(await stateOf(sourceAssetId, label)).toMatchObject({ state: 'applicable' });
      }
      expect((await streamState('attack', 'oaev-other')).lastFullWalkCompletedAt?.getTime()).toBe(otherCompletion.getTime());
    });
  });

  describe('a reset followed by a run where the walk of one OpenAEV tenant does not complete', () => {
    const seedBothTenants = async (): Promise<FakeOpenaevTenant> => {
      const second = fake.addTenant('oaev-other', 'Other');
      second.setEndpoints([{ id: 'ey-1', name: 'y-1', hostname: 'y-1.test' }]);
      main.putAttack(attackDoc({ technique: 'T1003' }));
      second.putAttack(attackDoc({ assetId: 'ey-1', technique: 'T1003' }));
      second.putAttack(attackDoc({ assetId: 'ey-1', technique: 'T1059' }));
      await runSync();
      for (const [sourceAssetId, technique] of [['ep-1', 'T1003'], ['ey-1', 'T1003'], ['ey-1', 'T1059']] as const) {
        expect(await stateOf(sourceAssetId, attackLabel(technique))).toMatchObject({ state: 'applicable' });
      }
      await services.withOrigin(adminOrigin).integrationSettings.clearSyncWatermark('openaev');
      await services.withOrigin(adminOrigin).openaevConnector.resetState(connectorId);
      return second;
    };

    const expectSecondTenantUntouched = async (): Promise<void> => {
      for (const technique of ['T1003', 'T1059']) {
        expect(await stateOf('ey-1', attackLabel(technique))).toMatchObject({ state: 'applicable' });
        expect(await historyOf('ey-1', attackLabel(technique))).toHaveLength(1);
      }
    };

    it('should keep the evidence of the second tenant when its walk is not ready', async () => {
      const second = await seedBothTenants();
      second.attack.ready = false;

      await runSync();

      expect((await streamState('attack')).lastFullWalkCompletedAt).not.toBeNull();
      expect((await streamState('attack', 'oaev-other')).lastFullWalkCompletedAt).toBeNull();
      await expectSecondTenantUntouched();
    });

    it('should keep the evidence of the second tenant when its walk is cut after the first page', async () => {
      const second = await seedBothTenants();
      second.attack.maxPageSize = 1;

      await runSync(/attack observations of tenant oaev-other, page 1$/);

      expect((await streamState('attack')).lastFullWalkCompletedAt).not.toBeNull();
      expect((await streamState('attack', 'oaev-other')).fullWalkStartedAt).not.toBeNull();
      await expectSecondTenantUntouched();
    });

    it('should keep the evidence of the second tenant when the first tenant\'s next walk ends ready while the second\'s is half read', async () => {
      const second = await seedBothTenants();
      second.attack.maxPageSize = 1;
      await runSync(/attack observations of tenant oaev-other, page 1$/);
      await makeFullWalkDue(OAEV_TENANT);

      await runSync();

      expect((await streamState('attack', 'oaev-other')).lastFullWalkCompletedAt).not.toBeNull();
      await expectSecondTenantUntouched();
    });

    it('should retire the evidence of a document the second tenant no longer serves once its own walk completes', async () => {
      const second = await seedBothTenants();
      second.attack.remove(second.attackIdOf(attackDoc({ assetId: 'ey-1', technique: 'T1059' })));

      await runSync();

      expect(await stateOf('ey-1', attackLabel('T1003'))).toMatchObject({ state: 'applicable' });
      expect(await stateOf('ey-1', attackLabel('T1059'))).toEqual({ state: 'dismissed', reason: RETIRED });
    });
  });

  describe('an asset OpenAEV stopped listing', () => {
    it('should leave the description candidates, and have its CVE retired by the inventory that no longer lists it', async () => {
      main.setGenericAssets([{ id: 'app-1', name: 'Payroll', category: 'saas_application', description: 'The payroll application' }]);
      main.putVulnerability({ assetId: 'app-1', cve: 'CVE-2024-0100', verifiedAt: daysAgo(2) });
      main.putVulnerability({ assetId: 'ep-1', cve: 'CVE-2024-0101', verifiedAt: daysAgo(2) });
      await runSync();
      expect(await stateOf('app-1', 'CVE-2024-0100')).toMatchObject({ state: 'applicable' });
      const fetchesBefore = fake.requestsTo('GET', '/assets/app-1', OAEV_TENANT).length;
      expect(fetchesBefore).toBe(1);

      // OpenAEV deletes the asset's documents with it; no stream read is needed to see it go.
      main.setGenericAssets([]);
      await makeDescriptionsDue();
      await db.update(integrationSettings).set({ lastReportedAt: daysAgo(2) }).where(eq(integrationSettings.id, connectorId));
      await runSync();

      const registered = await db.select().from(openaevAssets).where(eq(openaevAssets.connectorId, connectorId));
      expect(registered.map((row) => row.sourceAssetId).sort()).toEqual(['ep-1', 'ep-2']);
      expect(await services.withOrigin(adminOrigin).openaevConnector.listDescriptionCandidates({ connectorId, openaevTenantId: OAEV_TENANT, limit: 100 })).toEqual([]);
      expect(fake.requestsTo('GET', '/assets/app-1', OAEV_TENANT)).toHaveLength(fetchesBefore);
      expect(await stateOf('app-1', 'CVE-2024-0100')).toEqual({ state: 'dismissed', reason: RETIRED });
      expect(await stateOf('ep-1', 'CVE-2024-0101')).toMatchObject({ state: 'applicable' });
    });

    it('should neither retire nor unregister an asset the pages skipped when OpenAEV deleted another one during the read', async () => {
      const [first, second, third] = [
        { id: 'ep-1', name: 'server-1', hostname: 'server-1.test' },
        { id: 'ep-2', name: 'server-2', hostname: 'server-2.test' },
        { id: 'ep-3', name: 'server-3', hostname: 'server-3.test' },
      ];
      main.setEndpoints([first, second, third]);
      main.putVulnerability({ assetId: 'ep-2', cve: 'CVE-2024-0102', verifiedAt: daysAgo(2) });
      await runSync();
      expect(await stateOf('ep-2', 'CVE-2024-0102')).toMatchObject({ state: 'applicable' });

      // Deleting the asset the first page served shifts the second page past ep-2.
      main.assetPageSize = 1;
      main.onAssetPage = (page) => {
        if (page === 0) {
          main.setEndpoints([second, third]);
        }
      };
      await db.update(integrationSettings).set({ lastReportedAt: daysAgo(2) }).where(eq(integrationSettings.id, connectorId));
      await runSync();

      const registered = await db.select().from(openaevAssets).where(eq(openaevAssets.connectorId, connectorId));
      expect(registered.map((row) => row.sourceAssetId).sort()).toEqual(['ep-1', 'ep-2', 'ep-3']);
      expect(await stateOf('ep-2', 'CVE-2024-0102')).toMatchObject({ state: 'applicable' });
    });

    it('should neither retire nor unregister an asset the pages skipped when OpenAEV deleted one and created another during the read', async () => {
      const [first, second, third] = [
        { id: 'ep-1', name: 'server-1', hostname: 'server-1.test' },
        { id: 'ep-2', name: 'server-2', hostname: 'server-2.test' },
        { id: 'ep-3', name: 'server-3', hostname: 'server-3.test' },
      ];
      main.setEndpoints([first, second, third]);
      main.putVulnerability({ assetId: 'ep-2', cve: 'CVE-2024-0102', verifiedAt: daysAgo(2) });
      await runSync();

      // The count stays at three, and the pages list ep-1, ep-3 and ep-4 but skip ep-2.
      main.assetPageSize = 1;
      main.onAssetPage = (page) => {
        if (page === 0) {
          main.setEndpoints([second, third, { id: 'ep-4', name: 'server-4', hostname: 'server-4.test' }]);
        }
      };
      await db.update(integrationSettings).set({ lastReportedAt: daysAgo(2) }).where(eq(integrationSettings.id, connectorId));
      await runSync();

      const registered = await db.select().from(openaevAssets).where(eq(openaevAssets.connectorId, connectorId));
      expect(registered.map((row) => row.sourceAssetId).sort()).toEqual(['ep-1', 'ep-2', 'ep-3', 'ep-4']);
      expect(await stateOf('ep-2', 'CVE-2024-0102')).toMatchObject({ state: 'applicable' });
    });

    it('should neither retire nor unregister anything when the inventory listed no asset at all', async () => {
      main.setGenericAssets([{ id: 'app-1', name: 'Payroll', category: 'saas_application', description: 'The payroll application' }]);
      main.putVulnerability({ assetId: 'app-1', cve: 'CVE-2024-0100', verifiedAt: daysAgo(2) });
      await runSync();

      main.setEndpoints([]);
      main.setGenericAssets([]);
      await db.update(integrationSettings).set({ lastReportedAt: daysAgo(2) }).where(eq(integrationSettings.id, connectorId));
      await runSync();

      const registered = await db.select().from(openaevAssets).where(eq(openaevAssets.connectorId, connectorId));
      expect(registered.map((row) => row.sourceAssetId).sort()).toEqual(['app-1', 'ep-1', 'ep-2']);
      expect(await stateOf('app-1', 'CVE-2024-0100')).toMatchObject({ state: 'applicable' });
    });
  });

  describe('the run right after the upgrade, before any inventory registered the OpenAEV assets', () => {
    it('should retire neither the CVEs nor the attack evidence of a tenant whose walk is not ready when another one ends ready', async () => {
      const second = fake.addTenant('oaev-other', 'Other');
      second.setEndpoints([{ id: 'ey-1', name: 'y-1', hostname: 'y-1.test' }]);
      main.putAttack(attackDoc({ technique: 'T1003' }));
      main.putVulnerability({ assetId: 'ep-1', cve: 'CVE-2024-0001', verifiedAt: daysAgo(2) });
      second.putAttack(attackDoc({ assetId: 'ey-1', technique: 'T1003' }));
      second.putAttack(attackDoc({ assetId: 'ey-1', technique: 'T1059' }));
      second.putVulnerability({ assetId: 'ey-1', cve: 'CVE-2024-0002', verifiedAt: daysAgo(2) });
      await runSync();

      // What main left behind: sources and evidence, with none of the tables this connector added.
      await db.delete(openaevAssets).where(eq(openaevAssets.connectorId, connectorId));
      await db.delete(openaevSyncStreams).where(eq(openaevSyncStreams.connectorId, connectorId));
      await db.delete(openaevAttackObservations).where(eq(openaevAttackObservations.connectorId, connectorId));
      second.attack.ready = false;
      second.vulnerability.ready = false;
      const inventoriesBefore = fake.requestsTo('POST', '/assets/search', OAEV_TENANT).length;

      await runSync();

      expect(fake.requestsTo('POST', '/assets/search', OAEV_TENANT)).toHaveLength(inventoriesBefore);
      expect((await streamState('attack')).lastFullWalkCompletedAt).not.toBeNull();
      expect((await streamState('attack', 'oaev-other')).lastFullWalkCompletedAt).toBeNull();
      for (const label of [attackLabel('T1003'), attackLabel('T1059'), 'CVE-2024-0002']) {
        expect(await stateOf('ey-1', label)).toMatchObject({ state: 'applicable' });
        expect(await historyOf('ey-1', label)).toHaveLength(1);
      }
      expect(await stateOf('ep-1', attackLabel('T1003'))).toMatchObject({ state: 'applicable' });
      expect(await stateOf('ep-1', 'CVE-2024-0001')).toMatchObject({ state: 'applicable' });
    });
  });

  describe('asset descriptions', () => {
    const descriptionOf = async (sourceAssetId: string) => {
      const [source] = await db.select({ reportedDescription: supportingAssetSources.reportedDescription })
        .from(supportingAssetSources)
        .where(and(eq(supportingAssetSources.connectorId, connectorId), eq(supportingAssetSources.sourceAssetId, sourceAssetId)));
      return source?.reportedDescription;
    };
    const overviewOf = async (sourceAssetId: string) => {
      const [source] = await db.select({ url: supportingAssetSources.reportedUrl, linkedPerson: supportingAssetSources.reportedLinkedPerson })
        .from(supportingAssetSources)
        .where(and(eq(supportingAssetSources.connectorId, connectorId), eq(supportingAssetSources.sourceAssetId, sourceAssetId)));
      return source;
    };
    const assetDescriptionOf = async (sourceAssetId: string) => {
      const [asset] = await db.select({ description: supportingAssets.description })
        .from(supportingAssets)
        .where(eq(supportingAssets.id, await supportingAssetIdOf(sourceAssetId)));
      return asset?.description;
    };
    const fetchesOf = (sourceAssetId: string) => fake.requestsTo('GET', `/assets/${sourceAssetId}`, OAEV_TENANT);

    beforeEach(() => {
      main.setUsers([{ id: 'user-1', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@acme.test' }]);
      main.setGenericAssets([{
        id: 'app-1', name: 'Payroll', category: 'saas_application', description: '  The payroll application  ',
        url: 'https://payroll.acme.test', linkedPerson: 'user-1',
      }]);
    });

    it('should leave the inventory without a description call and fill the description in the same run, after the observations', async () => {
      main.putAttack(attackDoc({ technique: 'T1003' }));

      await runSync();

      expect(await descriptionOf('app-1')).toBe('The payroll application');
      expect(await assetDescriptionOf('app-1')).toBe('The payroll application');
      expect(fetchesOf('app-1')).toHaveLength(1);
      const order = fake.requests.map((request) => request.route);
      expect(order.indexOf('/assets/app-1')).toBeGreaterThan(order.lastIndexOf('/snapshot/attack-observations/search'));
      expect(order.indexOf('/assets/app-1')).toBeGreaterThan(order.indexOf('/assets/search'));
      expect(fetchesOf('ep-1')).toHaveLength(0);
    });

    it('should fill the url and the linked person name too', async () => {
      await runSync();

      expect(await overviewOf('app-1')).toEqual({ url: 'https://payroll.acme.test', linkedPerson: 'Ada Lovelace' });
    });

    it('should keep the description, the url and the linked person when the inventory runs again, and fetch no more than once per run', async () => {
      await runSync();
      await makeDescriptionsDue();
      await db.update(integrationSettings).set({ lastReportedAt: daysAgo(2) }).where(eq(integrationSettings.id, connectorId));

      await runSync();

      expect(fake.requestsTo('POST', '/assets/search', OAEV_TENANT)).toHaveLength(2);
      expect(await overviewOf('app-1')).toEqual({ url: 'https://payroll.acme.test', linkedPerson: 'Ada Lovelace' });
      expect(await descriptionOf('app-1')).toBe('The payroll application');
      expect(await assetDescriptionOf('app-1')).toBe('The payroll application');
      expect(fetchesOf('app-1')).toHaveLength(2);
    });

    it('should clear the description, the url and the linked person when they are emptied in OpenAEV', async () => {
      await runSync();
      await makeDescriptionsDue();
      main.setGenericAssets([{ id: 'app-1', name: 'Payroll', category: 'saas_application', description: null }]);

      await runSync();

      expect(await overviewOf('app-1')).toEqual({ url: null, linkedPerson: null });
      expect(await descriptionOf('app-1')).toBeNull();
      expect(await assetDescriptionOf('app-1')).toBeNull();
    });

    it('should keep the description of an asset OpenAEV no longer knows, and still fetch the others', async () => {
      main.setGenericAssets([
        { id: 'app-1', name: 'Payroll', category: 'saas_application', description: 'The payroll application' },
        { id: 'app-2', name: 'Wiki', category: 'saas_application', description: 'The wiki' },
      ]);
      await runSync();
      await makeDescriptionsDue();
      main.setGenericAssets([{ id: 'app-2', name: 'Wiki', category: 'saas_application', description: 'The new wiki' }]);

      await runSync();

      expect(await descriptionOf('app-1')).toBe('The payroll application');
      expect(await descriptionOf('app-2')).toBe('The new wiki');
    });

    it('should fetch the asset the previous run fetched longest ago first, never-fetched ones before', async () => {
      await runSync();
      await makeDescriptionsDue();
      main.setGenericAssets([
        { id: 'app-1', name: 'Payroll', category: 'saas_application', description: 'The payroll application' },
        { id: 'app-2', name: 'Wiki', category: 'saas_application', description: 'The wiki' },
      ]);
      await db.update(integrationSettings).set({ lastReportedAt: daysAgo(2) }).where(eq(integrationSettings.id, connectorId));
      const before = fake.requests.length;

      await runSync();

      const descriptionCalls = fake.requests.slice(before).filter((request) => request.method === 'GET' && request.route.startsWith('/assets/')).map((request) => request.route);
      expect(descriptionCalls).toEqual(['/assets/app-2', '/assets/app-1']);
    });
  });

  describe('resetting the connector', () => {
    it('should rebuild the inventory and walk both streams from the start on the next run', async () => {
      main.putAttack(attackDoc({ technique: 'T1003' }));
      main.putAttack(attackDoc({ assetId: 'ep-2', scenarioId: 'scn-2', technique: 'T1003' }));
      await runSync();
      await runSync();
      expect(fake.requestsTo('POST', '/assets/search', OAEV_TENANT)).toHaveLength(1);
      expect(attackSearches().filter((request) => request.cursor !== null)).toHaveLength(1);

      // The only document of its (asset, scenario) pair: only a full walk can prove it gone.
      main.attack.remove(main.attackIdOf(attackDoc({ assetId: 'ep-2', scenarioId: 'scn-2', technique: 'T1003' })));
      await services.withOrigin(adminOrigin).integrationSettings.clearSyncWatermark('openaev');
      await services.withOrigin(adminOrigin).openaevConnector.resetState(connectorId);
      expect(await streamStates()).toEqual([]);
      expect(await mirrorRows()).toEqual([]);
      const searchesBefore = attackSearches().length;

      await runSync();

      expect(fake.requestsTo('POST', '/assets/search', OAEV_TENANT)).toHaveLength(2);
      expect(attackSearches().slice(searchesBefore).map((request) => request.body)).toEqual([{ page_size: 1000 }]);
      expect(await stateOf('ep-2', attackLabel('T1003', 'EDR', 'scn-2'))).toEqual({ state: 'dismissed', reason: RETIRED });
      expect(await stateOf('ep-1', attackLabel('T1003'))).toMatchObject({ state: 'applicable' });
      expect(await streamState('attack')).toMatchObject({ lastFullWalkCompletedAt: expect.any(Date) });
      const [settings] = await db.select().from(integrationSettings).where(eq(integrationSettings.id, connectorId));
      expect(settings?.lastReportedAt).not.toBeNull();
    });
  });
});
