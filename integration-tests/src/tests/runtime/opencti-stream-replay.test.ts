import { openctiStreamObjects, openctiStreamState, STREAM_LOG_SCOPE_KIND, threatAnalyses, threatAnalysisLocations, threatAnalysisTechniques } from '@app/module';
import { startAll, STREAM_TIMING, whenAllConsumersStopped } from '@app/back/src/features/opencti/opencti-connector-manager';
import { captureLine, flushLogCapture, installLogCapture, uninstallLogCapture } from '@app/back/src/utils/log-capture';
import { setLogSink } from '@app/back/src/utils/logger';
import { createJobContext } from '@app/back/src/engines/job-runtime/job-context-factory';
import { OPENCTI_MIRROR_REBUILD_JOB } from '@app/back/src/features/opencti-mirror-rebuild';
import { openctiMirrorRebuildHandler } from '@app/back/src/features/opencti-mirror-rebuild/opencti-mirror-rebuild-handler';
import { and, eq, isNull } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeOpenCtiStream, FakeStreamEvent } from '../../helpers/fake-opencti-stream';
import type { EventOrigin } from '@app/module';
import { startFakeOpenCtiStream } from '../../helpers/fake-opencti-stream';
import { createTenantWithAdmin } from '../../helpers/factories';
import {
  ABSORBED_STIX_ID,
  ABSORBED_USES_SCRIPTING_ID,
  ACTOR_GROUP_BIS_NAME,
  ACTOR_GROUP_BIS_STIX_ID,
  ACTOR_GROUP_DESCRIPTION,
  ACTOR_GROUP_NAME,
  ACTOR_GROUP_STIX_ID,
  ACTOR_INDIVIDUAL_NAME,
  ACTOR_INDIVIDUAL_STIX_ID,
  buildRenameFixture,
  buildStreamFixture,
  buildThreatFixture,
  CAMPAIGN_ATTRIBUTED_TO_GROUP_BIS_ID,
  CAMPAIGN_NAME,
  CAMPAIGN_STIX_ID,
  FRANCE_STIX_ID,
  PHISHING_MITRE_ID,
  PHISHING_STIX_ID,
  PRODUCER_STIX_ID,
  REGENERATED_NAME,
  REGENERATED_STIX_ID,
  RENAMED_ACTOR_NAME,
  RENAMED_ACTOR_STIX_ID,
  RETIRED_NAME,
  RETIRED_STIX_ID,
  RETIRED_USES_SCRIPTING_ID,
  SCRIPTING_MITRE_ID,
  SCRIPTING_STIX_ID,
  SURVIVOR_NAME,
  SURVIVOR_RENAMED,
  SURVIVOR_STIX_ID,
  SURVIVOR_TARGETS_FRANCE_ID,
  SURVIVOR_USES_PHISHING_ID,
} from '../../helpers/opencti-stream-fixtures';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

// The tenant is created per test, so the credential block keyed on it can only be filled in once
// the module graph is already built.
const connectorConfig = vi.hoisted((): { opencti: Record<string, { url: string, token: string }> } => ({ opencti: {} }));

// The consumer reaches both the database and the stream's credentials through the backend's own
// config. The connection is resolved inside the factory rather than from this file's imports: the
// connector manager pulls in the db engine, which calls `config()` while this module is still
// being evaluated.
vi.mock('../../../../back/src/config', async () => {
  const { getWorkerDbName, pgConfig } = await import('../../setup/pg-config');
  return {
    config: () => ({ postgres: { ...pgConfig, database: getWorkerDbName() }, connectors: connectorConfig }),
    pmConfig: {},
    getProcessName: () => 'test',
  };
});

const services = createTestServices(db);

const STREAM_ID = 'live-stream-fixture';
const TOKEN = 'fixture-token';

// Slack for the database round trips a flush queues behind the debounce.
const FLUSH_SLACK_MS = 10_000;
const FLUSH_BUDGET_MS = STREAM_TIMING.idleDebounceMs + FLUSH_SLACK_MS;
const RECONNECT_BUDGET_MS = STREAM_TIMING.initialReconnectDelayMs + FLUSH_BUDGET_MS;

