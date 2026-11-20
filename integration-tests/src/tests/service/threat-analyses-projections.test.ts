import type { EventOrigin } from '@app/module';
import { AttackOutcome_DestructiveAttack, AttackOutcome_Ransomware, AttackOutcome_ServiceDisruption, attackOutcomes, deriveSeedId, LIST_PROJECTION_BATCH_SIZE, LIST_PROJECTION_VERSION, THREAT_RELEVANCE_DEFAULTS, threatAnalyses, threatAnalysisCounts, threatAnalysisOutcomeProbabilities, threatOutcomeScores } from '@app/module';
import { and, asc, eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { buildDisruptionEntry, buildParsedEntry, buildRansomwareEntry, DEFAULT_LIST_PARAMS, readStoredProbability, UNREMARKABLE_DESCRIPTION } from '../../helpers/threat-analyses-fixtures';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('Intrusion Set Analyses Service', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;
  let adminUserId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
    adminUserId = setup.userId;
  });

  /** The list's scores and counts are projections their job alone writes, so every read of one comes after a run of it. */
  const recomputeListProjections = async (): Promise<{ scored: number, counted: number }> =>
    services
      .withOrigin({ type: 'job', tenantId, jobKind: 'threat-list-projection-recompute', interactive: false })
      .threatAnalyses.recomputeListProjections();

  describe('recomputeListProjections', () => {
    const scoreRowsFor = async (analysisId: string) => db.select()
      .from(threatOutcomeScores)
      .where(eq(threatOutcomeScores.analysisId, analysisId))
      .orderBy(asc(threatOutcomeScores.attackOutcomeId));

    const countRowFor = async (analysisId: string) => (await db.select()
      .from(threatAnalysisCounts)
      .where(eq(threatAnalysisCounts.analysisId, analysisId)))[0];

    it('should materialize one row per outcome stored above 0.5, scored at that percentage, and flag the analysis winner', async () => {
      const entry = buildDisruptionEntry();
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([entry], tenantId, 'stix-import');
      const [{ id: analysisId }] = await services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS).then((r) => r.items);
      const stored = await db.select().from(threatAnalysisOutcomeProbabilities)
        .where(eq(threatAnalysisOutcomeProbabilities.analysisId, analysisId));
      const above = stored.filter((row) => row.probability > 0.5);
      expect(above.map((row) => row.attackOutcomeId)).toContain(getOutcomeId(AttackOutcome_ServiceDisruption));

      expect(await scoreRowsFor(analysisId)).toHaveLength(0);
      await recomputeListProjections();

      const rows = await scoreRowsFor(analysisId);
      expect(rows.map((row) => [row.attackOutcomeId, row.score]).sort()).toEqual(above.map((row) => [row.attackOutcomeId, row.probability]).sort());
      expect(rows.every((row) => row.tenantId === tenantId)).toBe(true);

      const winners = rows.filter((row) => row.isTop);
      expect(winners).toHaveLength(1);
      expect(winners[0].score).toBe(Math.max(...above.map((row) => row.probability)));
    });

    it('should drop the rows of an outcome that falls to 0.5 or below', async () => {
      const entry = buildDisruptionEntry();
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([entry], tenantId, 'stix-import');
      const [{ id: analysisId }] = await services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS).then((r) => r.items);
      await recomputeListProjections();
      const disruptionOutcomeId = getOutcomeId(AttackOutcome_ServiceDisruption);
      expect((await scoreRowsFor(analysisId)).map((row) => row.attackOutcomeId)).toContain(disruptionOutcomeId);

      // Same source re-ingested with a description that no longer names the outcome: the
      // projection owes the deletion of what it held, not a stale row.
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([{
        ...entry,
        threat: { ...entry.threat, description: buildParsedEntry('initial').threat.description },
      }], tenantId, 'stix-import');
      expect(await readStoredProbability(db, entry.threat.stixId, disruptionOutcomeId)).toBeLessThanOrEqual(0.5);
      await recomputeListProjections();

      expect((await scoreRowsFor(analysisId)).map((row) => row.attackOutcomeId)).not.toContain(disruptionOutcomeId);
      const { items } = await services.withOrigin(adminOrigin).threatAnalyses
        .list({ ...DEFAULT_LIST_PARAMS, outcomeId: disruptionOutcomeId });
      expect(items).toHaveLength(0);
    });

    it('should materialize no row for a threat whose record lacks the minimum evidence', async () => {
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([buildDisruptionEntry()], tenantId, 'stix-import');
      const [{ id: analysisId }] = await services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS).then((r) => r.items);
      await db.update(threatAnalyses).set({ outcomeEvidenceSufficient: false }).where(eq(threatAnalyses.id, analysisId));

      await recomputeListProjections();

      expect(await scoreRowsFor(analysisId)).toHaveLength(0);
      const { items } = await services.withOrigin(adminOrigin).threatAnalyses
        .list({ ...DEFAULT_LIST_PARAMS, outcomeId: getOutcomeId(AttackOutcome_ServiceDisruption) });
      expect(items).toHaveLength(0);
    });

    it('should keep the scores as they are when the confidence gate moves, since no claim feeds them', async () => {
      await services.withOrigin(adminOrigin).threatAnalyses
        .ingestBundle([buildDisruptionEntry()], tenantId, 'stix-import');
      const [{ id: analysisId }] = await services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS).then((r) => r.items);
      await recomputeListProjections();
      const before = await scoreRowsFor(analysisId);
      expect(before).not.toHaveLength(0);

      await services.withOrigin(adminOrigin).threatRelevanceSettings
        .updateThreatRelevanceSettings({ ...THREAT_RELEVANCE_DEFAULTS, confidenceGate: 80 });
      await recomputeListProjections();

      expect(await scoreRowsFor(analysisId)).toEqual(before);
      expect((await countRowFor(analysisId)).confidenceGate).toBe(80);
    });

    it('should score only its own tenant', async () => {
      const otherTenantId = await createTenant(services, adminUserId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([buildDisruptionEntry()], tenantId, 'stix-import');
      await services.withOrigin(otherOrigin).threatAnalyses.ingestBundle([buildDisruptionEntry()], otherTenantId, 'stix-import');

      await recomputeListProjections();

      const scored = await db.select().from(threatOutcomeScores);
      expect(scored).not.toHaveLength(0);
      expect(scored.every((row) => row.tenantId === tenantId)).toBe(true);
    });

    it('should materialize the two claim counts per analysis, gated and de-duplicated', async () => {
      await services.withOrigin(adminOrigin).threatAnalyses
        .ingestBundle([buildParsedEntry('initial')], tenantId, 'stix-import');
      const [{ id: analysisId }] = await services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS).then((r) => r.items);

      expect(await countRowFor(analysisId)).toBeUndefined();
      await recomputeListProjections();

      const counts = await countRowFor(analysisId);
      expect(counts).toMatchObject({ analysisId, tenantId, cveCount: 2, techniqueCount: 2 });
    });

    it('should keep a row carrying zeros for an analysis with no claim left', async () => {
      const entry = buildParsedEntry('initial');
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([entry], tenantId, 'stix-import');
      const [{ id: analysisId }] = await services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS).then((r) => r.items);
      await recomputeListProjections();
      expect(await countRowFor(analysisId)).toMatchObject({ cveCount: 2, techniqueCount: 2 });

      await services.withOrigin(adminOrigin).threatAnalyses
        .ingestBundle([{ ...entry, cves: [], techniques: [] }], tenantId, 'stix-import');
      await recomputeListProjections();

      // Zeroed rather than deleted: one row per analysis is the table's whole invariant.
      expect(await countRowFor(analysisId)).toMatchObject({ cveCount: 0, techniqueCount: 0 });
      const [row] = await services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS).then((r) => r.items);
      expect(row.cveCount).toBe(0);
      expect(row.techniqueCount).toBe(0);
    });

    it('should refuse to run outside a job origin', async () => {
      await expect(services.withOrigin(adminOrigin).threatAnalyses.recomputeListProjections()).rejects.toThrow();
    });

    it('should project analyses on both sides of a batch boundary', async () => {
      const total = LIST_PROJECTION_BATCH_SIZE + 5;
      await db.insert(threatAnalyses).values(
        Array.from({ length: total }, (_, i) => ({
          id: uuidv7(),
          tenantId,
          stixId: `intrusion-set--batch-${i}`,
          kind: 'stix-import' as const,
          name: `Batch analysis ${i}`,
        })),
      );

      await recomputeListProjections();

      const counts = await db.select().from(threatAnalysisCounts).where(eq(threatAnalysisCounts.tenantId, tenantId));
      expect(counts).toHaveLength(total);
      expect(counts.every((row) => row.cveCount === 0 && row.techniqueCount === 0)).toBe(true);
    });
  });

  /**
   * The sweep folds an analysis only when one of the four inputs it fingerprints on the counts row
   * has moved. Every one of them is an invalidation edge: miss one and the list serves a value
   * computed from data that is gone, with nothing left to ever correct it — a quiet run no longer
   * rewrites everything the way an unscoped sweep did.
   *
   * Written against `xmin`, the transaction that last wrote each row, rather than against the
   * projected values: an analysis re-folded to the same numbers is still a physical rewrite of its
   * rows, with the per-row `notify_data_changed` trigger and the client invalidation that follows,
   * which is the whole of what scoping exists to avoid.
   */
  describe('recomputeListProjections scoping', () => {
    const DISRUPTION_THREAT_ID = 'intrusion-set--22222222-2222-2222-2222-222222222222';
    const OTHER_THREAT_ID = 'intrusion-set--33333333-3333-4333-8333-333333333333';

    /** The writing transaction of each projection row, keyed `<table>:<analysis>:<outcome>`. */
    const rowVersions = async (): Promise<Map<string, string>> => {
      const counts = await db.execute<{ analysis_id: string, xmin: string }>(
        sql`select analysis_id, xmin::text as xmin from threat_analysis_counts`,
      );
      const scores = await db.execute<{ analysis_id: string, attack_outcome_id: string, xmin: string }>(
        sql`select analysis_id, attack_outcome_id, xmin::text as xmin from threat_outcome_scores`,
      );
      return new Map([
        ...counts.rows.map((row): [string, string] => [`counts:${row.analysis_id}`, row.xmin]),
        ...scores.rows.map((row): [string, string] => [`scores:${row.analysis_id}:${row.attack_outcome_id}`, row.xmin]),
      ]);
    };

    const rewrittenSince = async (before: Map<string, string>): Promise<Array<string>> => {
      const after = await rowVersions();
      return [...after.entries()].filter(([key, version]) => before.get(key) !== version).map(([key]) => key).sort();
    };

    const keysOf = (analysisId: string, versions: Map<string, string>): Array<string> =>
      [...versions.keys()].filter((key) => key.includes(analysisId)).sort();

    /** Two scored actors, both projected, so a run can be asked to touch exactly one of them. */
    const seedTwoScoredActors = async (): Promise<{ touched: string, untouched: string }> => {
      const second = buildDisruptionEntry();
      second.threat.stixId = OTHER_THREAT_ID;
      second.threat.name = 'Second Disruption Crew';
      second.threat.mitreGroupId = 'G9997';
      second.aliases = ['Second Disruption Crew', 'DC-9997'];
      await services.withOrigin(adminOrigin).threatAnalyses
        .ingestBundle([buildDisruptionEntry(), second], tenantId, 'stix-import');
      await recomputeListProjections();

      const rows = await db.select({ id: threatAnalyses.id, stixId: threatAnalyses.stixId }).from(threatAnalyses);
      const touched = rows.find((row) => row.stixId === DISRUPTION_THREAT_ID)!;
      const untouched = rows.find((row) => row.stixId === OTHER_THREAT_ID)!;
      return { touched: touched.id, untouched: untouched.id };
    };

    it('should write nothing at all on a run no input has moved for', async () => {
      await seedTwoScoredActors();
      const before = await rowVersions();
      expect(before.size).toBeGreaterThan(2);

      expect(await recomputeListProjections()).toEqual({ scored: 0, counted: 0 });

      expect(await rewrittenSince(before)).toEqual([]);
    });

    it('should owe a fold to no analysis a re-ingestion left unchanged', async () => {
      await seedTwoScoredActors();
      const before = await rowVersions();

      await services.withOrigin(adminOrigin).threatAnalyses
        .ingestBundle([buildDisruptionEntry()], tenantId, 'stix-import');

      expect(await recomputeListProjections()).toEqual({ scored: 0, counted: 0 });
      expect(await rewrittenSince(before)).toEqual([]);
    });

    it('should re-fold the analyses an ingestion touched and leave the rest physically untouched', async () => {
      const { touched, untouched } = await seedTwoScoredActors();
      const before = await rowVersions();

      // A re-ingestion that states one claim differently is the one the sweep owes a fold, and the
      // other actor it owes nothing.
      const restated = buildDisruptionEntry();
      restated.techniques[0] = { ...restated.techniques[0], relConfidence: 60 };
      await services.withOrigin(adminOrigin).threatAnalyses
        .ingestBundle([restated], tenantId, 'stix-import');

      const result = await recomputeListProjections();
      expect(result.counted).toBe(1);
      expect(result.scored).toBeGreaterThan(0);
      expect(await rewrittenSince(before)).toEqual(keysOf(touched, before));
      expect(await rewrittenSince(before)).not.toContain(`counts:${untouched}`);
    });

    it('should pick up the claims of the analysis it re-folds', async () => {
      const { touched } = await seedTwoScoredActors();

      const stripped = buildDisruptionEntry();
      await services.withOrigin(adminOrigin).threatAnalyses
        .ingestBundle([{ ...stripped, cves: [], techniques: [] }], tenantId, 'stix-import');
      await recomputeListProjections();

      const [counts] = await db.select().from(threatAnalysisCounts).where(eq(threatAnalysisCounts.analysisId, touched));
      expect(counts).toMatchObject({ cveCount: 0, techniqueCount: 0 });
    });

    it('should re-fold an analysis added after a run that projected the others', async () => {
      const { untouched } = await seedTwoScoredActors();
      const before = await rowVersions();

      const third = buildDisruptionEntry();
      third.threat.stixId = 'intrusion-set--44444444-4444-4444-8444-444444444444';
      third.threat.name = 'Third Disruption Crew';
      third.threat.mitreGroupId = 'G9996';
      third.aliases = ['Third Disruption Crew', 'DC-9996'];
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([third], tenantId, 'stix-import');

      expect((await recomputeListProjections()).counted).toBe(1);
      expect(await rewrittenSince(before)).not.toContain(`counts:${untouched}`);
      const [added] = await db.select().from(threatAnalyses).where(eq(threatAnalyses.stixId, third.threat.stixId));
      const [counts] = await db.select().from(threatAnalysisCounts).where(eq(threatAnalysisCounts.analysisId, added.id));
      expect(counts).toBeDefined();
    });

    it('should re-fold every analysis when the confidence gate moves', async () => {
      const { touched, untouched } = await seedTwoScoredActors();
      const before = await rowVersions();

      await services.withOrigin(adminOrigin).threatRelevanceSettings
        .updateThreatRelevanceSettings({ ...THREAT_RELEVANCE_DEFAULTS, confidenceGate: 80 });

      expect((await recomputeListProjections()).counted).toBe(2);
      const rewritten = await rewrittenSince(before);
      expect(rewritten).toContain(`counts:${touched}`);
      expect(rewritten).toContain(`counts:${untouched}`);
    });

    /**
     * The edge with no data behind it at all: a deploy changes what the fold makes of unchanged
     * inputs. Nothing in the database moves, so `LIST_PROJECTION_VERSION` is the only thing that
     * can make the boot-time catch-up run find anything to do.
     */
    it('should re-fold every analysis when the projection version it was folded under is gone', async () => {
      await seedTwoScoredActors();
      const before = await rowVersions();

      await db.update(threatAnalysisCounts).set({ projectionVersion: '2020.01' })
        .where(eq(threatAnalysisCounts.tenantId, tenantId));

      expect((await recomputeListProjections()).counted).toBe(2);
      // Both projection tables, not only the one carrying the version: the scores are what a deploy
      // changing the fold actually rewrites.
      const rewritten = await rewrittenSince(before);
      expect(rewritten.filter((key) => key.startsWith('counts:'))).toHaveLength(2);
      expect(rewritten.filter((key) => key.startsWith('scores:'))).toEqual([...before.keys()].filter((key) => key.startsWith('scores:')).sort());
    });

    /**
     * The edge no deploy can mark: a release renames a seeded outcome at its boot, which breaks the
     * tie between an analysis's top outcomes while the tenant's own data and
     * `LIST_PROJECTION_VERSION` stay unchanged. The catalogue digest is the only stamp left that can
     * see it.
     */
    it('should re-fold every analysis when an attack outcome is renamed', async () => {
      await seedTwoScoredActors();
      const before = await rowVersions();

      await db.update(attackOutcomes).set({ name: 'Renamed outcome' })
        .where(eq(attackOutcomes.id, deriveSeedId(tenantId, AttackOutcome_ServiceDisruption)));

      expect((await recomputeListProjections()).counted).toBe(2);
      expect((await rewrittenSince(before)).filter((key) => key.startsWith('counts:'))).toHaveLength(2);
    });

    it('should settle again once the catalogue it re-folded against stops moving', async () => {
      await seedTwoScoredActors();
      await db.update(attackOutcomes).set({ name: 'Renamed outcome' })
        .where(eq(attackOutcomes.id, deriveSeedId(tenantId, AttackOutcome_ServiceDisruption)));

      expect((await recomputeListProjections()).counted).toBe(2);

      expect((await recomputeListProjections()).counted).toBe(0);
    });

    it('should stamp the fingerprints the next run reads its staleness off', async () => {
      const { touched } = await seedTwoScoredActors();

      const [analysis] = await db.select().from(threatAnalyses).where(eq(threatAnalyses.id, touched));
      const [counts] = await db.select().from(threatAnalysisCounts).where(eq(threatAnalysisCounts.analysisId, touched));
      expect(counts.sourceUpdatedAt).toEqual(analysis.updatedAt);
      expect(counts.confidenceGate).toBe(THREAT_RELEVANCE_DEFAULTS.confidenceGate);
      expect(counts.projectionVersion).toBe(LIST_PROJECTION_VERSION);
      expect(counts.catalogueFingerprint).toMatch(/^[0-9a-f]{32}$/);
    });

    /**
     * `updated_at` from the column default carries microseconds the driver's `Date` cannot, so a
     * fingerprint written back from JS can only ever be the millisecond truncation of its source.
     * Compared against the raw column, every such analysis would be swept again on every run.
     */
    it('should settle an analysis whose updated_at was written by the column default', async () => {
      await db.insert(threatAnalyses).values({
        id: uuidv7(),
        tenantId,
        stixId: 'intrusion-set--default-timestamp',
        kind: 'stix-import' as const,
        name: 'Default Timestamp Actor',
      });
      expect((await recomputeListProjections()).counted).toBe(1);

      expect((await recomputeListProjections()).counted).toBe(0);
    });

    it('should leave another tenant unswept when this one moves its gate', async () => {
      await seedTwoScoredActors();
      const otherTenantId = await createTenant(services, adminUserId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };
      await services.withOrigin(otherOrigin).threatAnalyses.ingestBundle([buildDisruptionEntry()], otherTenantId, 'stix-import');
      await services
        .withOrigin({ type: 'job', tenantId: otherTenantId, jobKind: 'threat-list-projection-recompute', interactive: false })
        .threatAnalyses.recomputeListProjections();
      const before = await rowVersions();

      await services.withOrigin(adminOrigin).threatRelevanceSettings
        .updateThreatRelevanceSettings({ ...THREAT_RELEVANCE_DEFAULTS, confidenceGate: 80 });
      await recomputeListProjections();

      const otherAnalyses = await db.select().from(threatAnalyses).where(eq(threatAnalyses.tenantId, otherTenantId));
      const rewritten = await rewrittenSince(before);
      expect(otherAnalyses).toHaveLength(1);
      expect(rewritten).not.toContain(`counts:${otherAnalyses[0].id}`);
    });

    it('should sweep a batch boundary without re-folding what the previous batch settled', async () => {
      const total = LIST_PROJECTION_BATCH_SIZE + 5;
      await db.insert(threatAnalyses).values(
        Array.from({ length: total }, (_, i) => ({
          id: uuidv7(),
          tenantId,
          stixId: `intrusion-set--scoped-batch-${i}`,
          kind: 'stix-import' as const,
          name: `Scoped batch analysis ${i}`,
        })),
      );
      expect((await recomputeListProjections()).counted).toBe(total);

      const before = await rowVersions();
      expect((await recomputeListProjections()).counted).toBe(0);
      expect(await rewrittenSince(before)).toEqual([]);
    });
  });

  const getOutcomeId = (catalogId: string): string => deriveSeedId(tenantId, catalogId);

  describe('list (outcome scoring)', () => {
    it('should pick each row\'s top outcome from its stored percentages, with no outcome filter', async () => {
      const initial = buildParsedEntry('initial');
      const base = { ...initial, aliases: [], threat: { ...initial.threat, description: UNREMARKABLE_DESCRIPTION } };
      const disruptionEntry = buildDisruptionEntry();
      await services.withOrigin(adminOrigin).threatAnalyses
        .ingestBundle([base, disruptionEntry], tenantId, 'stix-import');
      await recomputeListProjections();

      const { items } = await services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS);

      expect(items).toHaveLength(2);

      const disruption = items.find((row) => row.name === 'Disruption Crew')!;
      expect(disruption.topOutcomeName).toBe('Service Disruption');
      expect(disruption.topOutcomeScore).toBe(await readStoredProbability(db, disruptionEntry.threat.stixId, getOutcomeId(AttackOutcome_ServiceDisruption)));

      // The base entry's description names no outcome: none of its percentages clears 0.5, so it
      // is computed and scores nothing, rather than showing a top outcome it does not lead to.
      const baseRow = items.find((row) => row.name === 'Test Intrusion Set')!;
      const [{ highest }] = await db.select({ highest: sql<number>`max(${threatAnalysisOutcomeProbabilities.probability})` })
        .from(threatAnalysisOutcomeProbabilities).where(eq(threatAnalysisOutcomeProbabilities.analysisId, baseRow.id));
      expect(highest).toBeLessThanOrEqual(0.5);
      expect(baseRow.topOutcomeName).toBeNull();
      expect(baseRow.topOutcomeScore).toBe(0);
    });

    it('should score only the filtered outcome and drop a row that is not above 0.5 on it', async () => {
      const disruptionEntry = buildDisruptionEntry();
      await services.withOrigin(adminOrigin).threatAnalyses
        .ingestBundle([buildParsedEntry('initial'), disruptionEntry], tenantId, 'stix-import');
      await recomputeListProjections();
      const disruptionOutcomeId = getOutcomeId(AttackOutcome_ServiceDisruption);

      const { items } = await services.withOrigin(adminOrigin).threatAnalyses
        .list({ ...DEFAULT_LIST_PARAMS, outcomeId: disruptionOutcomeId });

      // The base fixture stores a percentage on Service Disruption too, but not above 0.5:
      // dropped rather than shown as a score.
      expect(items).toHaveLength(1);
      expect(items[0].name).toBe('Disruption Crew');
      expect(items[0].topOutcomeName).toBe('Service Disruption');
      expect(items[0].topOutcomeScore).toBe(await readStoredProbability(db, disruptionEntry.threat.stixId, disruptionOutcomeId));
    });

    it('should return an empty page when the filtered outcome exists but no row scores on it', async () => {
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([buildDisruptionEntry()], tenantId, 'stix-import');
      // Disruption Crew's own techniques and its `organizational-gain` motivation curate every
      // other outcome but this one, so it is the one row-less case the fixture reaches.
      const destructiveOutcomeId = getOutcomeId(AttackOutcome_DestructiveAttack);

      const { items } = await services.withOrigin(adminOrigin).threatAnalyses
        .list({ ...DEFAULT_LIST_PARAMS, outcomeId: destructiveOutcomeId });

      expect(items).toHaveLength(0);
    });

    it('should not expose another tenant analyses, with or without an outcome filter', async () => {
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([buildDisruptionEntry()], tenantId, 'stix-import');
      await recomputeListProjections();
      const disruptionOutcomeId = getOutcomeId(AttackOutcome_ServiceDisruption);

      const otherTenantId = await createTenant(services, adminUserId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };

      expect(await services.withOrigin(otherOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS).then((r) => r.items)).toHaveLength(0);
      const scoped = await services.withOrigin(otherOrigin).threatAnalyses.list({ ...DEFAULT_LIST_PARAMS, outcomeId: disruptionOutcomeId });
      expect(scoped.items).toHaveLength(0);

      // `otherOrigin` has no analyses at all, so the assertions above would pass whether or not
      // the outcome filter itself applies. `tenantId`'s own analysis does score on
      // `disruptionOutcomeId` (the control below), so filtering it by an outcome id that belongs
      // to `otherTenantId` instead pins the filter actually excluding a foreign id, rather than
      // the list happening to already be empty of scores.
      const own = await services.withOrigin(adminOrigin).threatAnalyses
        .list({ ...DEFAULT_LIST_PARAMS, outcomeId: disruptionOutcomeId });
      expect(own.items).toHaveLength(1);

      const foreign = await services.withOrigin(adminOrigin).threatAnalyses
        .list({ ...DEFAULT_LIST_PARAMS, outcomeId: deriveSeedId(otherTenantId, AttackOutcome_ServiceDisruption) });
      expect(foreign.items).toHaveLength(0);
      expect(foreign.total).toBe(0);
    });
  });

  describe('list (pagination and search)', () => {
    it('should page through the whole catalog with a stable order and no duplicated or dropped rows', async () => {
      await services.withOrigin(adminOrigin).threatAnalyses
        .ingestBundle([buildParsedEntry('initial'), buildDisruptionEntry()], tenantId, 'stix-import');

      const page1 = await services.withOrigin(adminOrigin).threatAnalyses.list({ page: 1, limit: 1, sortBy: 'name', sortDesc: false });
      const page2 = await services.withOrigin(adminOrigin).threatAnalyses.list({ page: 2, limit: 1, sortBy: 'name', sortDesc: false });
      const page3 = await services.withOrigin(adminOrigin).threatAnalyses.list({ page: 3, limit: 1, sortBy: 'name', sortDesc: false });

      expect(page1.total).toBe(2);
      expect(page2.total).toBe(2);
      expect(page3.items).toHaveLength(0);
      const ids = [...page1.items, ...page2.items].map((row) => row.id);
      expect(new Set(ids).size).toBe(2);
      // Ascending by name: "Disruption Crew" sorts before "Test Intrusion Set".
      expect(page1.items[0].name).toBe('Disruption Crew');
      expect(page2.items[0].name).toBe('Test Intrusion Set');
    });

    it('should sort names across accents, the unaccented spelling first, in both directions', async () => {
      const base = buildParsedEntry('initial');
      const names = ['Zèbre', 'école', 'eden', 'Ecole', 'abc'];
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle(
        names.map((name, index) => ({
          ...base,
          threat: { ...base.threat, name, stixId: `intrusion-set--accent-${index}` },
        })),
        tenantId,
        'stix-import',
      );

      const sorted = async (sortDesc: boolean) =>
        (await services.withOrigin(adminOrigin).threatAnalyses.list({ page: 1, limit: 10, sortBy: 'name', sortDesc })).items.map((row) => row.name);

      expect(await sorted(false)).toEqual(['abc', 'Ecole', 'école', 'eden', 'Zèbre']);
      expect(await sorted(true)).toEqual(['Zèbre', 'eden', 'école', 'Ecole', 'abc']);
    });

    it('should default to outcomeScore descending when no sortBy is given', async () => {
      await services.withOrigin(adminOrigin).threatAnalyses
        .ingestBundle([buildParsedEntry('initial'), buildDisruptionEntry()], tenantId, 'stix-import');
      await recomputeListProjections();

      const { items } = await services.withOrigin(adminOrigin).threatAnalyses.list({ page: 1, limit: 10, sortDesc: true });
      expect(items[0].topOutcomeScore).toBeGreaterThan(items[1].topOutcomeScore!);
    });

    it('should filter by a case-insensitive name prefix, not a substring', async () => {
      await services.withOrigin(adminOrigin).threatAnalyses
        .ingestBundle([buildParsedEntry('initial'), buildDisruptionEntry()], tenantId, 'stix-import');

      const { items, total } = await services.withOrigin(adminOrigin).threatAnalyses
        .list({ ...DEFAULT_LIST_PARAMS, search: 'disrup' });
      expect(total).toBe(1);
      expect(items).toHaveLength(1);
      expect(items[0].name).toBe('Disruption Crew');

      const bySubstring = await services.withOrigin(adminOrigin).threatAnalyses
        .list({ ...DEFAULT_LIST_PARAMS, search: 'crew' });
      expect(bySubstring.total).toBe(0);
    });

    it('should match a name prefix across accents and ligatures in both directions', async () => {
      const accented = buildParsedEntry('initial');
      await services.withOrigin(adminOrigin).threatAnalyses
        .ingestBundle([{ ...accented, threat: { ...accented.threat, name: 'École Straße' } }, buildDisruptionEntry()], tenantId, 'stix-import');

      const names = async (search: string) =>
        (await services.withOrigin(adminOrigin).threatAnalyses.list({ ...DEFAULT_LIST_PARAMS, search })).items.map((row) => row.name);

      expect(await names('ecole')).toEqual(['École Straße']);
      expect(await names('Éco')).toEqual(['École Straße']);
      expect(await names('strasse')).toEqual([]);
      expect(await names('disrúp')).toEqual(['Disruption Crew']);
    });

    it('treats a literal % or _ in the search term as a literal, not a wildcard', async () => {
      await services.withOrigin(adminOrigin).threatAnalyses
        .ingestBundle([buildParsedEntry('initial'), buildDisruptionEntry()], tenantId, 'stix-import');

      // Neither pattern is a real prefix of "Disruption Crew": an unescaped ILIKE would treat
      // % / _ as wildcards and match it anyway.
      const percent = await services.withOrigin(adminOrigin).threatAnalyses
        .list({ ...DEFAULT_LIST_PARAMS, search: 'D%Crew' });
      expect(percent.total).toBe(0);

      const underscore = await services.withOrigin(adminOrigin).threatAnalyses
        .list({ ...DEFAULT_LIST_PARAMS, search: 'D_sruption' });
      expect(underscore.total).toBe(0);
    });
  });

  describe('getOutcomeScoresForAnalysis', () => {
    it('should return the stored percentage of every outcome, highest first, with whether the threat has enough data', async () => {
      const entry = buildDisruptionEntry();
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([entry], tenantId, 'stix-import');
      const [{ id: analysisId }] = await services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS).then((r) => r.items);
      const disruptionOutcomeId = getOutcomeId(AttackOutcome_ServiceDisruption);

      const scores = await services.withOrigin(adminOrigin).threatAnalyses
        .getOutcomeScoresForAnalysis(analysisId);

      expect(scores).toHaveLength(7);
      expect(scores[0].attackOutcomeId).toBe(disruptionOutcomeId);
      expect(scores[0].score).toBe(await readStoredProbability(db, entry.threat.stixId, disruptionOutcomeId));
      const percentages = scores.map((outcome) => outcome.score ?? -1);
      expect(percentages).toEqual(percentages.toSorted((a, b) => b - a));
      expect(scores.every((outcome) => outcome.evidenceSufficient && outcome.score !== null)).toBe(true);
    });

    it('should date the judgment set only on the rows a judgment gave', async () => {
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([buildDisruptionEntry()], tenantId, 'stix-import');
      const [{ id: analysisId }] = await services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS).then((r) => r.items);
      const read = () => services.withOrigin(adminOrigin).threatAnalyses.getOutcomeScoresForAnalysis(analysisId);
      const disruptionOutcomeId = getOutcomeId(AttackOutcome_ServiceDisruption);

      const counterScored = await read();
      await db.update(threatAnalyses).set({ outcomeJudgedAt: new Date('2026-11-02T00:00:00.000Z') }).where(eq(threatAnalyses.id, analysisId));
      await db.update(threatAnalysisOutcomeProbabilities).set({ judged: true })
        .where(and(eq(threatAnalysisOutcomeProbabilities.analysisId, analysisId), eq(threatAnalysisOutcomeProbabilities.attackOutcomeId, disruptionOutcomeId)));
      const partial = await read();
      await db.update(threatAnalysisOutcomeProbabilities).set({ judged: true }).where(eq(threatAnalysisOutcomeProbabilities.analysisId, analysisId));
      const judged = await read();

      expect(counterScored.every((outcome) => outcome.judgedOn === null)).toBe(true);
      expect(partial.filter((outcome) => outcome.judgedOn !== null).map((outcome) => outcome.attackOutcomeId)).toEqual([disruptionOutcomeId]);
      expect(partial.find((outcome) => outcome.attackOutcomeId === disruptionOutcomeId)?.judgedOn).toBe('2026-11-02');
      expect(judged).toHaveLength(7);
      expect(judged.every((outcome) => outcome.judgedOn === '2026-11-02')).toBe(true);
    });

    it('should return no percentage at all for a threat whose record lacks the minimum evidence', async () => {
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([buildDisruptionEntry()], tenantId, 'stix-import');
      const [{ id: analysisId }] = await services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS).then((r) => r.items);
      await db.update(threatAnalyses).set({ outcomeEvidenceSufficient: false }).where(eq(threatAnalyses.id, analysisId));

      const thin = await services.withOrigin(adminOrigin).threatAnalyses.getOutcomeScoresForAnalysis(analysisId);

      expect(thin).toHaveLength(7);
      expect(thin.every((outcome) => outcome.score === null && !outcome.evidenceSufficient)).toBe(true);
    });

    it('should return rows without a percentage for an analysis belonging to another tenant', async () => {
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([buildDisruptionEntry()], tenantId, 'stix-import');
      const [{ id: analysisId }] = await services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS).then((r) => r.items);

      const otherTenantId = await createTenant(services, adminUserId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };

      // Tenant-scoped views make a foreign analysis id yield nothing: the other tenant sees its
      // own outcomes but no percentage, so nothing leaks.
      const scores = await services.withOrigin(otherOrigin).threatAnalyses
        .getOutcomeScoresForAnalysis(analysisId);
      expect(scores).toHaveLength(7);
      expect(scores.every((outcome) => outcome.score === null && !outcome.evidenceSufficient)).toBe(true);
    });
  });

  describe('getMatchingActorsForOutcome', () => {
    it('should return only the analyses stored above 0.5 on the outcome, with their profile', async () => {
      const entry = buildDisruptionEntry();
      await services.withOrigin(adminOrigin).threatAnalyses
        .ingestBundle([buildParsedEntry('initial'), entry], tenantId, 'stix-import');
      const disruptionOutcomeId = getOutcomeId(AttackOutcome_ServiceDisruption);

      const { topActors, distributions } = await services.withOrigin(adminOrigin).threatAnalyses
        .getMatchingActorsForOutcome(disruptionOutcomeId);

      expect(topActors).toHaveLength(1);
      expect(topActors[0].analysisName).toBe('Disruption Crew');
      expect(distributions.resourceLevel).toEqual([{ value: 'government', count: 1, share: 1 }]);
      expect(distributions.primaryMotivation).toEqual([{ value: 'organizational-gain', count: 1, share: 1 }]);
      expect(topActors[0].score).toBe(await readStoredProbability(db, entry.threat.stixId, disruptionOutcomeId));
    });

    it('should list every matching actor by percentage, breaking equal ones by name', async () => {
      const entries = [
        buildRansomwareEntry({ stixId: 'intrusion-set--aaaaaaaa-0000-4000-8000-000000000011', name: 'Zeta Lockers', mitreGroupId: 'G9011' }),
        buildRansomwareEntry({ stixId: 'intrusion-set--aaaaaaaa-0000-4000-8000-000000000012', name: 'Alpha Lockers', mitreGroupId: 'G9012' }),
      ];
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle(entries, tenantId, 'stix-import');
      const ransomwareOutcomeId = getOutcomeId(AttackOutcome_Ransomware);
      const expected = (await Promise.all(entries.map(async (entry) => ({
        name: entry.threat.name,
        probability: await readStoredProbability(db, entry.threat.stixId, ransomwareOutcomeId),
      })))).sort((a, b) => (b.probability - a.probability) || a.name.localeCompare(b.name));

      const { topActors } = await services.withOrigin(adminOrigin).threatAnalyses
        .getMatchingActorsForOutcome(ransomwareOutcomeId);

      expect(topActors.map((actor) => actor.analysisName)).toEqual(expected.map((entry) => entry.name));
    });

    it('should not list a threat whose record lacks the minimum evidence', async () => {
      const entry = buildDisruptionEntry();
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([entry], tenantId, 'stix-import');
      await db.update(threatAnalyses).set({ outcomeEvidenceSufficient: false }).where(eq(threatAnalyses.stixId, entry.threat.stixId));

      const { topActors, matchingCount } = await services.withOrigin(adminOrigin).threatAnalyses
        .getMatchingActorsForOutcome(getOutcomeId(AttackOutcome_ServiceDisruption));

      expect(topActors).toHaveLength(0);
      expect(matchingCount).toBe(0);
    });

    it('should carry the resourceLevel/primaryMotivation an actor never stated as null', async () => {
      const entry = buildDisruptionEntry();
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([{
        ...entry,
        threat: { ...entry.threat, primaryMotivation: null, resourceLevel: null },
      }], tenantId, 'stix-import');
      const disruptionOutcomeId = getOutcomeId(AttackOutcome_ServiceDisruption);

      const { topActors, distributions } = await services.withOrigin(adminOrigin).threatAnalyses
        .getMatchingActorsForOutcome(disruptionOutcomeId);

      expect(topActors).toHaveLength(1);
      expect(distributions.resourceLevel).toEqual([{ value: null, count: 1, share: 1 }]);
      expect(distributions.primaryMotivation).toEqual([{ value: null, count: 1, share: 1 }]);
    });

    it('should return the confidence gate in force alongside the actors', async () => {
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([buildDisruptionEntry()], tenantId, 'stix-import');
      const disruptionOutcomeId = getOutcomeId(AttackOutcome_ServiceDisruption);

      const { gate } = await services.withOrigin(adminOrigin).threatAnalyses
        .getMatchingActorsForOutcome(disruptionOutcomeId);

      expect(gate).toBe(THREAT_RELEVANCE_DEFAULTS.confidenceGate);
    });

    it('should return no actors for an outcome nothing matches', async () => {
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([buildParsedEntry('initial')], tenantId, 'stix-import');
      const disruptionOutcomeId = getOutcomeId(AttackOutcome_ServiceDisruption);

      const { topActors } = await services.withOrigin(adminOrigin).threatAnalyses
        .getMatchingActorsForOutcome(disruptionOutcomeId);

      expect(topActors).toHaveLength(0);
    });

    it('should not expose another tenant\'s analyses', async () => {
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([buildDisruptionEntry()], tenantId, 'stix-import');
      const disruptionOutcomeId = getOutcomeId(AttackOutcome_ServiceDisruption);

      const otherTenantId = await createTenant(services, adminUserId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };
      const otherDisruptionOutcomeId = deriveSeedId(otherTenantId, AttackOutcome_ServiceDisruption);

      const { topActors } = await services.withOrigin(otherOrigin).threatAnalyses
        .getMatchingActorsForOutcome(otherDisruptionOutcomeId);
      expect(topActors).toHaveLength(0);

      // The other tenant's outcome id read against the first tenant's origin: the percentages
      // are filed under the first tenant's own outcome ids, so nothing matches it.
      const crossTenantRead = await services.withOrigin(adminOrigin).threatAnalyses
        .getMatchingActorsForOutcome(otherDisruptionOutcomeId);
      expect(crossTenantRead.topActors).toHaveLength(0);

      // The first tenant's own outcome still reads normally.
      const ownRead = await services.withOrigin(adminOrigin).threatAnalyses
        .getMatchingActorsForOutcome(disruptionOutcomeId);
      expect(ownRead.topActors).toHaveLength(1);
    });
  });

  describe('tenant isolation', () => {
    it('should not expose one tenant analyses to another', async () => {
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([buildParsedEntry('initial')], tenantId, 'stix-import');
      const [{ id: analysisId }] = await services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS).then((r) => r.items);

      const otherTenantId = await createTenant(services, adminUserId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };

      expect(await services.withOrigin(otherOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS).then((r) => r.items)).toHaveLength(0);
      expect(await services.withOrigin(otherOrigin).threatAnalyses.getDetail(analysisId)).toBeUndefined();
    });

    // `getAttackerMixtureEvidenceByProfile` under a `system` origin relies entirely on its own explicit
    // `tenantId` scoping (the secured views apply none) — this is the tenant filter of
    // `findSelectedThreats`, not exercised by the client-origin tests above.
    it('should scope getAttackerMixtureEvidenceByProfile to the given tenantId under a system origin', async () => {
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([buildDisruptionEntry()], tenantId, 'stix-import');
      const disruptionOutcomeId = getOutcomeId(AttackOutcome_ServiceDisruption);
      const otherTenantId = await createTenant(services, adminUserId);

      const [evidence] = await services.withOrigin({ type: 'system' }).threatAnalyses.getAttackerMixtureEvidenceByProfile({
        attackOutcomeIds: [disruptionOutcomeId],
        profiles: [{ countryIds: [], sectorIds: [] }],
        tenantId,
      });
      expect(evidence.get(disruptionOutcomeId)!.groups).toHaveLength(1);

      // Same outcome, empty-catalog tenant: no groups, no cross-tenant leak.
      const [otherEvidence] = await services.withOrigin({ type: 'system' }).threatAnalyses.getAttackerMixtureEvidenceByProfile({
        attackOutcomeIds: [disruptionOutcomeId],
        profiles: [{ countryIds: [], sectorIds: [] }],
        tenantId: otherTenantId,
      });
      expect(otherEvidence.get(disruptionOutcomeId)!.groups).toHaveLength(0);
    });
  });
});
