import type { EventOrigin } from '@app/module';
import { assetEvidenceHistory, integrationSettings, NonRetryableError, openaevAssets, openaevAttackObservations, openaevSyncStreams } from '@app/module';
import { createJobContext } from '@app/back/src/engines/job-runtime/job-context-factory';
import { openaevSyncHandler } from '@app/back/src/features/openaev-sync/openaev-sync-handler';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeOpenaevLegacy } from '../../helpers/fake-openaev-legacy';
import type { FakeOpenaevTenant } from '../../helpers/fake-openaev';
import { createTenantWithAdmin } from '../../helpers/factories';
import { evidenceRowsOfAsset } from '../../helpers/evidence-rows';
import { expectReplayedSyncSilent } from '../../helpers/replayed-sync';
import { startFakeOpenaevLegacy } from '../../helpers/fake-openaev-legacy';
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

/** The label an evidence is read back under: technique, expectation type, platform type and scenario, or the CVE identifier. */
const attackLabel = (technique: string, platformType = 'EDR', scenarioId = 'scn-1', expectationType = 'detection') =>
  `${technique}/${expectationType}/${platformType}/${scenarioId}`;

describe('OpenAEV sync without the snapshot export, against a fake OpenAEV', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;
  let serviceAccountId: string;
  let connectorId: string;
  let fake: FakeOpenaevLegacy;
  let main: FakeOpenaevTenant;

  const runSync = async (): Promise<void> => {
    const ctx = createJobContext({
      jobId: uuidv7(),
      tenantId,
      kind: 'openaev-findings-sync',
      interactive: false,
      payload: {},
      attempt: 1,
      state: null,
      signal: new AbortController().signal,
      deps: {
        updateProgress: () => Promise.resolve(),
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

  /** Every evidence row of an asset, one per (technique, type, platform type, scenario) or CVE. */
  const evidenceRowsOf = async (sourceAssetId: string) =>
    (await evidenceRowsOfAsset(await supportingAssetIdOf(sourceAssetId)))
      .map((row) => ({
        id: row.id,
        label: row.cveId ?? attackLabel(row.mitreTechniqueExternalId ?? '', row.securityPlatformType ?? '', row.sourceScenarioId ?? '', row.expectationType ?? ''),
        state: row.currentState ?? 'none',
        reason: row.stateReason,
      }));

  const stateOf = async (sourceAssetId: string, label: string) => {
    const row = (await evidenceRowsOf(sourceAssetId)).find((candidate) => candidate.label === label);
    return row === undefined ? undefined : { state: row.state, reason: row.reason };
  };

  const labelsOf = async (sourceAssetId: string) => (await evidenceRowsOf(sourceAssetId)).map((row) => row.label).sort();

  const historyLengthOf = async (sourceAssetId: string, label: string): Promise<number> => {
    const row = (await evidenceRowsOf(sourceAssetId)).find((candidate) => candidate.label === label);
    if (row === undefined) {
      throw new Error(`no evidence ${label} on ${sourceAssetId}`);
    }
    return (await db.select().from(assetEvidenceHistory).where(eq(assetEvidenceHistory.assetEvidenceId, row.id))).length;
  };

  const lastReportedAt = async (): Promise<Date | null> => {
    const [settings] = await db.select().from(integrationSettings).where(eq(integrationSettings.id, connectorId));
    return settings?.lastReportedAt ?? null;
  };

  const streamStates = () => db.select().from(openaevSyncStreams).where(eq(openaevSyncStreams.connectorId, connectorId));
  const mirrorRows = () => db.select().from(openaevAttackObservations).where(eq(openaevAttackObservations.connectorId, connectorId));
  const registeredAssets = () => db.select().from(openaevAssets).where(eq(openaevAssets.connectorId, connectorId));

  /** Both exercises and findings the legacy path reads: ep-1 failed to detect T1003 and T1059 in the scenario `scn-1`, and reports one CVE. */
  const serveLegacyData = (): void => {
    fake.setExercises(OAEV_TENANT, [{
      id: 'sim-1',
      scenarioId: 'scn-1',
      updatedAt: daysAgo(1),
      expectations: [
        { assetId: 'ep-1', technique: 'T1003', results: [{ platform: 'EDR', score: 0 }] },
        { assetId: 'ep-1', technique: 'T1059', results: [{ platform: 'EDR', score: 0 }] },
      ],
    }]);
    fake.setFindings(OAEV_TENANT, [{ id: 'finding-1', assetId: 'ep-1', cve: 'CVE-2024-1111', updatedAt: daysAgo(1) }]);
  };

  /** The same grains as `serveLegacyData`, served as snapshot documents. */
  const serveSnapshotData = (): void => {
    const common = { assetId: 'ep-1', scenarioId: 'scn-1', simulationId: 'sim-1', simulationStartDate: daysAgo(1), reporting: ['EDR'], verifiedAt: daysAgo(1) };
    main.putAttack({ ...common, technique: 'T1003' });
    main.putAttack({ ...common, technique: 'T1059' });
    main.putVulnerability({ assetId: 'ep-1', cve: 'CVE-2024-1111', verifiedAt: daysAgo(1) });
  };

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;

    serviceAccountId = uuidv7();
    await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'OpenAEV bot' });
    await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('openaev', serviceAccountId);
    connectorId = (await services.withOrigin(adminOrigin).integrationSettings.getConnectorId('openaev'))!;

    fake = await startFakeOpenaevLegacy();
    main = fake.openaev.addTenant(OAEV_TENANT, 'Main');
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

  describe('with the snapshot routes off', () => {
    it('should write the attack and CVE evidence of the exercises and findings, record the run and keep no cursor', async () => {
      serveLegacyData();

      await runSync();

      expect(await stateOf('ep-1', attackLabel('T1003'))).toEqual({ state: 'applicable', reason: 'Not detected by EDR in simulation Exercise sim-1 (inject: Inject T1003)' });
      expect(await stateOf('ep-1', attackLabel('T1059'))).toMatchObject({ state: 'applicable' });
      expect(await stateOf('ep-1', 'CVE-2024-1111')).toEqual({ state: 'applicable', reason: 'Reported by OpenAEV' });
      expect((await lastReportedAt())?.getTime()).toBeGreaterThan(daysAgo(1).getTime());
      expect(await streamStates()).toEqual([]);
      expect(await mirrorRows()).toEqual([]);
    });

    it('should probe the attack stream once with one observation, and read no snapshot stream', async () => {
      serveLegacyData();

      await runSync();

      expect(fake.requestsTo('POST', '/snapshot/attack-observations/search').map((request) => request.body)).toEqual([{ page_size: 1 }]);
      expect(fake.requestsTo('POST', '/snapshot/vulnerability-observations/search')).toEqual([]);
      expect(fake.requestsTo('POST', '/exercises/search', OAEV_TENANT)).toHaveLength(1);
      expect(fake.requestsTo('POST', '/findings/search', OAEV_TENANT)).toHaveLength(1);
    });

    it('should run the inventory again on every run', async () => {
      serveLegacyData();

      await runSync();
      await expectReplayedSyncSilent(() => runSync(), { bookkeepingTables: ['openaev_sync_streams', 'openaev_assets'] });

      expect(fake.requestsTo('POST', '/assets/search', OAEV_TENANT)).toHaveLength(2);
    });

    it('should retire a technique the replay of a scenario no longer plays, and keep the one it plays', async () => {
      serveLegacyData();
      await runSync();

      fake.setExercises(OAEV_TENANT, [{
        id: 'sim-2',
        scenarioId: 'scn-1',
        updatedAt: new Date(),
        expectations: [{ assetId: 'ep-1', technique: 'T1003', results: [{ platform: 'EDR', score: 0 }] }],
      }]);
      await runSync();

      expect(await stateOf('ep-1', attackLabel('T1003'))).toMatchObject({ state: 'applicable' });
      expect(await stateOf('ep-1', attackLabel('T1059'))).toEqual({ state: 'dismissed', reason: RETIRED });
      expect(await historyLengthOf('ep-1', attackLabel('T1059'))).toBe(2);
    });

    it('should fill the description of a generic asset after the findings and the exercises', async () => {
      main.setGenericAssets([{ id: 'app-1', name: 'Payroll', category: 'saas_application', description: 'The payroll application' }]);
      serveLegacyData();

      await runSync();

      const routes = fake.requests.map((request) => request.route);
      expect(routes.filter((route) => route === '/assets/app-1')).toHaveLength(1);
      expect(routes.indexOf('/assets/app-1')).toBeGreaterThan(routes.lastIndexOf('/exercises/sim-1/expectations'));
      expect(routes.indexOf('/assets/app-1')).toBeGreaterThan(routes.indexOf('/findings/search'));
    });
  });

  describe('when the snapshot routes come back', () => {
    it('should walk both streams in full on the next run, create no duplicate evidence and retire what only the exercises carried', async () => {
      serveLegacyData();
      fake.setExercises(OAEV_TENANT, [{
        id: 'sim-1',
        scenarioId: 'scn-1',
        updatedAt: daysAgo(1),
        expectations: [
          { assetId: 'ep-1', technique: 'T1003', results: [{ platform: 'EDR', score: 0 }] },
          { assetId: 'ep-1', technique: 'T1059', results: [{ platform: 'EDR', score: 0 }] },
          { assetId: 'ep-1', technique: 'T1566', results: [{ platform: 'EDR', score: 0 }] },
        ],
      }]);
      fake.setFindings(OAEV_TENANT, [
        { id: 'finding-1', assetId: 'ep-1', cve: 'CVE-2024-1111', updatedAt: daysAgo(1) },
        { id: 'finding-2', assetId: 'ep-1', cve: 'CVE-2024-2222', updatedAt: daysAgo(1) },
      ]);
      await runSync();
      const idsBefore = new Map((await evidenceRowsOf('ep-1')).map((row) => [row.label, row.id]));
      expect([...idsBefore.keys()].sort()).toEqual([attackLabel('T1003'), attackLabel('T1059'), attackLabel('T1566'), 'CVE-2024-1111', 'CVE-2024-2222'].sort());

      fake.setSnapshotStatus(200);
      serveSnapshotData();
      await runSync();

      // The snapshot path starts from a full walk: no cursor is sent on either stream. The probe of
      // each run asks for a single observation and is not part of the walk.
      const walkRequests = fake.requestsTo('POST', '/snapshot/attack-observations/search', OAEV_TENANT)
        .filter((request) => !(typeof request.body === 'object' && request.body !== null && 'page_size' in request.body && request.body.page_size === 1));
      expect(walkRequests.map((request) => request.cursor)).toEqual([null]);
      expect(fake.openaev.probes).toHaveLength(1);
      expect(fake.requestsTo('POST', '/snapshot/vulnerability-observations/search', OAEV_TENANT).map((request) => request.cursor)).toEqual([null]);
      expect((await streamStates()).map((state) => [state.stream, state.lastFullWalkCompletedAt !== null])).toEqual(expect.arrayContaining([['attack', true], ['vulnerability', true]]));

      // The same grains land on the same evidence: no row is added and none is replaced.
      const after = await evidenceRowsOf('ep-1');
      expect(after).toHaveLength(5);
      for (const label of [attackLabel('T1003'), attackLabel('T1059'), 'CVE-2024-1111']) {
        expect(after.find((row) => row.label === label)).toMatchObject({ id: idsBefore.get(label), state: 'applicable' });
      }
      // What only the exercises and findings carried is proven gone by the walks.
      expect(await stateOf('ep-1', attackLabel('T1566'))).toEqual({ state: 'dismissed', reason: RETIRED });
      expect(await stateOf('ep-1', 'CVE-2024-2222')).toEqual({ state: 'dismissed', reason: RETIRED });
    });
  });

  describe('when the snapshot routes come back for one OpenAEV tenant that is not ready yet', () => {
    it('should keep the evidence the exercises wrote for the tenant whose walk is not ready when the walk of the other one ends ready', async () => {
      const other = fake.openaev.addTenant('oaev-other', 'Other');
      other.setEndpoints([{ id: 'ey-1', name: 'server-y1', hostname: 'server-y1.test' }]);
      serveLegacyData();
      fake.setExercises('oaev-other', [{
        id: 'sim-y1',
        scenarioId: 'scn-1',
        updatedAt: daysAgo(1),
        expectations: [{ assetId: 'ey-1', technique: 'T1003', results: [{ platform: 'EDR', score: 0 }] }],
      }]);
      await runSync();
      expect(await stateOf('ey-1', attackLabel('T1003'))).toMatchObject({ state: 'applicable' });
      const historyBefore = await historyLengthOf('ey-1', attackLabel('T1003'));

      fake.setSnapshotStatus(200);
      serveSnapshotData();
      other.attack.ready = false;
      await runSync();

      const attackStates = (await streamStates()).filter((state) => state.stream === 'attack');
      expect(attackStates.find((state) => state.openaevTenantId === OAEV_TENANT)?.lastFullWalkCompletedAt).not.toBeNull();
      expect(attackStates.find((state) => state.openaevTenantId === 'oaev-other')?.lastFullWalkCompletedAt).toBeNull();
      expect(await stateOf('ey-1', attackLabel('T1003'))).toMatchObject({ state: 'applicable' });
      expect(await historyLengthOf('ey-1', attackLabel('T1003'))).toBe(historyBefore);
      expect(await stateOf('ep-1', attackLabel('T1003'))).toMatchObject({ state: 'applicable' });
    });
  });

  describe('when the snapshot routes go away', () => {
    it('should forget the cursors and the local copy of the observations and keep the asset registry', async () => {
      fake.setSnapshotStatus(200);
      serveSnapshotData();
      await runSync();
      expect((await streamStates()).length).toBeGreaterThan(0);
      expect((await mirrorRows()).length).toBeGreaterThan(0);
      const registered = (await registeredAssets()).map((asset) => asset.sourceAssetId).sort();
      expect(registered).toEqual(['ep-1', 'ep-2']);

      fake.setSnapshotStatus(404);
      serveLegacyData();
      await runSync();

      expect(await streamStates()).toEqual([]);
      expect(await mirrorRows()).toEqual([]);
      expect((await registeredAssets()).map((asset) => asset.sourceAssetId).sort()).toEqual(registered);
      expect(await labelsOf('ep-1')).toEqual([attackLabel('T1003'), attackLabel('T1059'), 'CVE-2024-1111'].sort());
    });
  });

  describe('when the account may not read the snapshot routes', () => {
    it('should fail the run without retry, naming the missing capability, and read and write nothing', async () => {
      fake.setSnapshotStatus(403);
      serveLegacyData();

      const failure = await runSync().catch((err: unknown) => err);

      expect(failure).toBeInstanceOf(NonRetryableError);
      expect(failure).toHaveProperty('message', expect.stringContaining('ACCESS_SNAPSHOT_OBSERVATION'));
      expect(fake.requests.map((request) => request.route)).toEqual(['/api/me/tenants', '/snapshot/attack-observations/search']);
      expect(await lastReportedAt()).toBeNull();
      expect(await registeredAssets()).toEqual([]);
    });
  });
});