const CREATED_STIX_IDS = [
  PRODUCER_STIX_ID,
  SURVIVOR_STIX_ID,
  PHISHING_STIX_ID,
  FRANCE_STIX_ID,
  SURVIVOR_USES_PHISHING_ID,
  SURVIVOR_TARGETS_FRANCE_ID,
  ABSORBED_STIX_ID,
  SCRIPTING_STIX_ID,
  ABSORBED_USES_SCRIPTING_ID,
];

const waitFor = async (predicate: () => Promise<boolean>, timeoutMs: number): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) {
      throw new Error('condition not met in time');
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

describe('OpenCTI Live Stream replay', () => {
  let controller: AbortController;
  let server: FakeOpenCtiStream;
  let tenantId: string;
  let adminOrigin: EventOrigin;

  const mirrored = () => db.select().from(openctiStreamObjects)
    .where(and(eq(openctiStreamObjects.tenantId, tenantId), isNull(openctiStreamObjects.deletedAt)));

  const pendingCount = async () => (await db.select().from(openctiStreamObjects)
    .where(and(eq(openctiStreamObjects.tenantId, tenantId), eq(openctiStreamObjects.pending, true)))).length;

  /**
   * The rebuild job, run the way the runtime runs it. The connector only fills the mirror, so
   * nothing an actor's record shows exists until this has folded the marks the stream left.
   */
  const rebuild = () => openctiMirrorRebuildHandler(createJobContext({
    jobId: uuidv7(),
    tenantId,
    kind: OPENCTI_MIRROR_REBUILD_JOB,
    interactive: false,
    payload: {},
    attempt: 1,
    state: null,
    signal: new AbortController().signal,
    deps: { updateProgress: () => Promise.resolve(), saveStateSnapshot: () => Promise.resolve() },
    runDb: db,
  }));

  const analysisNames = async (): Promise<Array<string>> =>
    (await db.select().from(threatAnalyses).where(eq(threatAnalyses.tenantId, tenantId)))
      .map((row) => row.name)
      .sort();
  const settings = async () => (await db.select().from(openctiStreamState).where(eq(openctiStreamState.tenantId, tenantId)))[0];

  const analysisOfStixId = async (stixId: string) => {
    const [analysis] = await db.select().from(threatAnalyses)
      .where(and(eq(threatAnalyses.tenantId, tenantId), eq(threatAnalyses.stixId, stixId)));
    if (!analysis) {
      return null;
    }
    const [techniques, locations] = await Promise.all([
      db.select().from(threatAnalysisTechniques).where(eq(threatAnalysisTechniques.analysisId, analysis.id)),
      db.select().from(threatAnalysisLocations).where(eq(threatAnalysisLocations.analysisId, analysis.id)),
    ]);
    return { analysis, techniques, locations };
  };

  const survivorAnalysis = () => analysisOfStixId(SURVIVOR_STIX_ID);

  const threatsByType = async (): Promise<Record<string, Array<string>>> => {
    const rows = await db.select().from(threatAnalyses).where(eq(threatAnalyses.tenantId, tenantId));
    const byType: Record<string, Array<string>> = {};
    for (const row of rows) {
      byType[row.entityType] = [...(byType[row.entityType] ?? []), row.name].sort();
    }
    return byType;
  };

  const attributionsOf = async (stixId: string) => {
    const found = await analysisOfStixId(stixId);
    const detail = found === null ? undefined : await services.withOrigin(adminOrigin).threatAnalyses.getDetail(found.analysis.id);
    return {
      to: (detail?.attributedTo ?? []).map((threat) => threat.name).sort(),
      from: (detail?.attributedFrom ?? []).map((threat) => threat.name).sort(),
    };
  };

  const techniqueIdsOf = async (stixId: string): Promise<Array<string>> =>
    ((await analysisOfStixId(stixId))?.techniques ?? []).map((row) => row.mitreExternalId).sort();

  const survivorTechniqueIds = async (): Promise<Array<string>> =>
    ((await survivorAnalysis())?.techniques ?? []).map((row) => row.mitreExternalId).sort();

  beforeEach(async () => {
    await truncateAllTables(db);
    const created = await createTenantWithAdmin(services);
    tenantId = created.tenantId;
    adminOrigin = created.origin;

    const serviceAccountId = uuidv7();
    await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'Live Stream bot' });
    await services.withOrigin(adminOrigin).openctiConnector.configure(tenantId, serviceAccountId, STREAM_ID);
  });

  afterEach(async () => {
    controller.abort();
    // A stopped consumer still owes its final flush, which would otherwise land during the next
    // test's `truncateAllTables`.
    await whenAllConsumersStopped();
    await server.close();
    delete connectorConfig.opencti[tenantId];
  });

  const startConsumer = async (
    events: Array<FakeStreamEvent>, options: { closeAfter?: number, servedStreamId?: string } = {},
  ): Promise<void> => {
    server = await startFakeOpenCtiStream(options.servedStreamId ?? STREAM_ID, events);
    if (options.closeAfter !== undefined) {
      server.closeAfter(options.closeAfter);
    }
    connectorConfig.opencti[tenantId] = { url: server.url, token: TOKEN };
    controller = new AbortController();
    startAll(controller.signal);
  };

  it('should mirror what the stream states, and the job rebuilds the analyses from it', async () => {
    const fixture = buildStreamFixture();
    await startConsumer(fixture.creates);

    await waitFor(async () => (await mirrored()).length === CREATED_STIX_IDS.length, FLUSH_BUDGET_MS);
    // Nothing is assembled on the receive path: the actor exists only once the job has run.
    expect(await survivorAnalysis()).toBeNull();
    await rebuild();

    const afterCreates = await survivorAnalysis();
    expect(afterCreates?.analysis.name).toBe(SURVIVOR_NAME);
    expect(afterCreates?.techniques.map((row) => row.mitreExternalId)).toEqual([PHISHING_MITRE_ID]);
    expect(afterCreates?.locations.map((row) => row.country)).toEqual(['France']);
    expect((await mirrored()).map((row) => row.stixId).sort()).toEqual([...CREATED_STIX_IDS].sort());
    expect(await pendingCount()).toBe(0);
    expect(server.requests[0].authorization).toBe(`Bearer ${TOKEN}`);
    // The marking definitions are read once from the instance when the consumer starts.
    expect(server.graphqlRequests()).toBe(1);
    expect(await analysisNames()).toEqual(['Fixture Bear', 'Fixture Bear bis']);

    server.append(fixture.changes);
    await waitFor(async () => (await pendingCount()) > 0 && (await mirrored())
      .find((row) => row.stixId === ABSORBED_USES_SCRIPTING_ID)?.sourceRef === SURVIVOR_STIX_ID, FLUSH_BUDGET_MS);
    await rebuild();

    const afterChanges = await survivorAnalysis();
    expect(afterChanges?.analysis.name).toBe(SURVIVOR_RENAMED);
    // The `targets` edge to France was deleted upstream, so the claim it carried goes with it. That
    // delete frame is the one served over two `data:` lines, so this also pins the reassembly.
    expect(afterChanges?.locations).toHaveLength(0);
    expect(afterChanges?.techniques.map((row) => row.mitreExternalId).sort()).toEqual([PHISHING_MITRE_ID, SCRIPTING_MITRE_ID].sort());
    // The absorbed actor leaves the list: the merge tombstoned it, and the job retracted what the
    // connector had said about it.
    expect(await analysisNames()).toEqual([SURVIVOR_RENAMED]);

    const mirrorRows = await mirrored();
    expect(mirrorRows.map((row) => row.stixId)).not.toContain(ABSORBED_STIX_ID);
    expect(mirrorRows.map((row) => row.stixId)).not.toContain(SURVIVOR_TARGETS_FRANCE_ID);
    const absorbedEdge = mirrorRows.find((row) => row.stixId === ABSORBED_USES_SCRIPTING_ID);
    expect(absorbedEdge?.sourceRef).toBe(SURVIVOR_STIX_ID);
    expect(absorbedEdge?.data['source_ref']).toBe(SURVIVOR_STIX_ID);
  }, FLUSH_BUDGET_MS * 2 + FLUSH_SLACK_MS);

  it('should drop an actor the stream says was deleted upstream', async () => {
    const fixture = buildStreamFixture();
    await startConsumer(fixture.creates);
    await waitFor(async () => (await mirrored()).length === CREATED_STIX_IDS.length, FLUSH_BUDGET_MS);
    await rebuild();
    expect(await analysisNames()).toEqual(['Fixture Bear', 'Fixture Bear bis']);

    server.append([{
      id: `${Date.now()}-9`,
      event: 'delete',
      payload: { data: { id: SURVIVOR_STIX_ID, type: 'intrusion-set', name: SURVIVOR_NAME } },
    }]);
    await waitFor(async () => (await mirrored()).every((row) => row.stixId !== SURVIVOR_STIX_ID), FLUSH_BUDGET_MS);
    await rebuild();

    expect(await survivorAnalysis()).toBeNull();
    expect(await analysisNames()).toEqual(['Fixture Bear bis']);
  }, FLUSH_BUDGET_MS * 2 + FLUSH_SLACK_MS);

  it('should follow an intrusion set renamed upstream to the id its new name derives', async () => {
    const fixture = buildRenameFixture();
    await startConsumer(fixture.creates);
    await waitFor(async () => (await mirrored()).length === fixture.creates.length, FLUSH_BUDGET_MS);
    await rebuild();
    expect(await analysisNames()).toEqual([RETIRED_NAME]);

    server.append(fixture.rename);
    // The retired id is tombstoned last, so its row leaving the live set says the survivor's upsert
    // and the re-point before it are committed too.
    await waitFor(async () => (await mirrored()).every((row) => row.stixId !== RETIRED_STIX_ID), FLUSH_BUDGET_MS);

    const mirrorRows = await mirrored();
    expect(mirrorRows.map((row) => row.stixId)).toContain(REGENERATED_STIX_ID);
    const movedEdge = mirrorRows.find((row) => row.stixId === RETIRED_USES_SCRIPTING_ID);
    expect(movedEdge?.sourceRef).toBe(REGENERATED_STIX_ID);
    expect(movedEdge?.data['source_ref']).toBe(REGENERATED_STIX_ID);

    await rebuild();
    expect(await analysisNames()).toEqual([REGENERATED_NAME]);
    expect((await analysisOfStixId(REGENERATED_STIX_ID))?.techniques.map((row) => row.mitreExternalId)).toEqual([SCRIPTING_MITRE_ID]);
    expect(await analysisOfStixId(RETIRED_STIX_ID)).toBeNull();
  }, FLUSH_BUDGET_MS * 2 + FLUSH_SLACK_MS);

  /**
   * The platform serves one `delete` frame for the actor and none for its relationships, so the
   * claims it comes back with can only be the ones re-sent with it.
   */
  it('should rebuild a deleted and re-created actor from the edges the stream re-sent alone', async () => {
    const fixture = buildStreamFixture();
    await startConsumer(fixture.creates);
    await waitFor(async () => (await mirrored()).length === CREATED_STIX_IDS.length, FLUSH_BUDGET_MS);
    await rebuild();
    expect(await survivorTechniqueIds()).toEqual([PHISHING_MITRE_ID]);
    expect((await survivorAnalysis())?.locations).toHaveLength(1);

    server.append(fixture.deleteAndRecreate);
    await waitFor(async () => {
      const live = (await mirrored()).map((row) => row.stixId);
      return live.includes(SURVIVOR_USES_PHISHING_ID) && !live.includes(SURVIVOR_TARGETS_FRANCE_ID);
    }, FLUSH_BUDGET_MS);
    await rebuild();

    expect(await analysisNames()).toEqual([SURVIVOR_NAME, 'Fixture Bear bis']);
    expect(await survivorTechniqueIds()).toEqual([PHISHING_MITRE_ID]);
    // No frame ever named the France edge: only the actor's own deletion can have taken it.
    expect((await survivorAnalysis())?.locations).toHaveLength(0);
    expect(await pendingCount()).toBe(0);
  }, FLUSH_BUDGET_MS * 2 + FLUSH_SLACK_MS);

  // The persona and the `attributed-to` toward it are the two creates the mirror drops.
  const THREAT_FIXTURE_MIRRORED = buildThreatFixture().creates.length - 2;

  it('should mirror threat actors and campaigns, follow their edits and a merge, and keep the attributions between threats', async () => {
    const fixture = buildThreatFixture();
    await startConsumer(fixture.creates);
    await waitFor(async () => (await mirrored()).length === THREAT_FIXTURE_MIRRORED, FLUSH_BUDGET_MS);
    await rebuild();

    expect(await threatsByType()).toEqual({
      'intrusion-set': [SURVIVOR_NAME],
      'threat-actor': [ACTOR_GROUP_NAME, ACTOR_GROUP_BIS_NAME, ACTOR_INDIVIDUAL_NAME].sort(),
      campaign: [CAMPAIGN_NAME],
    });
    expect(await attributionsOf(CAMPAIGN_STIX_ID)).toEqual({ to: [ACTOR_GROUP_BIS_NAME, SURVIVOR_NAME].sort(), from: [] });
    expect(await attributionsOf(SURVIVOR_STIX_ID)).toEqual({ to: [], from: [CAMPAIGN_NAME] });
    // Its only `attributed-to` points at an identity.
    expect((await attributionsOf(ACTOR_GROUP_STIX_ID)).to).toEqual([]);
    expect(await techniqueIdsOf(CAMPAIGN_STIX_ID)).toEqual([PHISHING_MITRE_ID]);

    server.append(fixture.changes);
    await waitFor(async () => (await pendingCount()) > 0 && (await mirrored())
      .find((row) => row.stixId === CAMPAIGN_ATTRIBUTED_TO_GROUP_BIS_ID)?.targetRef === ACTOR_GROUP_STIX_ID, FLUSH_BUDGET_MS);
    await rebuild();

    expect((await analysisOfStixId(ACTOR_GROUP_STIX_ID))?.analysis.description).toBe(ACTOR_GROUP_DESCRIPTION);
    expect(await techniqueIdsOf(CAMPAIGN_STIX_ID)).toEqual([PHISHING_MITRE_ID, SCRIPTING_MITRE_ID].sort());
    expect(await analysisOfStixId(ACTOR_GROUP_BIS_STIX_ID)).toBeNull();
    expect(await attributionsOf(CAMPAIGN_STIX_ID)).toEqual({ to: [ACTOR_GROUP_NAME, SURVIVOR_NAME].sort(), from: [] });
    expect(await pendingCount()).toBe(0);
  }, FLUSH_BUDGET_MS * 2 + FLUSH_SLACK_MS);

  it('should follow a threat actor renamed upstream, and drop a deleted campaign without touching the threats it was attributed to', async () => {
    const fixture = buildThreatFixture();
    await startConsumer(fixture.creates);
    await waitFor(async () => (await mirrored()).length === THREAT_FIXTURE_MIRRORED, FLUSH_BUDGET_MS);
    await rebuild();
    expect(await techniqueIdsOf(ACTOR_GROUP_STIX_ID)).toEqual([PHISHING_MITRE_ID]);

    server.append(fixture.renameAndDelete);
    await waitFor(async () => (await mirrored()).every((row) => row.stixId !== CAMPAIGN_STIX_ID), FLUSH_BUDGET_MS);
    await rebuild();

    expect(await threatsByType()).toEqual({
      'intrusion-set': [SURVIVOR_NAME],
      'threat-actor': [ACTOR_GROUP_BIS_NAME, ACTOR_INDIVIDUAL_NAME, RENAMED_ACTOR_NAME].sort(),
    });
    expect(await analysisOfStixId(ACTOR_GROUP_STIX_ID)).toBeNull();
    expect(await techniqueIdsOf(RENAMED_ACTOR_STIX_ID)).toEqual([PHISHING_MITRE_ID]);
    expect(await attributionsOf(SURVIVOR_STIX_ID)).toEqual({ to: [], from: [] });
    expect((await analysisOfStixId(ACTOR_INDIVIDUAL_STIX_ID))?.analysis.name).toBe(ACTOR_INDIVIDUAL_NAME);
    expect(await pendingCount()).toBe(0);
  }, FLUSH_BUDGET_MS * 2 + FLUSH_SLACK_MS);

  it('should resume after the persisted position when the connection drops, reading no event twice', async () => {
    const fixture = buildStreamFixture();
    const interruptedAfter = 5;
    await startConsumer(fixture.all, { closeAfter: interruptedAfter });

    await waitFor(async () => (await settings())?.cursor === fixture.all[interruptedAfter - 1].id, FLUSH_BUDGET_MS);
    server.closeAfter(null);

    await waitFor(async () => (await settings())?.objectsRead === fixture.all.length, RECONNECT_BUDGET_MS);
    await rebuild();
    expect(await survivorTechniqueIds()).toHaveLength(2);

    const [firstConnection, secondConnection] = server.requests;
    expect(firstConnection.from).toBe('0-0');
    expect(firstConnection.servedEventIds).toEqual(fixture.all.slice(0, interruptedAfter).map((event) => event.id));
    expect(secondConnection.lastEventId).toBe(fixture.all[interruptedAfter - 1].id);
    // The live tail was reached on the first connection, so the resume no longer asks to recover.
    expect(secondConnection.recover).toBeNull();
    expect(secondConnection.servedEventIds).toEqual(fixture.all.slice(interruptedAfter).map((event) => event.id));
  }, FLUSH_BUDGET_MS + RECONNECT_BUDGET_MS + FLUSH_SLACK_MS);

  it('should tell the Logs tab it reads the stream from its beginning and when the replay caught up, again after a reset', async () => {
    const { jobLogs } = services.withOrigin({ type: 'system' });
    installLogCapture((lines) => jobLogs.appendLines(lines));
    setLogSink(captureLine);
    try {
      const fixture = buildStreamFixture();
      const readingFromBeginning = 'OpenCTI stream reading from its beginning';
      const caughtUp = `OpenCTI stream caught up with its live edge after reading ${fixture.creates.length} objects`;
      const positionLines = async (): Promise<Array<string>> => {
        await flushLogCapture();
        return (await jobLogs.listScopeLines(tenantId, STREAM_LOG_SCOPE_KIND, 100))
          .map((line) => line.message)
          .filter((message) => message === readingFromBeginning || message === caughtUp);
      };
      await startConsumer(fixture.creates);
      await waitFor(async () => (await positionLines()).includes(caughtUp), FLUSH_BUDGET_MS);

      await services.withOrigin(adminOrigin).openctiConnector.resetStreamState(tenantId);
      await waitFor(async () => (await positionLines()).length === 4, FLUSH_BUDGET_MS);

      expect(await positionLines()).toEqual([readingFromBeginning, caughtUp, readingFromBeginning, caughtUp]);
    } finally {
      setLogSink(null);
      uninstallLogCapture();
    }
  }, FLUSH_BUDGET_MS * 2 + FLUSH_SLACK_MS);

  it('should mirror nothing when the configured stream id is not one the instance holds', async () => {
    const fixture = buildStreamFixture();
    await startConsumer(fixture.all, { servedStreamId: 'another-stream' });

    await waitFor(() => Promise.resolve(server.requests.length > 0), FLUSH_BUDGET_MS);

    expect(server.requests[0]).toMatchObject({ streamId: STREAM_ID, status: 404, servedEventIds: [] });
    expect(await mirrored()).toHaveLength(0);
    expect((await settings())?.cursor).toBeNull();
  }, FLUSH_BUDGET_MS);
});
