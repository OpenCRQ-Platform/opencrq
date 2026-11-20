import type { EventOrigin, ParsedThreatInput } from '@app/module';
import { AttackOutcome_DataBreachResale, deriveSeedId, threatActivityAnchors, threatAnalyses, threatAnalysesRepository, threatAnalysisAliases, threatAnalysisAttributions, threatAnalysisCves, threatAnalysisGoals, threatAnalysisLocations, threatAnalysisOutcomeProbabilities, threatAnalysisRoles, threatAnalysisSecondaryMotivations, threatAnalysisSectors, threatAnalysisTechniques, threatAnalysisThreatActorTypes } from '@app/module';
import { eq, getTableName } from 'drizzle-orm';
import pg from 'pg';
import { beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { expectReplayedSyncSilent, recordDataChanges } from '../../helpers/replayed-sync';
import { buildDisruptionEntry, buildParsedEntry, DATA_BREACH_DESCRIPTION, DEFAULT_LIST_PARAMS, DEFAULT_PROVENANCE, readStoredProbability, THREAT_ID } from '../../helpers/threat-analyses-fixtures';
import { db } from '../../setup/db';
import { createTestServices, repositoryContextOf, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

/**
 * Drizzle wraps the driver error, so the violated constraint is read off the cause rather than
 * matched on the message: asserting the name is what proves a specific key rejected the write and
 * not some unrelated failure.
 */
const violatedConstraint = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null || !('cause' in error)) {
    return undefined;
  }
  const { cause } = error;
  if (typeof cause !== 'object' || cause === null || !('constraint' in cause)) {
    return undefined;
  }
  return typeof cause.constraint === 'string' ? cause.constraint : undefined;
};

