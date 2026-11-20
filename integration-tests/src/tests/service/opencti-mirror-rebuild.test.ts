import type { BuildEntriesFromMirror, EventOrigin, PendingMark } from '@app/module';
import {
  buildThreatEntriesFromObjects,
  openctiConnectorRepository,
  openctiStreamObjects,
  openctiStreamReportRefs,
  threatActivityAnchors,
  threatAnalyses,
  threatAnalysisOutcomeProbabilities,
  threatAnalysisTechniques,
} from '@app/module';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantWithAdmin } from '../../helpers/factories';
import { db, pool } from '../../setup/db';
import { createTestServices, repositoryContextOf, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const ACTOR = 'intrusion-set--00000000-0000-4000-8000-000000000001';
const OTHER_ACTOR = 'intrusion-set--00000000-0000-4000-8000-000000000002';
const PRODUCER = 'identity--00000000-0000-4000-8000-000000000010';
const PHISHING = 'attack-pattern--00000000-0000-4000-8000-000000000020';
const SCRIPTING = 'attack-pattern--00000000-0000-4000-8000-000000000021';
const INTERPRETER = 'attack-pattern--00000000-0000-4000-8000-000000000022';
const USES_PHISHING = 'relationship--00000000-0000-4000-8000-000000000030';
const USES_SCRIPTING = 'relationship--00000000-0000-4000-8000-000000000031';
const USES_INTERPRETER = 'relationship--00000000-0000-4000-8000-000000000032';
const REPORT = 'report--00000000-0000-4000-8000-000000000040';
const MALWARE = 'malware--00000000-0000-4000-8000-000000000050';
const USES_MALWARE = 'relationship--00000000-0000-4000-8000-000000000033';
const CAMPAIGN = 'campaign--00000000-0000-4000-8000-000000000060';
const CAMPAIGN_ATTRIBUTION = 'relationship--00000000-0000-4000-8000-000000000034';

const producer = { id: PRODUCER, type: 'identity', name: 'Fixture Intel', identity_class: 'organization' };

const actorObject = (id: string, name: string, mitreGroupId: string) => ({
  id,
  type: 'intrusion-set',
  name,
  description: `${name}, a fixture actor.`,
  created: '2024-01-01T00:00:00.000Z',
  modified: '2024-06-01T00:00:00.000Z',
  first_seen: '2024-01-01T00:00:00.000Z',
  last_seen: '2024-06-01T00:00:00.000Z',
  confidence: 90,
  primary_motivation: 'organizational-gain',
  resource_level: 'government',
  created_by_ref: PRODUCER,
  external_references: [{ source_name: 'mitre-attack', external_id: mitreGroupId }],
});

const techniqueObject = (id: string, name: string, externalId: string) => ({
  id,
  type: 'attack-pattern',
  name,
  external_references: [{ source_name: 'mitre-attack', external_id: externalId }],
});

const usesObject = (id: string, sourceRef: string, targetRef: string) => ({
  id,
  type: 'relationship',
  relationship_type: 'uses',
  source_ref: sourceRef,
  target_ref: targetRef,
  created: '2024-02-01T00:00:00.000Z',
  start_time: '2024-02-01T00:00:00.000Z',
  confidence: 90,
  created_by_ref: PRODUCER,
});

const reportObject = (refs: Array<string>, description = 'Operators encrypted the files of the victim and demanded a ransom for the decryption key.') => ({
  id: REPORT,
  type: 'report',
  name: 'Fixture incident report',
  description,
  published: '2026-10-01T00:00:00.000Z',
  labels: ['ransomware'],
  object_refs: refs,
});

const malwareObject = (types: Array<string>) => ({ id: MALWARE, type: 'malware', name: 'Fixture Locker', malware_types: types });

const attributedToObject = (id: string, sourceRef: string, targetRef: string) => ({
  id,
  type: 'relationship',
  relationship_type: 'attributed-to',
  source_ref: sourceRef,
  target_ref: targetRef,
  created: '2024-02-01T00:00:00.000Z',
  confidence: 90,
});

describe('OpenCTI mirror rebuild', () => {
  let adminOrigin: EventOrigin;
  let jobOrigin: EventOrigin;
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
    jobOrigin = { type: 'job', tenantId, jobKind: 'opencti-mirror-rebuild', interactive: false };
  });

  const mirror = () => services.withOrigin(adminOrigin).openctiConnector;

  const runBatch = (
    buildEntries?: BuildEntriesFromMirror,
    options: { limit?: number, after?: PendingMark } = {},
  ) => services.withOrigin(jobOrigin).openctiConnector
    .rebuildPendingBatch(tenantId, options.limit ?? 200, options.after, buildEntries);

  const mirrorRow = async (stixId: string) =>
    (await db.select().from(openctiStreamObjects)
      .where(and(eq(openctiStreamObjects.tenantId, tenantId), eq(openctiStreamObjects.stixId, stixId))))[0];

  const connectorActor = async (stixId: string) =>
    (await db.select().from(threatAnalyses)
      .where(and(eq(threatAnalyses.tenantId, tenantId), eq(threatAnalyses.stixId, stixId))))[0];

  const storedProbabilitiesOf = async (analysisId: string) =>
    (await db.select().from(threatAnalysisOutcomeProbabilities)
      .where(eq(threatAnalysisOutcomeProbabilities.analysisId, analysisId)));

  const probabilitiesOf = async (stixId: string) => {
    const analysis = await connectorActor(stixId);
    return (await db.select().from(threatAnalysisOutcomeProbabilities)
      .where(eq(threatAnalysisOutcomeProbabilities.analysisId, analysis.id)))
      .map((row) => [row.attackOutcomeId, row.probability] as const)
      .sort(([left], [right]) => left.localeCompare(right));
  };

  const reportRefsOf = async (reportStixId: string) =>
    (await db.select().from(openctiStreamReportRefs)
      .where(and(eq(openctiStreamReportRefs.tenantId, tenantId), eq(openctiStreamReportRefs.reportStixId, reportStixId))))
      .map((row) => row.threatStixId)
      .sort();

  /** Rebuilds until nothing is left marked, the way the job's continuations do. */
  const settleMirror = async () => {
    for (let hop = 0; hop < 10; hop += 1) {
      if (!(await runBatch()).remaining) {
        return;
      }
    }
    throw new Error('The mirror never settled');
  };

  const techniquesOf = async (analysisId: string) =>
    (await db.select().from(threatAnalysisTechniques).where(eq(threatAnalysisTechniques.analysisId, analysisId)))
      .map((row) => row.mitreExternalId)
      .sort();

  /** The catalogue, the actor and one `uses` edge, exactly as a stream would have left them. */
  const seedActor = async () => {
    await mirror().upsertStreamObject(tenantId, PRODUCER, 'identity', producer);
    await mirror().upsertStreamObject(tenantId, ACTOR, 'intrusion-set', actorObject(ACTOR, 'Fixture Bear', 'G9101'));
    await mirror().upsertStreamObject(tenantId, PHISHING, 'attack-pattern', techniqueObject(PHISHING, 'Phishing', 'T1566'));
    await mirror().upsertStreamObject(tenantId, USES_PHISHING, 'relationship', usesObject(USES_PHISHING, ACTOR, PHISHING));
  };

  it('should rebuild an actor from what the mirror holds and clear the marks it folded', async () => {
    await seedActor();

    const batch = await runBatch();

    expect(batch.scanned).toBe(4);
    expect(batch.rebuilt).toBe(1);
    const source = await connectorActor(ACTOR);
    expect(source.kind).toBe('connector');
    expect(source.name).toBe('Fixture Bear');
    expect(await techniquesOf(source.id)).toEqual(['T1566']);

    const rows = await db.select().from(openctiStreamObjects).where(eq(openctiStreamObjects.tenantId, tenantId));
    expect(rows.filter((row) => row.pending)).toEqual([]);
  });

  /**
   * A producer as prolific as a CTI vendor signs thousands of actors, which one batch holding all
   * their relationships at once cannot afford: its change marks them, and later batches take them.
   */
  it('should mark the actors a changed producer signed rather than rebuild them in its batch', async () => {
    await seedActor();
    await mirror().upsertStreamObject(tenantId, OTHER_ACTOR, 'intrusion-set', actorObject(OTHER_ACTOR, 'Fixture Wolf', 'G9102'));
    await runBatch();

    await mirror().upsertStreamObject(tenantId, PRODUCER, 'identity', { ...producer, name: 'Fixture Intel Renamed' });
    const batch = await runBatch();

    // The marks count as remaining work, so a run ending on this batch still books a continuation.
    expect(batch).toMatchObject({ scanned: 1, rebuilt: 0, settled: 1, remaining: true });
    expect((await mirrorRow(PRODUCER)).pending).toBe(false);
    expect((await mirrorRow(ACTOR)).pending).toBe(true);
    expect((await mirrorRow(OTHER_ACTOR)).pending).toBe(true);
    expect((await mirrorRow(USES_PHISHING)).pending).toBe(false);

    const next = await runBatch();
    expect(next).toMatchObject({ scanned: 2, rebuilt: 2, settled: 2, remaining: false });
  });

  it('should rebuild one actor once for a burst of edges about it, not once per edge', async () => {
    await seedActor();
    for (let index = 0; index < 20; index += 1) {
      const techniqueId = `attack-pattern--0000000a-0000-4000-8000-0000000000${String(index).padStart(2, '0')}`;
      const edgeId = `relationship--0000000b-0000-4000-8000-0000000000${String(index).padStart(2, '0')}`;
      await mirror().upsertStreamObject(tenantId, techniqueId, 'attack-pattern', techniqueObject(techniqueId, `T${index}`, `T90${index}`));
      await mirror().upsertStreamObject(tenantId, edgeId, 'relationship', usesObject(edgeId, ACTOR, techniqueId));
    }

    const batch = await runBatch();

    expect(batch.scanned).toBe(44);
    expect(batch.rebuilt).toBe(1);
    expect(await techniquesOf((await connectorActor(ACTOR)).id)).toHaveLength(21);
  });

  it('should stop counting a relationship the stream deleted', async () => {
    await seedActor();
    await mirror().upsertStreamObject(tenantId, SCRIPTING, 'attack-pattern', techniqueObject(SCRIPTING, 'Scripting', 'T1059'));
    await mirror().upsertStreamObject(tenantId, USES_SCRIPTING, 'relationship', usesObject(USES_SCRIPTING, ACTOR, SCRIPTING));
    await runBatch();
    expect(await techniquesOf((await connectorActor(ACTOR)).id)).toEqual(['T1059', 'T1566']);

    await mirror().deleteStreamObject(tenantId, USES_SCRIPTING);
    await runBatch();

    expect(await techniquesOf((await connectorActor(ACTOR)).id)).toEqual(['T1566']);
    // Folded, so the tombstone is purged rather than rescanned on every later run.
    expect(await mirrorRow(USES_SCRIPTING)).toBeUndefined();
  });

  it('should let an object OpenCTI deleted and re-created contribute again', async () => {
    await seedActor();
    await runBatch();
    await mirror().deleteStreamObject(tenantId, USES_PHISHING);
    await runBatch();
    expect(await techniquesOf((await connectorActor(ACTOR)).id)).toEqual([]);

    await mirror().upsertStreamObject(tenantId, USES_PHISHING, 'relationship', usesObject(USES_PHISHING, ACTOR, PHISHING));
    await runBatch();

    expect(await techniquesOf((await connectorActor(ACTOR)).id)).toEqual(['T1566']);
  });

  it('should retract a tombstoned actor: its claims, its anchors and the actor row itself', async () => {
    await seedActor();
    await runBatch();
    const actor = await connectorActor(ACTOR);
    await db.insert(threatActivityAnchors).values([{
      id: uuidv7(),
      tenantId,
      analysisId: actor.id,
      kind: 'actor',
      stixRelationId: ACTOR,
      observedAt: new Date('2024-06-01T00:00:00.000Z'),
      authoredAt: null,
      confidence: 90,
      producerStixId: PRODUCER,
    }]);

    await mirror().deleteStreamObject(tenantId, ACTOR);
    const batch = await runBatch();

    expect(batch.retracted).toBe(1);
    expect(await connectorActor(ACTOR)).toBeUndefined();
    expect(await db.select().from(threatAnalysisTechniques).where(eq(threatAnalysisTechniques.analysisId, actor.id))).toEqual([]);
    expect(await db.select().from(threatActivityAnchors).where(eq(threatActivityAnchors.analysisId, actor.id))).toEqual([]);
    expect(await mirrorRow(ACTOR)).toBeUndefined();
  });

  /**
   * An intrusion set's STIX id derives from its name, so an actor deleted then re-created upstream
   * comes back under the very same id. The claims it carries must be the ones the platform re-sent,
   * which only holds because the delete took its relationships with it.
   */
  it('should give a deleted and re-created actor only the claims re-sent with it', async () => {
    await seedActor();
    await mirror().upsertStreamObject(tenantId, SCRIPTING, 'attack-pattern', techniqueObject(SCRIPTING, 'Scripting', 'T1059'));
    await mirror().upsertStreamObject(tenantId, USES_SCRIPTING, 'relationship', usesObject(USES_SCRIPTING, ACTOR, SCRIPTING));
    await runBatch();
    expect(await techniquesOf((await connectorActor(ACTOR)).id)).toEqual(['T1059', 'T1566']);

    await mirror().deleteStreamObject(tenantId, ACTOR);
    expect((await mirrorRow(USES_SCRIPTING)).deletedAt).not.toBeNull();
    expect((await mirrorRow(PRODUCER)).deletedAt).toBeNull();
    await runBatch();
    expect(await connectorActor(ACTOR)).toBeUndefined();
    expect(await mirrorRow(USES_PHISHING)).toBeUndefined();
    expect(await mirrorRow(USES_SCRIPTING)).toBeUndefined();

    await mirror().upsertStreamObject(tenantId, ACTOR, 'intrusion-set', actorObject(ACTOR, 'Fixture Bear', 'G9101'));
    await mirror().upsertStreamObject(tenantId, USES_PHISHING, 'relationship', usesObject(USES_PHISHING, ACTOR, PHISHING));
    await runBatch();

    expect(await techniquesOf((await connectorActor(ACTOR)).id)).toEqual(['T1566']);
  });

  /**
   * The retraction is the connector's own contribution. Another feed describing the same group
   * under its own STIX id is its own actor, and nothing here touches it.
   */
  it('should leave the actor another feed built for the same group standing', async () => {
    await seedActor();
    await runBatch();
    const connector = await connectorActor(ACTOR);
    await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([{
      threat: {
        stixId: OTHER_ACTOR,
        entityType: 'intrusion-set',
        name: 'Fixture Bear',
        description: 'As an uploaded bundle states it.',
        mitreGroupId: 'G9101',
        confidence: 70,
        stixCreated: new Date('2023-01-01T00:00:00.000Z'),
        firstSeen: null,
        lastSeen: new Date('2024-02-01T00:00:00.000Z'),
        primaryMotivation: 'organizational-gain',
        resourceLevel: 'organization',
        sophistication: null,
        objective: null,
        labels: [],
      },
      aliases: [],
      secondaryMotivations: [],
      goals: [],
      threatActorTypes: [],
      roles: [],
      attributions: [],
      locations: [],
      sectors: [],
      cves: [],
      techniques: [],
    }], tenantId, 'stix-import');

    await mirror().deleteStreamObject(tenantId, ACTOR);
    const batch = await runBatch();

    expect(batch.retracted).toBe(1);
    expect(await connectorActor(ACTOR)).toBeUndefined();
    expect(await db.select().from(threatAnalyses).where(eq(threatAnalyses.id, connector.id))).toEqual([]);
    const [uploaded] = await db.select().from(threatAnalyses).where(eq(threatAnalyses.stixId, OTHER_ACTOR));
    expect(uploaded.description).toBe('As an uploaded bundle states it.');
  });

  /**
   * The retraction is scoped to the connector's own kind, and an actor is unique on
   * `(tenant_id, stix_id)` across kinds: an upload describing the very same STIX id keeps its row.
   */
  it('should leave an actor of another kind carrying the same STIX id alone', async () => {
    await mirror().upsertStreamObject(tenantId, ACTOR, 'intrusion-set', actorObject(ACTOR, 'Fixture Bear', 'G9101'));
    await runBatch();
    const connector = await connectorActor(ACTOR);
    // The same STIX id under another kind: what an uploaded bundle of the same export looks like.
    await db.update(threatAnalyses).set({ kind: 'stix-import' })
      .where(eq(threatAnalyses.id, connector.id));
    await mirror().upsertStreamObject(tenantId, ACTOR, 'intrusion-set', actorObject(ACTOR, 'Fixture Bear', 'G9101'));

    await mirror().deleteStreamObject(tenantId, ACTOR);
    const batch = await runBatch();

    expect(batch.retracted).toBe(0);
    expect((await connectorActor(ACTOR)).kind).toBe('stix-import');
  });

  /**
   * The stored percentages are rows of their own, so a retraction that left them behind would keep
   * an actor nobody describes any more selected for its outcomes.
   */
  it('should take the stored probabilities down with the actor a retraction removes', async () => {
    await mirror().upsertStreamObject(tenantId, ACTOR, 'intrusion-set', actorObject(ACTOR, 'Fixture Bear', 'G9101'));
    await runBatch();
    const connector = await connectorActor(ACTOR);
    expect(await storedProbabilitiesOf(connector.id)).not.toEqual([]);

    await mirror().deleteStreamObject(tenantId, ACTOR);
    await runBatch();

    expect(await storedProbabilitiesOf(connector.id)).toEqual([]);
  });

  /**
   * A mirrored object the parser cannot use costs its own actor its rebuild and nothing else: its
   * rows stay marked and come back, where a batch-wide failure would leave the tenant on the same
   * poisoned rows forever.
   */
  it('should isolate an actor whose rebuild fails, keeping only its rows marked', async () => {
    await seedActor();
    await mirror().upsertStreamObject(tenantId, OTHER_ACTOR, 'intrusion-set', actorObject(OTHER_ACTOR, 'Fixture Wolf', 'G9102'));

    const batch = await runBatch((threats, related) => {
      if (threats.some((object) => object['id'] === OTHER_ACTOR)) {
        throw new Error('malformed mirrored object');
      }
      return buildThreatEntriesFromObjects(threats, related);
    });

    expect(batch.rebuilt).toBe(1);
    expect(batch.failures.map((failure) => failure.stixId)).toEqual([OTHER_ACTOR]);
    expect(await connectorActor(ACTOR)).toBeDefined();
    expect(await connectorActor(OTHER_ACTOR)).toBeUndefined();
    expect((await mirrorRow(OTHER_ACTOR)).pending).toBe(true);
    expect((await mirrorRow(ACTOR)).pending).toBe(false);
    expect((await mirrorRow(USES_PHISHING)).pending).toBe(false);
    // The producer is settled even though one of its actors failed: that actor's own mark carries the retry.
    expect((await mirrorRow(PRODUCER)).pending).toBe(false);

    // The next run folds what the failure left behind, the rest already being settled.
    const next = await runBatch();
    expect(next.scanned).toBe(1);
    expect(await connectorActor(OTHER_ACTOR)).toBeDefined();
  });

  /**
   * The rows of an actor whose rebuild fails sort first in every scan, so a run reading from the top
   * each time would take the same batch again and never reach the backlog behind it. The scan is
   * bounded below by the last row of the batch before it, for the length of the run only.
   */
  it('should reach the rows behind an actor whose failing rebuild spans several batches', async () => {
    await mirror().upsertStreamObject(tenantId, OTHER_ACTOR, 'intrusion-set', {
      id: OTHER_ACTOR,
      type: 'intrusion-set',
      name: 'Fixture Wolf',
      confidence: 90,
      external_references: [{ source_name: 'mitre-attack', external_id: 'G9102' }],
    });
    await mirror().upsertStreamObject(tenantId, SCRIPTING, 'attack-pattern', techniqueObject(SCRIPTING, 'Scripting', 'T1059'));
    await mirror().upsertStreamObject(tenantId, USES_SCRIPTING, 'relationship', usesObject(USES_SCRIPTING, OTHER_ACTOR, SCRIPTING));
    await mirror().upsertStreamObject(tenantId, INTERPRETER, 'attack-pattern', techniqueObject(INTERPRETER, 'Command Interpreter', 'T1059.001'));
    await mirror().upsertStreamObject(tenantId, USES_INTERPRETER, 'relationship', usesObject(USES_INTERPRETER, OTHER_ACTOR, INTERPRETER));
    await seedActor();
    const refuseWolf: BuildEntriesFromMirror = (threats, related) => {
      if (threats.some((object) => object['id'] === OTHER_ACTOR)) {
        throw new Error('malformed mirrored object');
      }
      return buildThreatEntriesFromObjects(threats, related);
    };

    // Five marked rows hold the failing actor against a limit of two, so its backlog outlasts more
    // than one batch. The loop is the handler's: hand the bound back until a scan reads nothing past it.
    const batches: Array<Awaited<ReturnType<typeof runBatch>>> = [];
    let after: PendingMark | undefined;
    for (let hop = 0; hop < 10; hop += 1) {
      const batch = await runBatch(refuseWolf, { limit: 2, after });
      batches.push(batch);
      if (batch.scanned === 0 || batch.bound === null) {
        break;
      }
      after = batch.bound;
    }

    // The technique is settled at once: its actor's own mark is what carries the retry.
    expect(batches[0]).toMatchObject({ scanned: 2, rebuilt: 0, settled: 1, remaining: true });
    const failedHops = batches.filter((batch) => batch.failures.some((failure) => failure.stixId === OTHER_ACTOR));
    expect(failedHops.length).toBeGreaterThanOrEqual(2);
    // A scan that restarted from the top would take the failing rows again and return the same last
    // row every time, so distinct bounds are the run moving forward.
    const bounds = batches.map((batch) => batch.bound).filter((bound) => bound !== null);
    expect(bounds.length).toBeGreaterThanOrEqual(2);
    expect(new Set(bounds.map((bound) => `${bound.watermark}|${bound.stixId}`)).size).toBe(bounds.length);
    expect(batches[batches.length - 1]?.scanned).toBe(0);

    // The healthy actor behind the backlog is rebuilt within the same run, and only the rows of the
    // one that kept failing are left marked.
    expect(await connectorActor(ACTOR)).toBeDefined();
    expect(await connectorActor(OTHER_ACTOR)).toBeUndefined();
    for (const stixId of [OTHER_ACTOR, USES_SCRIPTING, USES_INTERPRETER]) {
      expect((await mirrorRow(stixId)).pending).toBe(true);
    }
    expect((await mirrorRow(SCRIPTING)).pending).toBe(false);
    expect((await mirrorRow(INTERPRETER)).pending).toBe(false);
    expect((await mirrorRow(ACTOR)).pending).toBe(false);
    expect((await mirrorRow(USES_PHISHING)).pending).toBe(false);
  });

  /**
   * One tombstone the retraction cannot fold must not cost the others theirs: each is retracted in a
   * scope of its own, which only a savepoint makes possible, the failed statement otherwise poisoning
   * the batch's whole transaction.
   */
  it('should isolate a tombstoned actor whose retraction fails from the one that succeeds', async () => {
    await seedActor();
    await mirror().upsertStreamObject(tenantId, OTHER_ACTOR, 'intrusion-set', actorObject(OTHER_ACTOR, 'Fixture Wolf', 'G9102'));
    await runBatch();
    expect(await connectorActor(OTHER_ACTOR)).toBeDefined();

    await mirror().deleteStreamObject(tenantId, ACTOR);
    await mirror().deleteStreamObject(tenantId, OTHER_ACTOR);
    // Refuses the deletion of one actor row and only that one, standing in for whatever the
    // database might refuse a retraction for.
    await pool.query(`
      CREATE FUNCTION _refuse_one_retraction() RETURNS TRIGGER LANGUAGE plpgsql AS
        $$ BEGIN RAISE EXCEPTION 'refused'; END $$;
      CREATE TRIGGER _refuse_one_retraction BEFORE DELETE ON threat_analyses
        FOR EACH ROW WHEN (OLD.stix_id = '${OTHER_ACTOR}') EXECUTE FUNCTION _refuse_one_retraction();
    `);
    let batch;
    try {
      batch = await runBatch();
    } finally {
      await pool.query('DROP TRIGGER _refuse_one_retraction ON threat_analyses; DROP FUNCTION _refuse_one_retraction();');
    }

    expect(batch.retracted).toBe(1);
    expect(batch.failures.map((failure) => failure.stixId)).toEqual([OTHER_ACTOR]);
    // The one that could be folded is gone, tombstone purged; the one that could not keeps its mark.
    expect(await connectorActor(ACTOR)).toBeUndefined();
    expect(await mirrorRow(ACTOR)).toBeUndefined();
    expect(await connectorActor(OTHER_ACTOR)).toBeDefined();
    expect((await mirrorRow(OTHER_ACTOR)).pending).toBe(true);
  });

  it('should give up without clearing anything while another runner holds the tenant', async () => {
    await seedActor();
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT pg_try_advisory_xact_lock(1566, hashtext($1))', [tenantId]);

      const batch = await runBatch();

      expect(batch).toMatchObject({ locked: false, scanned: 0, settled: 0 });
      expect((await mirrorRow(ACTOR)).pending).toBe(true);
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
    }

    const afterRelease = await runBatch();
    expect(afterRelease.locked).toBe(true);
    expect(afterRelease.scanned).toBe(4);
  });

  /**
   * Two writers taking the same analysis rows in unrelated orders is what deadlocked a real
   * backfill, so the batch takes its actors in the order the analyses module names: by the primary
   * key its updates target. The scan hands them over on the mirror's own layout, which this puts
   * deliberately at odds with that key.
   */
  it('should rebuild the actors of a batch in analysis order, not in the order the scan yields them', async () => {
    await mirror().upsertStreamObject(tenantId, PRODUCER, 'identity', producer);
    const stixIdOf = (index: number) => `intrusion-set--00000000-0000-4000-8000-0000000001${String(index).padStart(2, '0')}`;
    const actorOf = (index: number, suffix: string) =>
      actorObject(stixIdOf(index), `Ordered ${index} ${suffix}`, `G92${String(index).padStart(2, '0')}`);

    // Created one at a time in an order of their own, so the analysis ids rank the actors
    // differently from every id the mirror sorts on.
    const creationOrder = [3, 1, 4, 2];
    for (const index of creationOrder) {
      await mirror().upsertStreamObject(tenantId, stixIdOf(index), 'intrusion-set', actorOf(index, 'created'));
      await runBatch();
    }
    const analysisIds = new Map<string, string>();
    for (const index of creationOrder) {
      analysisIds.set(stixIdOf(index), (await connectorActor(stixIdOf(index))).id);
    }
    const expected = creationOrder
      .map(stixIdOf)
      .sort((left, right) => analysisIds.get(left)!.localeCompare(analysisIds.get(right)!));
    expect(expected).not.toEqual([...expected].sort((left, right) => left.localeCompare(right)));

    for (const index of [1, 2, 3, 4]) {
      await mirror().upsertStreamObject(tenantId, stixIdOf(index), 'intrusion-set', actorOf(index, 'again'));
    }

    const rebuiltOrder: Array<string> = [];
    await runBatch((threatObjects, relatedObjects) => {
      rebuiltOrder.push(...threatObjects.map((object) => String(object.id)));
      return buildThreatEntriesFromObjects(threatObjects, relatedObjects);
    });

    expect(rebuiltOrder).toEqual(expected);
  });

  /**
   * The clear is the guarded half of the batch, and its guard is the `updatedAt` each mark was read
   * with. Driven at the repository, which is where a writer can be placed between the scan and the
   * clear the way a live connector lands between them.
   */
  it('should keep a row written between the scan and the clear marked, and fold it on the next run', async () => {
    await seedActor();
    const ctx = repositoryContextOf(db, jobOrigin);
    const scanned = await openctiConnectorRepository.findPendingStreamObjects(ctx, tenantId, 200);
    expect(scanned).toHaveLength(4);

    await mirror().upsertStreamObject(
      tenantId, PHISHING, 'attack-pattern', techniqueObject(PHISHING, 'Phishing (renamed upstream)', 'T1566'),
    );
    const settled = await openctiConnectorRepository.settlePendingStreamObjects(
      ctx,
      tenantId,
      scanned.map((row) => ({ stixId: row.stixId, watermark: row.watermark })),
    );

    expect(settled).toBe(3);
    expect((await mirrorRow(PHISHING)).pending).toBe(true);

    const next = await runBatch();
    expect(next.scanned).toBe(1);
    expect((await mirrorRow(PHISHING)).pending).toBe(false);
  });
  describe('outcome counter inputs', () => {
    it('should mark the threat a report cites when the report arrives after it, and rescore it on the next batch', async () => {
      await seedActor();
      await runBatch();
      const before = await probabilitiesOf(ACTOR);
      expect((await mirrorRow(ACTOR)).pending).toBe(false);

      await mirror().upsertStreamObject(tenantId, REPORT, 'report', reportObject([ACTOR]));
      expect(await reportRefsOf(REPORT)).toEqual([ACTOR]);
      const batch = await runBatch();

      expect(batch).toMatchObject({ scanned: 1, rebuilt: 0, settled: 1, remaining: true });
      expect((await mirrorRow(ACTOR)).pending).toBe(true);
      const next = await runBatch();
      expect(next).toMatchObject({ scanned: 1, rebuilt: 1, remaining: false });
      expect(await probabilitiesOf(ACTOR)).not.toEqual(before);
    });

    it('should leave a threat alone when a report it does not cite arrives', async () => {
      await seedActor();
      await runBatch();

      await mirror().upsertStreamObject(tenantId, REPORT, 'report', reportObject([OTHER_ACTOR]));
      const batch = await runBatch();

      expect(batch).toMatchObject({ scanned: 1, settled: 1, remaining: false });
      expect((await mirrorRow(ACTOR)).pending).toBe(false);
    });

    it('should mark a threat as soon as the report citing it drops it, since the rebuild can no longer reach it through the report', async () => {
      await seedActor();
      await mirror().upsertStreamObject(tenantId, OTHER_ACTOR, 'intrusion-set', actorObject(OTHER_ACTOR, 'Fixture Wolf', 'G9102'));
      await mirror().upsertStreamObject(tenantId, REPORT, 'report', reportObject([ACTOR, OTHER_ACTOR]));
      await settleMirror();
      const wolfWithReport = await probabilitiesOf(OTHER_ACTOR);

      await mirror().upsertStreamObject(tenantId, REPORT, 'report', reportObject([ACTOR]));

      expect(await reportRefsOf(REPORT)).toEqual([ACTOR]);
      expect((await mirrorRow(OTHER_ACTOR)).pending).toBe(true);
      await settleMirror();
      expect(await probabilitiesOf(OTHER_ACTOR)).not.toEqual(wolfWithReport);
    });

    it('should remove the report a stream update left citing no threat, and rescore the threat it dropped', async () => {
      await seedActor();
      await runBatch();
      const withoutReport = await probabilitiesOf(ACTOR);
      await mirror().upsertStreamObject(tenantId, REPORT, 'report', reportObject([ACTOR]));
      await settleMirror();
      expect(await probabilitiesOf(ACTOR)).not.toEqual(withoutReport);

      // What the connector does with an `update` that no longer passes the relevance filter.
      await mirror().deleteStreamObject(tenantId, REPORT);

      expect(await reportRefsOf(REPORT)).toEqual([]);
      expect((await mirrorRow(REPORT)).deletedAt).not.toBeNull();
      expect((await mirrorRow(ACTOR)).pending).toBe(true);
      await settleMirror();
      expect(await mirrorRow(REPORT)).toBeUndefined();
      expect(await probabilitiesOf(ACTOR)).toEqual(withoutReport);
    });

    it('should keep a replayed report from marking anything', async () => {
      await seedActor();
      await mirror().upsertStreamObject(tenantId, REPORT, 'report', reportObject([ACTOR]));
      await settleMirror();

      await mirror().upsertStreamObject(tenantId, REPORT, 'report', reportObject([ACTOR]));

      expect((await mirrorRow(REPORT)).pending).toBe(false);
      expect((await mirrorRow(ACTOR)).pending).toBe(false);
    });

    it('should hand a threat the malware it uses, and mark it again when that malware changes', async () => {
      await seedActor();
      await runBatch();
      const withoutMalware = await probabilitiesOf(ACTOR);

      await mirror().upsertStreamObject(tenantId, MALWARE, 'malware', malwareObject(['ransomware']));
      await mirror().upsertStreamObject(tenantId, USES_MALWARE, 'relationship', usesObject(USES_MALWARE, ACTOR, MALWARE));
      await settleMirror();
      const withMalware = await probabilitiesOf(ACTOR);
      expect(withMalware).not.toEqual(withoutMalware);

      await mirror().upsertStreamObject(tenantId, MALWARE, 'malware', malwareObject(['spyware']));
      const batch = await runBatch();

      expect(batch).toMatchObject({ scanned: 1, remaining: true });
      expect((await mirrorRow(ACTOR)).pending).toBe(true);
      await settleMirror();
      expect(await probabilitiesOf(ACTOR)).not.toEqual(withMalware);
    });
  });

  describe('attributed threats', () => {
    const seedGroupAndCampaign = async () => {
      await seedActor();
      await mirror().upsertStreamObject(tenantId, CAMPAIGN, 'campaign', { id: CAMPAIGN, type: 'campaign', name: 'Fixture Operation', confidence: 90 });
      await mirror().upsertStreamObject(tenantId, CAMPAIGN_ATTRIBUTION, 'relationship', attributedToObject(CAMPAIGN_ATTRIBUTION, CAMPAIGN, ACTOR));
    };

    /**
     * A campaign sorts before its group in the batch, so it is first scored against a group with no
     * percentages yet: the group's first percentages are what mark it again.
     */
    it('should rescore a campaign scored before its group, once the group has percentages', async () => {
      await seedGroupAndCampaign();

      const first = await runBatch();

      expect(first).toMatchObject({ rebuilt: 2, remaining: true });
      expect((await connectorActor(CAMPAIGN)).outcomeEvidenceSufficient).toBe(false);
      expect((await mirrorRow(CAMPAIGN)).pending).toBe(true);

      const second = await runBatch();

      expect(second).toMatchObject({ rebuilt: 1, remaining: false });
      expect((await connectorActor(CAMPAIGN)).outcomeEvidenceSufficient).toBe(true);
      expect((await mirrorRow(CAMPAIGN)).pending).toBe(false);
    });

    it('should mark the campaign attributed to a group whose percentages changed, and only then', async () => {
      await seedGroupAndCampaign();
      await settleMirror();
      expect((await mirrorRow(CAMPAIGN)).pending).toBe(false);

      await mirror().upsertStreamObject(tenantId, ACTOR, 'intrusion-set', {
        ...actorObject(ACTOR, 'Fixture Bear', 'G9101'),
        description: 'The group encrypts files and demands a ransom for the decryption key.',
      });
      const batch = await runBatch();

      expect(batch).toMatchObject({ rebuilt: 1, remaining: true });
      expect((await mirrorRow(CAMPAIGN)).pending).toBe(true);
      await settleMirror();

      // A group rebuilt to the same percentages leaves its campaign alone.
      await mirror().upsertStreamObject(tenantId, ACTOR, 'intrusion-set', {
        ...actorObject(ACTOR, 'Fixture Bear', 'G9101'),
        description: 'The group encrypts files and demands a ransom for the decryption key.',
        modified: '2024-07-01T00:00:00.000Z',
      });
      const replay = await runBatch();
      expect(replay).toMatchObject({ rebuilt: 1, remaining: false });
      expect((await mirrorRow(CAMPAIGN)).pending).toBe(false);
    });
  });
});