// Aliases have no read path yet (they exist for the upcoming cross-source group clustering), so
// the persisted rows are read straight from the table.
const persistedAliases = async (analysisId: string): Promise<Array<string>> =>
  (await db
    .select({ alias: threatAnalysisAliases.alias })
    .from(threatAnalysisAliases)
    .where(eq(threatAnalysisAliases.analysisId, analysisId)))
    .map((row) => row.alias)
    // Sorted in JS: the assertion must not depend on the server's collation.
    .sort();

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

  /**
   * Activity is columns written by the recompute job alone, which the dispatcher books on the
   * ingestion's own doorbell in the product, so every read of one comes after a run of it here.
   */
  const recomputeActivity = async (params?: { now?: Date, isDailyBooking?: boolean }): Promise<void> => {
    const isDailyBooking = params?.isDailyBooking ?? false;
    await services
      .withOrigin({ type: 'job', tenantId, jobKind: 'threat-activity-recompute', interactive: !isDailyBooking })
      .threatActivity.recomputeActivity({
        now: params?.now ?? new Date(),
        isDailyBooking,
      });
  };

  /** The list's scores and counts are projections their job alone writes, as activity is above. */
  const recomputeListProjections = async (): Promise<{ scored: number, counted: number }> =>
    services
      .withOrigin({ type: 'job', tenantId, jobKind: 'threat-list-projection-recompute', interactive: false })
      .threatAnalyses.recomputeListProjections();

  /**
   * The activity fold and the OpenCTI mirror rebuild update the same analysis rows of a tenant in
   * one transaction each, and taking them in unrelated orders deadlocked a real backfill. The order
   * both agree on is the primary key, which this reads off the statements the fold actually issues.
   */
  it('should update the analysis rows of the fold in id order', async () => {
    for (let index = 0; index < 6; index += 1) {
      const entry = buildParsedEntry();
      entry.threat.stixId = `intrusion-set--22222222-2222-4222-8222-2222222222${String(index).padStart(2, '0')}`;
      entry.threat.name = `Folded Actor ${index}`;
      entry.threat.mitreGroupId = `G88${String(index).padStart(2, '0')}`;
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([entry], tenantId, 'stix-import');
    }
    const ids = (await db.select({ id: threatAnalyses.id }).from(threatAnalyses)).map((row) => row.id);
    const lowest = [...ids].sort((left, right) => left.localeCompare(right))[0];
    // An update rewrites the tuple at the end of the heap, so the lowest id is the last row an
    // unordered read hands over: without the agreed order the fold would take it last too.
    await db.update(threatAnalyses).set({ name: 'Moved Actor' }).where(eq(threatAnalyses.id, lowest));

    const updatedIds: Array<string> = [];
    const original = pg.Client.prototype.query;
    // Every statement of the process reaches the driver, whichever Drizzle instance emitted it. The
    // id is read off the placeholder the statement itself names, the fold having two shapes.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- wraps the overloaded method with a pass-through of the same overloads
    pg.Client.prototype.query = function capture(this: pg.Client, ...args: Array<unknown>) {
      const [first, second] = args;
      const text = typeof first === 'string'
        ? first
        : typeof first === 'object' && first !== null && 'text' in first && typeof first.text === 'string' ? first.text : '';
      const params = Array.isArray(second)
        ? second
        : typeof first === 'object' && first !== null && 'values' in first && Array.isArray(first.values) ? first.values : [];
      const idPlaceholder = /^update "threat_analyses" set "last_observed_at".*"threat_analyses"\."id" = \$(\d+)/s.exec(text);
      if (idPlaceholder) {
        updatedIds.push(String(params[Number(idPlaceholder[1]) - 1]));
      }
      return (original as (...rest: Array<unknown>) => unknown).apply(this, args);
    } as typeof original;
    try {
      await recomputeActivity();
    } finally {
      pg.Client.prototype.query = original;
    }

    expect(updatedIds).toHaveLength(6);
    expect(updatedIds).toEqual([...updatedIds].sort((left, right) => left.localeCompare(right)));
  });

  describe('ingestBundle', () => {
    it('should create a new analysis with its child collections on first ingestion', async () => {
      const result = await services.withOrigin(adminOrigin).threatAnalyses
        .ingestBundle([buildParsedEntry('initial')], tenantId, 'stix-import');

      expect(result).toEqual({ created: 1, updated: 0, unchanged: 0, skipped: 0 });

      await recomputeListProjections();
      const list = await services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS).then((r) => r.items);
      expect(list).toHaveLength(1);
      expect(list[0].stixId).toBe(THREAT_ID);
      expect(list[0].name).toBe('Test Intrusion Set');
      expect(list[0].mitreGroupId).toBe('G9999');
      // 2 targeted vulnerabilities, 1 technique with a resolved MITRE id (both attack-patterns
      // have a non-null mitreExternalId, even the unrecognized one, it's just not matched later).
      expect(list[0].cveCount).toBe(2);
      expect(list[0].techniqueCount).toBe(2);
    });

    it('should write the analysis row from its source\'s stated attributes, reading a blank string as absent', async () => {
      const entry = buildParsedEntry('initial');
      // Blank and padded claims: a STIX producer is free to emit either, and the canonical row is
      // what the rest of the platform joins and filters on.
      const stated = {
        ...entry,
        threat: { ...entry.threat, description: '   ', mitreGroupId: ' G9999 ' },
      };
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([stated], tenantId, 'stix-import');

      const [{ id: analysisId }] = await services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS).then((r) => r.items);
      const detail = await services.withOrigin(adminOrigin).threatAnalyses.getDetail(analysisId);

      expect(detail!.analysis).toMatchObject({
        stixId: stated.threat.stixId,
        name: stated.threat.name,
        description: null,
        mitreGroupId: 'G9999',
        confidence: stated.threat.confidence,
        stixCreated: stated.threat.stixCreated,
        firstSeen: stated.threat.firstSeen,
        lastSeen: stated.threat.lastSeen,
        primaryMotivation: stated.threat.primaryMotivation,
        resourceLevel: stated.threat.resourceLevel,
      });
    });

    it('should upsert (not duplicate) and replace child collections on re-ingestion', async () => {
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([buildParsedEntry('initial')], tenantId, 'stix-import');

      const result = await services.withOrigin(adminOrigin).threatAnalyses
        .ingestBundle([buildParsedEntry('updated')], tenantId, 'stix-import');

      expect(result).toEqual({ created: 0, updated: 1, unchanged: 0, skipped: 0 });

      const list = await services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS).then((r) => r.items);
      expect(list).toHaveLength(1);
      expect(list[0].name).toBe('Test Intrusion Set (renamed)');

      const detail = await services.withOrigin(adminOrigin).threatAnalyses.getDetail(list[0].id);
      // The "updated" variant no longer targets the Western Europe region: replaceAnalysisChildren
      // must have deleted it, not merely appended the new bundle's rows.
      expect(detail!.locations).toHaveLength(1);
      expect(detail!.locations[0].name).toBe('France');
    });

    describe('a threat ingested again', () => {
      // Every one of the ten claim tables holds a row, so a replay that rewrites any of them shows.
      const withEveryClaim = (entry: ParsedThreatInput): ParsedThreatInput => ({
        ...entry,
        threat: { ...entry.threat, primaryMotivation: null },
        secondaryMotivations: ['dominance'],
        goals: ['data breach'],
        threatActorTypes: ['crime-syndicate'],
        roles: ['agent'],
        attributions: [{
          ...DEFAULT_PROVENANCE,
          stixRelationId: `relationship--attributed-from-${entry.threat.name}`,
          targetStixId: 'intrusion-set--other',
          producerStixId: 'identity--producer',
          producerName: 'Producer',
          isInferred: true,
          relCreated: new Date('2024-01-01T00:00:00.123Z'),
          relStartTime: null,
          relStopTime: new Date('2024-02-01T00:00:00.000Z'),
          relModified: null,
          relConfidence: 50,
        }],
        sectors: [{
          ...DEFAULT_PROVENANCE,
          stixId: 'identity--finance',
          stixRelationId: `relationship--sector-of-${entry.threat.name}`,
          name: 'Finance',
          relCreated: null,
          relStartTime: null,
          relStopTime: null,
          relModified: null,
          relConfidence: 70,
        }],
      });
      const bundle = (): Array<ParsedThreatInput> => [withEveryClaim(buildParsedEntry('initial')), withEveryClaim(buildDisruptionEntry())];

      it('should ring nothing and move no updated_at when the object is unchanged', async () => {
        await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle(bundle(), tenantId, 'stix-import');
        const [before] = await db.select().from(threatAnalyses).where(eq(threatAnalyses.stixId, THREAT_ID));
        const probabilitiesBefore = await db.select().from(threatAnalysisOutcomeProbabilities);
        expect(probabilitiesBefore.length).toBeGreaterThan(0);
        const claimTables = [threatAnalysisAliases, threatAnalysisSecondaryMotivations, threatAnalysisGoals, threatAnalysisThreatActorTypes, threatAnalysisRoles, threatAnalysisAttributions, threatAnalysisLocations, threatAnalysisSectors, threatAnalysisCves, threatAnalysisTechniques];
        for (const table of claimTables) {
          expect(await db.select().from(table), getTableName(table)).not.toHaveLength(0);
        }

        await expectReplayedSyncSilent(() => services.withOrigin(adminOrigin).threatAnalyses.ingestBundle(bundle(), tenantId, 'stix-import'));

        const [after] = await db.select().from(threatAnalyses).where(eq(threatAnalyses.stixId, THREAT_ID));
        expect(after.updatedAt).toEqual(before.updatedAt);
        expect(after.lastIngestedAt.getTime()).toBeGreaterThan(before.lastIngestedAt.getTime());
        expect(await db.select().from(threatAnalysisOutcomeProbabilities)).toEqual(probabilitiesBefore);
      });

      it('should count an actor stated again as unchanged, and one with a changed attribute or claim as updated', async () => {
        const ingestAll = (entries: Array<ParsedThreatInput>) => services.withOrigin(adminOrigin).threatAnalyses.ingestBundle(entries, tenantId, 'stix-import');
        await ingestAll(bundle());
        expect(await ingestAll(bundle())).toEqual({ created: 0, updated: 0, unchanged: 2, skipped: 0 });

        const [first, second] = bundle();
        const attributeOnly = { ...first, threat: { ...first.threat, description: 'Another description.' } };
        expect(await ingestAll([attributeOnly, second])).toEqual({ created: 0, updated: 1, unchanged: 1, skipped: 0 });

        const claimOnly = { ...second, sectors: second.sectors.map((sector) => ({ ...sector, relConfidence: 10 })) };
        expect(await ingestAll([attributeOnly, claimOnly])).toEqual({ created: 0, updated: 1, unchanged: 1, skipped: 0 });
      });

      it('should ring only the rows of the claim that changed', async () => {
        await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([buildParsedEntry('initial')], tenantId, 'stix-import');
        const changed = buildParsedEntry('initial');
        changed.locations = changed.locations.map((location) => (location.name === 'France' ? { ...location, relConfidence: 10 } : location));

        const rang = await recordDataChanges(() => services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([changed], tenantId, 'stix-import'));

        expect(rang.map((event) => `${event.table}:${event.op}`).sort()).toEqual([
          'threat_analyses:UPDATE',
          'threat_analysis_locations:DELETE',
          'threat_analysis_locations:INSERT',
        ]);
      });

      it('should rescore a re-ingested threat whose description changed, and ring only the percentages that moved', async () => {
        const dataBreachOutcomeId = getOutcomeId(AttackOutcome_DataBreachResale);
        await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([buildParsedEntry('initial')], tenantId, 'stix-import');
        const before = await readStoredProbability(db, THREAT_ID, dataBreachOutcomeId);

        const described = buildParsedEntry('initial');
        described.threat = { ...described.threat, description: DATA_BREACH_DESCRIPTION };
        const rang = await recordDataChanges(() => services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([described], tenantId, 'stix-import'));

        expect(await readStoredProbability(db, THREAT_ID, dataBreachOutcomeId)).toBeGreaterThan(before);
        expect(rang.map((event) => event.table)).toContain('threat_analysis_outcome_probabilities');
        expect(rang.map((event) => event.table)).toContain('threat_analyses');
      });

      it('should report no write, and ring nothing, for a value the database drops as a duplicate', async () => {
        await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([buildParsedEntry('initial')], tenantId, 'stix-import');
        const [analysis] = await db.select().from(threatAnalyses).where(eq(threatAnalyses.stixId, THREAT_ID));
        // The service dedups before it writes, so only a disagreement between its `toLowerCase()` and
        // the database's `lower()` reaches the unique index: two casings stand in for it here.
        const children = (): Parameters<typeof threatAnalysesRepository.replaceAnalysisChildren>[2] => ({
          aliases: ['Foo', 'foo'].map((alias) => ({ id: uuidv7(), analysisId: analysis.id, alias })),
          secondaryMotivations: [],
          goals: [],
          threatActorTypes: [],
          roles: [],
          attributions: [],
          locations: [],
          sectors: [],
          cves: [],
          techniques: [],
        });
        const context = repositoryContextOf(db, adminOrigin);
        await db.delete(threatAnalysisAliases);
        expect(await threatAnalysesRepository.replaceAnalysisChildren(context, analysis.id, children())).toBe(true);

        let wrote = true;
        const rang = await recordDataChanges(async () => {
          wrote = await threatAnalysesRepository.replaceAnalysisChildren(context, analysis.id, children());
        });

        expect(rang).toEqual([]);
        expect(wrote).toBe(false);
      });

      it('should write only the claims that changed, and keep the rows of the others', async () => {
        await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([buildParsedEntry('initial')], tenantId, 'stix-import');
        const locationIds = async () => new Map(
          (await db.select().from(threatAnalysisLocations)).map((row) => [row.name, row.id]),
        );
        const aliasIds = async () => new Map(
          (await db.select().from(threatAnalysisAliases)).map((row) => [row.alias, row.id]),
        );
        const locationsBefore = await locationIds();
        const aliasesBefore = await aliasIds();
        const [analysisBefore] = await db.select().from(threatAnalyses).where(eq(threatAnalyses.stixId, THREAT_ID));

        await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([buildParsedEntry('updated')], tenantId, 'stix-import');

        const locationsAfter = await locationIds();
        expect([...locationsAfter.keys()]).toEqual(['France']);
        expect(locationsAfter.get('France')).toBe(locationsBefore.get('France'));
        const aliasesAfter = await aliasIds();
        expect([...aliasesAfter.keys()].sort()).toEqual(['TG-0001', 'Test Group']);
        expect(aliasesAfter.get('Test Group')).toBe(aliasesBefore.get('Test Group'));
        const [analysisAfter] = await db.select().from(threatAnalyses).where(eq(threatAnalyses.stixId, THREAT_ID));
        expect(analysisAfter.updatedAt.getTime()).toBeGreaterThan(analysisBefore.updatedAt.getTime());
      });

      it('should move updated_at when a stated claim value changes, so the recomputes fold it', async () => {
        await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([buildParsedEntry('initial')], tenantId, 'stix-import');
        const [before] = await db.select().from(threatAnalyses).where(eq(threatAnalyses.stixId, THREAT_ID));
        const [france] = await db.select().from(threatAnalysisLocations).where(eq(threatAnalysisLocations.name, 'France'));

        const changed = buildParsedEntry('initial');
        changed.locations = changed.locations.map((location) => (location.name === 'France' ? { ...location, relConfidence: 10 } : location));
        await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([changed], tenantId, 'stix-import');

        const [replaced] = await db.select().from(threatAnalysisLocations).where(eq(threatAnalysisLocations.name, 'France'));
        expect(replaced.relConfidence).toBe(10);
        expect(replaced.id).not.toBe(france.id);
        const [after] = await db.select().from(threatAnalyses).where(eq(threatAnalyses.stixId, THREAT_ID));
        expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
      });
    });

    describe('actor class', () => {
      it('should derive the class from the resource level at ingestion', async () => {
        await services.withOrigin(adminOrigin).threatAnalyses
          .ingestBundle([buildParsedEntry('initial')], tenantId, 'stix-import');

        const [list] = await services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS).then((r) => r.items);
        const detail = await services.withOrigin(adminOrigin).threatAnalyses.getDetail(list.id);
        expect(detail!.analysis.actorClass).toBe('state_sponsored');
        expect(detail!.analysis.actorClassOverride).toBeNull();
      });

      it('should let a label outrank the resource level', async () => {
        const entry = buildParsedEntry('initial');
        entry.threat.labels = ['Ransomware-as-a-service'];
        await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([entry], tenantId, 'stix-import');

        const [list] = await services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS).then((r) => r.items);
        const detail = await services.withOrigin(adminOrigin).threatAnalyses.getDetail(list.id);
        expect(detail!.analysis.actorClass).toBe('ransomware_operator');
      });

      it('should keep a manually set class through a resync, and clear it back to the derived class', async () => {
        const scoped = services.withOrigin(adminOrigin).threatAnalyses;
        await scoped.ingestBundle([buildParsedEntry('initial')], tenantId, 'stix-import');
        const [list] = await scoped.list(DEFAULT_LIST_PARAMS).then((r) => r.items);

        await scoped.setActorClassOverride(list.id, 'hacktivist');
        await scoped.ingestBundle([buildParsedEntry('updated')], tenantId, 'stix-import');

        const afterResync = await scoped.getDetail(list.id);
        expect(afterResync!.analysis.actorClassOverride).toBe('hacktivist');
        expect(afterResync!.analysis.actorClass).toBe('state_sponsored');

        await scoped.setActorClassOverride(list.id, null);
        const cleared = await scoped.getDetail(list.id);
        expect(cleared!.analysis.actorClassOverride).toBeNull();
        expect(cleared!.analysis.actorClass).toBe('state_sponsored');
      });
    });

    /**
     * One STIX id is one actor. Nothing folds two upstream objects together, whatever they claim
     * about themselves: a visible duplicate a reader can explain beats an invisible wrong merge,
     * and a customer who wants one actor merges the two objects upstream, in OpenCTI.
     */
    describe('one STIX id, one actor', () => {
      const TWIN_STIX_ID = 'intrusion-set--twin-test-actor';
      const BOTH_STIX_IDS = [THREAT_ID, TWIN_STIX_ID].sort();

      // A second upstream object that differs from the base fixture by its STIX id and agrees with
      // it on whatever `shares` names.
      const buildTwinEntry = (shares: { name?: true, alias?: true, mitreGroupId?: true }): ParsedThreatInput => {
        const base = buildParsedEntry('initial');
        return {
          ...base,
          threat: {
            ...base.threat,
            stixId: TWIN_STIX_ID,
            name: shares.name === true ? base.threat.name : 'Twin Intrusion Set',
            // Unstated rather than a second group id: MITRE attributing the two objects to
            // different groups is itself a reason to keep them apart, and it would hide what the
            // name and alias cases are here to show.
            mitreGroupId: shares.mitreGroupId === true ? base.threat.mitreGroupId : null,
          },
          aliases: shares.alias === true ? ['Test Group'] : ['Twin Group'],
        };
      };

      const ingest = async (entries: Array<ParsedThreatInput>, kind: 'connector' | 'stix-import') =>
        services.withOrigin(adminOrigin).threatAnalyses.ingestBundle(entries, tenantId, kind);

      const listedStixIds = async (): Promise<Array<string>> =>
        services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS)
          .then((result) => result.items.map((item) => item.stixId).sort());

      it('should keep two actors when a second STIX id states the same name', async () => {
        await ingest([buildParsedEntry('initial')], 'connector');

        const result = await ingest([buildTwinEntry({ name: true })], 'stix-import');

        expect(result).toEqual({ created: 1, updated: 0, unchanged: 0, skipped: 0 });
        expect(await listedStixIds()).toEqual(BOTH_STIX_IDS);
      });

      it('should keep two actors when a second STIX id states the same alias', async () => {
        await ingest([buildParsedEntry('initial')], 'connector');

        await ingest([buildTwinEntry({ alias: true })], 'stix-import');

        expect(await listedStixIds()).toEqual(BOTH_STIX_IDS);
      });

      it('should keep two actors when a second STIX id states the same MITRE group id', async () => {
        await ingest([buildParsedEntry('initial')], 'connector');

        await ingest([buildTwinEntry({ mitreGroupId: true })], 'stix-import');

        expect(await listedStixIds()).toEqual(BOTH_STIX_IDS);
      });

      it('should create two actors from one bundle listing the same actor under two STIX ids', async () => {
        const result = await ingest(
          [buildParsedEntry('initial'), buildTwinEntry({ name: true, alias: true, mitreGroupId: true })],
          'stix-import',
        );

        expect(result).toEqual({ created: 2, updated: 0, unchanged: 0, skipped: 0 });
        expect(await listedStixIds()).toEqual(BOTH_STIX_IDS);
      });

      it('should update the actor in place when another feed re-ingests its own STIX id', async () => {
        await ingest([buildParsedEntry('initial')], 'connector');

        const result = await ingest([buildParsedEntry('updated')], 'stix-import');

        expect(result).toEqual({ created: 0, updated: 1, unchanged: 0, skipped: 0 });
        const items = await services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS).then((r) => r.items);
        expect(items).toHaveLength(1);
        expect(items[0].name).toBe('Test Intrusion Set (renamed)');
      });

      it('should leave each actor holding only what its own upstream object stated', async () => {
        await ingest([buildParsedEntry('initial')], 'connector');
        await ingest([buildTwinEntry({ name: true, alias: true, mitreGroupId: true })], 'stix-import');

        const items = await services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS).then((r) => r.items);
        const twin = items.find((item) => item.stixId === TWIN_STIX_ID)!;
        const detail = await services.withOrigin(adminOrigin).threatAnalyses.getDetail(twin.id);

        expect(detail!.origin.kind).toBe('stix-import');
        expect(await persistedAliases(twin.id)).toEqual(['Test Group']);
      });
    });

    describe('aliases', () => {
      it('should persist the alias set, replace it on re-ingestion and drop case-insensitive duplicates', async () => {
        await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([buildParsedEntry('initial')], tenantId, 'stix-import');
        const [{ id: analysisId }] = await services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS).then((r) => r.items);

        expect(await persistedAliases(analysisId)).toEqual(['TG-9999', 'Test Group']);

        await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([buildParsedEntry('updated')], tenantId, 'stix-import');

        // Replaced (TG-9999 is gone, TG-0001 is in) and 'test group' collapsed onto 'Test Group'.
        // Without the service-side dedup the unique index on (analysis_id, lower(alias)) would
        // abort the whole entry transaction instead.
        expect(await persistedAliases(analysisId)).toEqual(['TG-0001', 'Test Group']);
      });

      it('should cascade-delete the alias rows with their analysis', async () => {
        await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([buildParsedEntry('initial')], tenantId, 'stix-import');
        const [{ id: analysisId }] = await services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS).then((r) => r.items);
        expect(await persistedAliases(analysisId)).toHaveLength(2);

        await db.delete(threatAnalyses).where(eq(threatAnalyses.id, analysisId));

        expect(await persistedAliases(analysisId)).toHaveLength(0);
      });
    });

    describe('relationship dates across re-ingestions', () => {
      const ORIGINAL = new Date('2024-03-01T00:00:00.000Z');
      const REBUILT = new Date('2026-07-26T00:00:00.000Z');
      const OLDER = new Date('2022-01-15T00:00:00.000Z');

      // Same entry, only the relationship `created` dates move: this is what an upstream OpenCTI
      // rebuild does to a bundle that describes the exact same evidence.
      const buildDatedEntry = (relCreated: Date): ParsedThreatInput => {
        const base = buildParsedEntry('initial');
        return {
          ...base,
          locations: base.locations.map((location) => ({ ...location, relCreated, relStartTime: null })),
          sectors: base.sectors.map((sector) => ({ ...sector, relCreated })),
          cves: base.cves.map((cve) => ({ ...cve, relCreated })),
          techniques: base.techniques.map((technique) => ({ ...technique, relCreated })),
        };
      };

      // Keyed by child stix id and sorted: `findAnalysisDetail` has no ORDER BY, so comparing the
      // raw SQL result order would silently pass today and turn flaky the day the fixture uses
      // per-child dates.
      const ingestedDates = async (relCreated: Date) => {
        await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([buildDatedEntry(relCreated)], tenantId, 'stix-import');
        const [{ id }] = await services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS).then((r) => r.items);
        const detail = await services.withOrigin(adminOrigin).threatAnalyses.getDetail(id);
        return [
          ...detail!.locations,
          ...detail!.sectors,
          ...detail!.cves,
          ...detail!.techniques,
        ]
          .map((row) => `${row.stixId}:${row.relCreated?.toISOString() ?? 'none'}`)
          .sort();
      };

      // The stored date follows the bundle in both directions: a claim is worth what its source
      // currently states, and nothing here holds an older value against it. What that exposes is
      // bounded: `rel_created` reaches `last_authored_at` alone, for a relationship carrying no
      // activity window, and never `last_observed_at`. An upstream export that restates `created`
      // therefore moves the authoring reading of an actor, never the observed one.
      it('should store the relationship dates the bundle states, forward or backward', async () => {
        const initial = await ingestedDates(ORIGINAL);
        expect(initial).toHaveLength(7);
        expect(initial.every((entry) => entry.endsWith(ORIGINAL.toISOString()))).toBe(true);

        const afterRebuild = await ingestedDates(REBUILT);
        expect(afterRebuild.every((entry) => entry.endsWith(REBUILT.toISOString()))).toBe(true);

        const afterOlder = await ingestedDates(OLDER);
        expect(afterOlder.every((entry) => entry.endsWith(OLDER.toISOString()))).toBe(true);
      });
    });
  });

  /**
   * A child row belongs to one actor and is keyed within it: the same relationship cannot be stated
   * twice for one actor, and the actor's disappearance takes every claim with it.
   */
  describe('analysis/child integrity', () => {
    it('should reject a second child row for the same relationship on one analysis', async () => {
      await services.withOrigin(adminOrigin).threatAnalyses
        .ingestBundle([buildParsedEntry('initial')], tenantId, 'stix-import');
      const [{ id: analysisId }] = await services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS).then((r) => r.items);
      const [technique] = await db.select().from(threatAnalysisTechniques)
        .where(eq(threatAnalysisTechniques.analysisId, analysisId));

      const error: unknown = await db.insert(threatAnalysisTechniques).values({
        ...technique,
        id: uuidv7(),
      }).then(() => undefined, (rejection: unknown) => rejection);

      expect(violatedConstraint(error)).toBe('threat_analysis_techniques_analysis_relation_unique');
    });

    it('should reject a second alias differing only in case on one analysis', async () => {
      await services.withOrigin(adminOrigin).threatAnalyses
        .ingestBundle([buildParsedEntry('initial')], tenantId, 'stix-import');
      const [{ id: analysisId }] = await services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS).then((r) => r.items);

      const error: unknown = await db.insert(threatAnalysisAliases).values({
        id: uuidv7(),
        analysisId,
        alias: 'test group',
      }).then(() => undefined, (rejection: unknown) => rejection);

      expect(violatedConstraint(error)).toBe('threat_analysis_aliases_analysis_alias_unique');
    });

    it('should take every child and anchor with the analysis when it is deleted', async () => {
      await services.withOrigin(adminOrigin).threatAnalyses
        .ingestBundle([buildParsedEntry('initial')], tenantId, 'stix-import');
      const [{ id: analysisId }] = await services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS).then((r) => r.items);
      await db.insert(threatActivityAnchors).values({
        id: uuidv7(),
        tenantId,
        analysisId,
        kind: 'actor',
        stixRelationId: THREAT_ID,
        observedAt: null,
        authoredAt: null,
        confidence: null,
        producerStixId: null,
      });

      await db.delete(threatAnalyses).where(eq(threatAnalyses.id, analysisId));

      expect(await db.select().from(threatAnalysisAliases)).toHaveLength(0);
      expect(await db.select().from(threatAnalysisTechniques)).toHaveLength(0);
      expect(await db.select().from(threatAnalysisCves)).toHaveLength(0);
      expect(await db.select().from(threatAnalysisLocations)).toHaveLength(0);
      expect(await db.select().from(threatAnalysisSectors)).toHaveLength(0);
      expect(await db.select().from(threatActivityAnchors)).toHaveLength(0);
      expect(await db.select().from(threatAnalysisOutcomeProbabilities)).toHaveLength(0);
    });
  });

  describe('retractActors', () => {
    it('should withdraw an actor of the named kind and everything it claims', async () => {
      await services.withOrigin(adminOrigin).threatAnalyses
        .ingestBundle([buildParsedEntry('initial')], tenantId, 'connector');

      const retraction = await services.withOrigin(adminOrigin).threatAnalyses
        .retractActors(tenantId, 'connector', [THREAT_ID]);

      expect(retraction.retracted).toBe(1);
      expect(await db.select().from(threatAnalyses)).toHaveLength(0);
      expect(await db.select().from(threatAnalysisTechniques)).toHaveLength(0);
    });

    /**
     * The kind belongs to the delete itself rather than to a select feeding it, so an actor another
     * feed has requalified since the caller decided to retract it is out of the statement's reach
     * instead of being taken by it. Driven by naming a kind the row does not carry, which is the
     * state such a requalification leaves behind.
     */
    it('should leave an actor whose kind is not the retracted one alone', async () => {
      await services.withOrigin(adminOrigin).threatAnalyses
        .ingestBundle([buildParsedEntry('initial')], tenantId, 'stix-import');

      const retraction = await services.withOrigin(adminOrigin).threatAnalyses
        .retractActors(tenantId, 'connector', [THREAT_ID]);

      expect(retraction.retracted).toBe(0);
      expect(await db.select().from(threatAnalyses)).toHaveLength(1);
    });
  });

  describe('deleteImported', () => {
    const CONNECTOR_THREAT_ID = 'intrusion-set--22222222-2222-2222-2222-222222222222';

    const connectorEntry = (): ParsedThreatInput => {
      const entry = buildParsedEntry('initial');
      return { ...entry, threat: { ...entry.threat, stixId: CONNECTOR_THREAT_ID, name: 'Connector Intrusion Set' } };
    };

    const analysisIdOf = async (stixId: string): Promise<string> => {
      const [row] = await db.select({ id: threatAnalyses.id }).from(threatAnalyses).where(eq(threatAnalyses.stixId, stixId));
      return row.id;
    };

    it('should delete an imported threat and everything it claims', async () => {
      await services.withOrigin(adminOrigin).threatAnalyses
        .ingestBundle([buildParsedEntry('initial')], tenantId, 'stix-import');

      const result = await services.withOrigin(adminOrigin).threatAnalyses
        .deleteImported([await analysisIdOf(THREAT_ID)]);

      expect(result.deleted).toBe(1);
      expect(await db.select().from(threatAnalyses)).toHaveLength(0);
      expect(await db.select().from(threatAnalysisTechniques)).toHaveLength(0);
    });

    it('should leave a connector threat alone even when its id is passed', async () => {
      const scoped = services.withOrigin(adminOrigin).threatAnalyses;
      await scoped.ingestBundle([buildParsedEntry('initial')], tenantId, 'stix-import');
      await scoped.ingestBundle([connectorEntry()], tenantId, 'connector');

      const result = await scoped.deleteImported([await analysisIdOf(THREAT_ID), await analysisIdOf(CONNECTOR_THREAT_ID)]);

      expect(result.deleted).toBe(1);
      const remaining = await db.select({ stixId: threatAnalyses.stixId }).from(threatAnalyses);
      expect(remaining).toEqual([{ stixId: CONNECTOR_THREAT_ID }]);
    });

    it('should not delete another tenant\'s imported threat', async () => {
      await services.withOrigin(adminOrigin).threatAnalyses
        .ingestBundle([buildParsedEntry('initial')], tenantId, 'stix-import');
      const otherTenantId = await createTenant(services, adminUserId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };

      const result = await services.withOrigin(otherOrigin).threatAnalyses
        .deleteImported([await analysisIdOf(THREAT_ID)]);

      expect(result.deleted).toBe(0);
      expect(await db.select().from(threatAnalyses)).toHaveLength(1);
    });
  });

  describe('list', () => {
    it('should narrow the list to one source kind', async () => {
      const scoped = services.withOrigin(adminOrigin).threatAnalyses;
      const entry = buildParsedEntry('initial');
      await scoped.ingestBundle([entry], tenantId, 'stix-import');
      await scoped.ingestBundle([{ ...entry, threat: { ...entry.threat, stixId: 'intrusion-set--33333333-3333-3333-3333-333333333333' } }], tenantId, 'connector');

      const imported = await scoped.list({ ...DEFAULT_LIST_PARAMS, kind: 'stix-import' });

      expect(imported.total).toBe(1);
      expect(imported.pending).toBe(1);
      expect(imported.items.map((item) => [item.stixId, item.kind])).toEqual([[THREAT_ID, 'stix-import']]);
    });

    it('should only list analyses belonging to the current tenant', async () => {
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([buildParsedEntry('initial')], tenantId, 'stix-import');

      const otherTenantId = await createTenant(services, adminUserId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };

      expect(await services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS).then((r) => r.items)).toHaveLength(1);
      expect(await services.withOrigin(otherOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS).then((r) => r.items)).toHaveLength(0);
    });

    // The row stays on the page (this list is a browser of the analyses themselves, not only a
    // ranking of their scores), but its derived columns read `null` rather than a misleading zero
    // until the projection catches up, and `pending` counts it for the UI to explain why.
    it('should report a freshly ingested analysis as pending until the projection recompute runs', async () => {
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([buildParsedEntry('initial')], tenantId, 'stix-import');

      const beforeRecompute = await services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS);
      expect(beforeRecompute.items).toHaveLength(1);
      expect(beforeRecompute.items[0].cveCount).toBeNull();
      expect(beforeRecompute.items[0].techniqueCount).toBeNull();
      expect(beforeRecompute.items[0].topOutcomeScore).toBeNull();
      expect(beforeRecompute.pending).toBe(1);

      await recomputeListProjections();

      const afterRecompute = await services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS);
      expect(afterRecompute.items[0].cveCount).not.toBeNull();
      expect(afterRecompute.items[0].techniqueCount).not.toBeNull();
      expect(afterRecompute.pending).toBe(0);
    });
  });

  describe('hasAny', () => {
    it('should report existence per tenant, not per catalog', async () => {
      const otherTenantId = await createTenant(services, adminUserId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };

      expect(await services.withOrigin(adminOrigin).threatAnalyses.hasAny()).toBe(false);
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([buildParsedEntry('initial')], tenantId, 'stix-import');
      expect(await services.withOrigin(adminOrigin).threatAnalyses.hasAny()).toBe(true);
      expect(await services.withOrigin(otherOrigin).threatAnalyses.hasAny()).toBe(false);
    });
  });

  describe('stored outcome probabilities', () => {
    it('should store one probability per counter outcome at ingest', async () => {
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([buildParsedEntry('initial')], tenantId, 'stix-import');
      const [{ id: analysisId }] = await services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS).then((r) => r.items);

      const rows = await db.select().from(threatAnalysisOutcomeProbabilities).where(eq(threatAnalysisOutcomeProbabilities.analysisId, analysisId));

      expect(rows).toHaveLength(7);
    });

    it('should admit an actor with no technique behind it on its stored percentage alone', async () => {
      const entry = buildDisruptionEntry();
      // Disruption Crew's own fixture technique overlap is Service Disruption only (see
      // `buildDisruptionEntry`'s own comment); dropping the techniques and declaring a `data breach`
      // goal and a data breach description instead leaves a match carried entirely by what the
      // record says.
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([{
        ...entry,
        threat: { ...entry.threat, primaryMotivation: null, description: DATA_BREACH_DESCRIPTION },
        goals: ['data breach'],
        techniques: [],
      }], tenantId, 'stix-import');
      const dataBreachOutcomeId = getOutcomeId(AttackOutcome_DataBreachResale);

      // Admitted by the outcome-scoped list on its percentage, with no technique claim behind it.
      const probability = await readStoredProbability(db, entry.threat.stixId, dataBreachOutcomeId);
      expect(probability).toBeGreaterThan(0.5);
      await recomputeListProjections();
      const scoped = await services.withOrigin(adminOrigin).threatAnalyses.list({ ...DEFAULT_LIST_PARAMS, outcomeId: dataBreachOutcomeId });
      expect(scoped.items).toHaveLength(1);
      expect(scoped.items[0].topOutcomeScore).toBeCloseTo(probability, 6);
    });
  });

  const getOutcomeId = (catalogId: string): string => deriveSeedId(tenantId, catalogId);
});
