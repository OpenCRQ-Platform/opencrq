import type { EventOrigin, ParsedThreatInput } from '@app/module';
import { ACTIVITY_HALF_LIFE_DAYS, ACTIVITY_SIGNAL_BASE_WEIGHT, AttackOutcome_Ransomware, AttackOutcome_ServiceDisruption, deriveSeedId, OUTCOME_COUNTER_VERSION, THREAT_RELEVANCE_DEFAULTS, threatActivityAnchors, threatAnalyses, threatAnalysisOutcomeProbabilities, threatAnalysisTechniques } from '@app/module';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { createTenantWithAdmin } from '../../helpers/factories';
import { buildDisruptionEntry, buildParsedEntry, buildRansomwareEntry, DEFAULT_LIST_PARAMS, DEFAULT_PROVENANCE, KNOWN_CVE_ID, MAX_TAU, outcomeWeightOf, readStoredProbability, UNKNOWN_CVE_ID, UNREMARKABLE_DESCRIPTION } from '../../helpers/threat-analyses-fixtures';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('Intrusion Set Analyses Service', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
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

  const getOutcomeId = (catalogId: string): string => deriveSeedId(tenantId, catalogId);

  describe('getRelevantForScenario', () => {
    const relevantFor = async (params: { attackOutcomeId: string, countryIds?: Array<string>, sectorIds?: Array<string>, organizationCountryName?: string | null, organizationSectorName?: string | null, analysisIds?: Array<string> }) =>
      services.withOrigin(adminOrigin).threatAnalyses.getRelevantForScenario({ countryIds: [], sectorIds: [], ...params });

    const ingest = async (...entries: Array<ParsedThreatInput>) =>
      services.withOrigin(adminOrigin).threatAnalyses.ingestBundle(entries, tenantId, 'stix-import');

    it('should list a threat on its stored percentage for the outcome, whatever it targets', async () => {
      const entry = buildRansomwareEntry();
      await ingest(entry);
      const ransomwareOutcomeId = getOutcomeId(AttackOutcome_Ransomware);
      const probability = await readStoredProbability(db, entry.threat.stixId, ransomwareOutcomeId);
      expect(probability).toBeGreaterThan(0.5);

      const countries = await services.withOrigin(adminOrigin).countries.getCountries();
      const sectors = await services.withOrigin(adminOrigin).sectors.getSectors();
      const france = countries.find((c) => c.name === 'France')!;
      const germany = countries.find((c) => c.name === 'Germany')!;
      const defense = sectors.find((s) => s.name === 'Defense')!;
      const agriculture = sectors.find((s) => s.name.startsWith('Agriculture'))!;
      const weight = outcomeWeightOf(probability);

      const { items: countryOnly } = await relevantFor({ attackOutcomeId: ransomwareOutcomeId, countryIds: [france.id] });
      expect(countryOnly).toHaveLength(1);
      expect(countryOnly[0].countryMatch).toBe(true);
      expect(countryOnly[0].sectorMatch).toBe(false);
      expect(countryOnly[0].combinedRelevance).toBeCloseTo(weight * 2.5 / MAX_TAU, 9);
      // "Western Europe" is a region (no resolved `country` field), excluded from the countries list.
      expect(countryOnly[0].countries).toEqual(['France']);
      expect(countryOnly[0].sectors).toEqual(['Defense']);

      const { items: sectorOnly } = await relevantFor({ attackOutcomeId: ransomwareOutcomeId, sectorIds: [defense.id] });
      expect(sectorOnly).toHaveLength(1);
      expect(sectorOnly[0].countryMatch).toBe(false);
      expect(sectorOnly[0].sectorMatch).toBe(true);
      expect(sectorOnly[0].combinedRelevance).toBeCloseTo(weight * 4 / MAX_TAU, 9);

      const { items: both } = await relevantFor({ attackOutcomeId: ransomwareOutcomeId, countryIds: [france.id], sectorIds: [defense.id] });
      expect(both[0].combinedRelevance).toBeCloseTo(weight, 9);

      // Targeting scales a listed threat, it never lists one.
      const { items: noMatch } = await relevantFor({ attackOutcomeId: ransomwareOutcomeId, countryIds: [germany.id], sectorIds: [agriculture.id] });
      expect(noMatch).toHaveLength(1);
      expect(noMatch[0].countryMatch).toBe(false);
      expect(noMatch[0].sectorMatch).toBe(false);
      expect(noMatch[0].combinedRelevance).toBeCloseTo(weight / MAX_TAU, 9);

      const { items: noProfile } = await relevantFor({ attackOutcomeId: ransomwareOutcomeId });
      expect(noProfile.map((item) => item.id)).toEqual(noMatch.map((item) => item.id));
    });

    it('should list a threat above 0.5 that targets nothing after an equally weighted one targeting country and sector', async () => {
      const targeted = buildRansomwareEntry({ stixId: 'intrusion-set--aaaaaaaa-0000-4000-8000-000000000001', name: 'Harbor Locksmiths', mitreGroupId: 'G9001' });
      const untargeted = {
        ...buildRansomwareEntry({ stixId: 'intrusion-set--aaaaaaaa-0000-4000-8000-000000000002', name: 'Aardvark Lockers', mitreGroupId: 'G9002' }),
        locations: [],
        sectors: [],
      };
      await ingest(untargeted, targeted);
      const ransomwareOutcomeId = getOutcomeId(AttackOutcome_Ransomware);
      for (const entry of [targeted, untargeted]) {
        expect(await readStoredProbability(db, entry.threat.stixId, ransomwareOutcomeId)).toBeGreaterThan(0.5);
      }

      const countries = await services.withOrigin(adminOrigin).countries.getCountries();
      const sectors = await services.withOrigin(adminOrigin).sectors.getSectors();
      const { items } = await relevantFor({
        attackOutcomeId: ransomwareOutcomeId,
        countryIds: [countries.find((c) => c.name === 'France')!.id],
        sectorIds: [sectors.find((s) => s.name === 'Defense')!.id],
      });

      // The untargeted one sorts first by name: only its targeting puts the other ahead.
      expect(items.map((item) => item.name)).toEqual(['Harbor Locksmiths', 'Aardvark Lockers']);
      expect(items[0].combinedRelevance).toBeGreaterThan(items[1].combinedRelevance);
    });

    it('should order threats of equal relevance by name', async () => {
      const second = { ...buildRansomwareEntry({ stixId: 'intrusion-set--aaaaaaaa-0000-4000-8000-000000000003', name: 'Zeta Lockers', mitreGroupId: 'G9003' }), locations: [], sectors: [] };
      const first = { ...buildRansomwareEntry({ stixId: 'intrusion-set--aaaaaaaa-0000-4000-8000-000000000004', name: 'Alpha Lockers', mitreGroupId: 'G9004' }), locations: [], sectors: [] };
      await ingest(second, first);
      const ransomwareOutcomeId = getOutcomeId(AttackOutcome_Ransomware);
      // The counter reads the name too, so two descriptions never store exactly the same percentage.
      await db.update(threatAnalysisOutcomeProbabilities).set({ probability: 0.9 })
        .where(eq(threatAnalysisOutcomeProbabilities.attackOutcomeId, ransomwareOutcomeId));

      const { items } = await relevantFor({ attackOutcomeId: ransomwareOutcomeId });

      expect(items[0].combinedRelevance).toBe(items[1].combinedRelevance);
      expect(items.map((item) => item.name)).toEqual(['Alpha Lockers', 'Zeta Lockers']);
    });

    it('should not list a threat at or below 0.5, even when it targets the organization\'s country and sector', async () => {
      // The base fixture describes nothing about ransomware, but targets France and Defense.
      const entry = buildParsedEntry('initial');
      await ingest(entry);
      const ransomwareOutcomeId = getOutcomeId(AttackOutcome_Ransomware);
      expect(await readStoredProbability(db, entry.threat.stixId, ransomwareOutcomeId)).toBeLessThanOrEqual(0.5);

      const countries = await services.withOrigin(adminOrigin).countries.getCountries();
      const sectors = await services.withOrigin(adminOrigin).sectors.getSectors();
      const { items } = await relevantFor({
        attackOutcomeId: ransomwareOutcomeId,
        countryIds: [countries.find((c) => c.name === 'France')!.id],
        sectorIds: [sectors.find((s) => s.name === 'Defense')!.id],
      });

      expect(items).toHaveLength(0);
    });

    it('should not list a threat whose record lacks the minimum evidence, whatever its percentage', async () => {
      const entry = buildRansomwareEntry();
      await ingest(entry);
      const ransomwareOutcomeId = getOutcomeId(AttackOutcome_Ransomware);
      expect(await readStoredProbability(db, entry.threat.stixId, ransomwareOutcomeId)).toBeGreaterThan(0.5);
      expect((await relevantFor({ attackOutcomeId: ransomwareOutcomeId })).items).toHaveLength(1);

      await db.update(threatAnalyses).set({ outcomeEvidenceSufficient: false }).where(eq(threatAnalyses.stixId, entry.threat.stixId));

      expect((await relevantFor({ attackOutcomeId: ransomwareOutcomeId })).items).toHaveLength(0);
    });

    it('should list an intrusion set on its percentage alone, whatever techniques it cites', async () => {
      const entry = buildDisruptionEntry();
      await ingest(entry);
      const disruptionOutcomeId = getOutcomeId(AttackOutcome_ServiceDisruption);
      const probability = await readStoredProbability(db, entry.threat.stixId, disruptionOutcomeId);
      expect(probability).toBeGreaterThan(0.5);

      const { items: relevant } = await relevantFor({ attackOutcomeId: disruptionOutcomeId });

      expect(relevant).toHaveLength(1);
      expect(relevant[0].name).toBe('Disruption Crew');
      expect(relevant[0].countryMatch).toBe(false);
      expect(relevant[0].sectorMatch).toBe(false);
      expect(relevant[0].combinedRelevance).toBeCloseTo(outcomeWeightOf(probability) / MAX_TAU, 9);
    });

    it('should not list an intrusion set on technique claims alone', async () => {
      const base = buildDisruptionEntry();
      await ingest({
        ...base,
        // The signature techniques of Service Disruption, without a description naming the outcome.
        threat: { ...base.threat, description: UNREMARKABLE_DESCRIPTION },
      });

      for (const catalogId of [AttackOutcome_ServiceDisruption, AttackOutcome_Ransomware]) {
        const outcomeId = getOutcomeId(catalogId);
        expect(await readStoredProbability(db, base.threat.stixId, outcomeId)).toBeLessThanOrEqual(0.5);
        expect((await relevantFor({ attackOutcomeId: outcomeId })).items).toHaveLength(0);
      }
    });

    it('should case-insensitively surface the organization matched country/sector name, or null when absent', async () => {
      await ingest(buildRansomwareEntry());
      const ransomwareOutcomeId = getOutcomeId(AttackOutcome_Ransomware);

      const countries = await services.withOrigin(adminOrigin).countries.getCountries();
      const france = countries.find((c) => c.name === 'France')!;

      // Organization's own country/sector names are compared case-insensitively against the
      // raw STIX targeted names, casing here intentionally differs from the fixture data.
      const { items: [matched] } = await relevantFor({
        attackOutcomeId: ransomwareOutcomeId,
        countryIds: [france.id],
        organizationCountryName: 'FRANCE',
        organizationSectorName: 'defense',
      });
      expect(matched.matchedCountry).toBe('France');
      expect(matched.matchedSector).toBe('Defense');
      // The matched entry is surfaced first in its respective list.
      expect(matched.countries[0]).toBe('France');
      expect(matched.sectors[0]).toBe('Defense');

      const { items: [noOrgNameMatch] } = await relevantFor({
        attackOutcomeId: ransomwareOutcomeId,
        countryIds: [france.id],
        organizationCountryName: 'Germany',
        organizationSectorName: null,
      });
      expect(noOrgNameMatch.matchedCountry).toBeNull();
      expect(noOrgNameMatch.matchedSector).toBeNull();
    });

    it('should carry the resource level on the row, so the ranking can print it', async () => {
      await ingest(buildRansomwareEntry());
      const countries = await services.withOrigin(adminOrigin).countries.getCountries();
      const france = countries.find((c) => c.name === 'France')!;

      const { items: [relevant] } = await relevantFor({
        attackOutcomeId: getOutcomeId(AttackOutcome_Ransomware),
        countryIds: [france.id],
      });

      expect(relevant.resourceLevel).toBe('government');
    });

    it('should narrow the selection to the analyses a caller names, and apply the same rule to them', async () => {
      const ransomware = buildRansomwareEntry({ stixId: 'intrusion-set--aaaaaaaa-0000-4000-8000-000000000005', name: 'Harbor Locksmiths', mitreGroupId: 'G9005' });
      const other = buildRansomwareEntry({ stixId: 'intrusion-set--aaaaaaaa-0000-4000-8000-000000000006', name: 'Other Lockers', mitreGroupId: 'G9006' });
      const unrelated = buildParsedEntry('initial');
      await ingest(ransomware, other, unrelated);
      const analyses = await services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS).then((r) => r.items);
      const idOf = (stixId: string) => analyses.find((analysis) => analysis.stixId === stixId)!.id;
      const ransomwareOutcomeId = getOutcomeId(AttackOutcome_Ransomware);

      const { items } = await relevantFor({ attackOutcomeId: ransomwareOutcomeId, analysisIds: [idOf(ransomware.threat.stixId), idOf(unrelated.threat.stixId)] });

      expect(items.map((item) => item.name)).toEqual(['Harbor Locksmiths']);
    });
  });

  describe('getRelevanceProof', () => {
    const relMeta = { relCreated: null, relStartTime: null, relStopTime: null, relModified: null };

    const analysisIdOf = async (stixId: string): Promise<string> => {
      const list = await services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS).then((r) => r.items);
      return list.find((analysis) => analysis.stixId === stixId)!.id;
    };

    const readProof = async (analysisId: string, params: { countryIds?: Array<string>, sectorIds?: Array<string>, attackOutcomeId?: string } = {}) => {
      const proof = await services.withOrigin(adminOrigin).threatAnalyses.getRelevanceProof({
        analysisId,
        attackOutcomeId: getOutcomeId(AttackOutcome_Ransomware),
        ...params,
      });
      expect(proof).not.toBeNull();
      return proof!;
    };

    const franceId = async (): Promise<string> => {
      const countries = await services.withOrigin(adminOrigin).countries.getCountries();
      return countries.find((c) => c.name === 'France')!.id;
    };

    const defenseId = async (): Promise<string> => {
      const sectors = await services.withOrigin(adminOrigin).sectors.getSectors();
      return sectors.find((sector) => sector.name === 'Defense')!.id;
    };

    it('should read no proof at all for an analysis the caller cannot see', async () => {
      const proof = await services.withOrigin(adminOrigin).threatAnalyses.getRelevanceProof({
        analysisId: uuidv7(),
        attackOutcomeId: getOutcomeId(AttackOutcome_Ransomware),
      });

      expect(proof).toBeNull();
    });

    it('should return the connector-stated relation id on a connector-backed location claim, and the actor\'s source on the proof', async () => {
      const entry = buildRansomwareEntry();
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([entry], tenantId, 'connector');

      const proof = await readProof(await analysisIdOf(entry.threat.stixId), { countryIds: [await franceId()] });

      expect(proof.relevance!.country.claims).toHaveLength(1);
      expect(proof.relevance!.country.claims[0].openctiStixRelationId).toBe('relationship--france');
      expect(proof.origin).toEqual({ stixId: entry.threat.stixId, kind: 'connector', entityType: 'intrusion-set' });
    });

    it('should return no relation id on a location claim of an actor no connector backs', async () => {
      const entry = buildRansomwareEntry();
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([entry], tenantId, 'stix-import');

      const proof = await readProof(await analysisIdOf(entry.threat.stixId), { countryIds: [await franceId()] });

      expect(proof.relevance!.country.claims[0].openctiStixRelationId).toBeNull();
      expect(proof.origin).toEqual({ stixId: entry.threat.stixId, kind: 'stix-import', entityType: 'intrusion-set' });
    });

    it('should carry the stored percentage, the evidence flag and the model version on the outcome', async () => {
      const entry = buildRansomwareEntry();
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([entry], tenantId, 'stix-import');
      const stored = await readStoredProbability(db, entry.threat.stixId, getOutcomeId(AttackOutcome_Ransomware));

      const proof = await readProof(await analysisIdOf(entry.threat.stixId));

      expect(proof.gate).toBe(THREAT_RELEVANCE_DEFAULTS.confidenceGate);
      expect(proof.outcome).toEqual({ probability: stored, evidenceSufficient: true, modelVersion: OUTCOME_COUNTER_VERSION, judgedOn: null });
    });

    it('should carry a judged percentage and the calendar date of its judgment set on the outcome', async () => {
      const entry = {
        ...buildRansomwareEntry(),
        judgedOutcomes: { judgedAt: new Date('2026-11-02T00:00:00.000Z'), probabilities: new Map([[AttackOutcome_Ransomware, 0.42]]) },
      };
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([entry], tenantId, 'default-threats');

      const proof = await readProof(await analysisIdOf(entry.threat.stixId));

      expect(proof.outcome).toEqual({ probability: 0.42, evidenceSufficient: true, modelVersion: OUTCOME_COUNTER_VERSION, judgedOn: '2026-11-02' });
    });

    it('should carry the judgment date once a judgment states the very percentage the counter had stored', async () => {
      const entry = buildRansomwareEntry();
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([entry], tenantId, 'default-threats');
      const counted = await readStoredProbability(db, entry.threat.stixId, getOutcomeId(AttackOutcome_Ransomware));

      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([{
        ...entry,
        judgedOutcomes: { judgedAt: new Date('2026-11-02T00:00:00.000Z'), probabilities: new Map([[AttackOutcome_Ransomware, counted]]) },
      }], tenantId, 'default-threats');

      const proof = await readProof(await analysisIdOf(entry.threat.stixId));
      expect(proof.outcome).toMatchObject({ probability: counted, judgedOn: '2026-11-02' });
    });

    it('should carry no judgment date on an outcome the judgment leaves to the counter', async () => {
      const entry = {
        ...buildRansomwareEntry(),
        judgedOutcomes: { judgedAt: new Date('2026-11-02T00:00:00.000Z'), probabilities: new Map([[AttackOutcome_Ransomware, 0.42]]) },
      };
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([entry], tenantId, 'default-threats');
      const counted = await readStoredProbability(db, entry.threat.stixId, getOutcomeId(AttackOutcome_ServiceDisruption));

      const proof = await readProof(await analysisIdOf(entry.threat.stixId), { attackOutcomeId: getOutcomeId(AttackOutcome_ServiceDisruption) });

      expect(proof.outcome).toEqual({ probability: counted, evidenceSufficient: true, modelVersion: OUTCOME_COUNTER_VERSION, judgedOn: null });
    });

    it('should carry a null percentage for an outcome the counter stored nothing for', async () => {
      const entry = buildRansomwareEntry();
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([entry], tenantId, 'stix-import');

      const proof = await readProof(await analysisIdOf(entry.threat.stixId), { attackOutcomeId: uuidv7() });

      expect(proof.outcome.probability).toBeNull();
      expect(proof.attackOutcomeName).toBeNull();
    });

    it('should return no combined relevance when the reader has no organization profile', async () => {
      const entry = buildRansomwareEntry();
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([entry], tenantId, 'stix-import');

      const proof = await readProof(await analysisIdOf(entry.threat.stixId));

      expect(proof.relevance).toBeNull();
      expect(proof.outcome.probability).toBeGreaterThan(0.5);
    });

    it('should score the relevance as the stored percentage\'s weight scaled by the targeting it matches', async () => {
      const entry = buildRansomwareEntry();
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([entry], tenantId, 'stix-import');
      const analysisId = await analysisIdOf(entry.threat.stixId);
      const weight = outcomeWeightOf(await readStoredProbability(db, entry.threat.stixId, getOutcomeId(AttackOutcome_Ransomware)));
      const [france, defense] = [await franceId(), await defenseId()];

      const both = await readProof(analysisId, { countryIds: [france], sectorIds: [defense] });
      const countryOnly = await readProof(analysisId, { countryIds: [france], sectorIds: [uuidv7()] });
      const neither = await readProof(analysisId, { countryIds: [uuidv7()], sectorIds: [uuidv7()] });

      expect(both.relevance!.score).toBeCloseTo(weight, 10);
      expect(countryOnly.relevance!.score).toBeCloseTo((weight * 2.5) / MAX_TAU, 10);
      expect(neither.relevance!.score).toBeCloseTo(weight / MAX_TAU, 10);
    });

    it('should score the same relevance as the list row does for the same threat', async () => {
      const entry = buildRansomwareEntry();
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([entry], tenantId, 'stix-import');
      const analysisId = await analysisIdOf(entry.threat.stixId);
      const [france, defense] = [await franceId(), await defenseId()];

      const { items } = await services.withOrigin(adminOrigin).threatAnalyses.getRelevantForScenario({
        attackOutcomeId: getOutcomeId(AttackOutcome_Ransomware),
        countryIds: [france],
        sectorIds: [defense],
      });
      const proof = await readProof(analysisId, { countryIds: [france], sectorIds: [defense] });

      expect(proof.relevance!.score).toBeCloseTo(items.find((item) => item.id === analysisId)!.combinedRelevance, 10);
    });

    it('should score zero relevance and say so when the record lacks the evidence to weigh, whatever the targeting', async () => {
      const base = buildRansomwareEntry();
      const entry: ParsedThreatInput = {
        ...base,
        threat: { ...base.threat, stixId: 'intrusion-set--thin-record', description: null, primaryMotivation: null },
        aliases: [],
        goals: [],
        secondaryMotivations: [],
      };
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([entry], tenantId, 'stix-import');

      const proof = await readProof(await analysisIdOf(entry.threat.stixId), { countryIds: [await franceId()], sectorIds: [await defenseId()] });

      expect(proof.outcome.evidenceSufficient).toBe(false);
      expect(proof.relevance!.country.matched).toBe(true);
      expect(proof.relevance!.score).toBe(0);
    });

    it('should keep the two claims of two producers about the same target apart', async () => {
      const entry = buildParsedEntry('initial');
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([{
        ...entry,
        locations: [
          { ...relMeta, stixId: 'location--france', stixRelationId: 'relationship--france-a', name: 'France', country: 'France', producerStixId: 'identity--a', producerName: 'Producer A', isInferred: false, relConfidence: 90 },
          { ...relMeta, stixId: 'location--france', stixRelationId: 'relationship--france-b', name: 'France', country: 'France', producerStixId: 'identity--b', producerName: 'Producer B', isInferred: false, relConfidence: 70 },
        ],
      }], tenantId, 'stix-import');

      const proof = await readProof(await analysisIdOf(entry.threat.stixId), { countryIds: [await franceId()] });

      expect(proof.relevance!.country.matched).toBe(true);
      // Strongest stated confidence first: the engine's own claim order, not the insertion order.
      expect(proof.relevance!.country.claims.map((claim) => claim.producerName)).toEqual(['Producer A', 'Producer B']);
    });

    it('should preserve a producer name stated as empty rather than reading it as absent', async () => {
      const entry = buildParsedEntry('initial');
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([{
        ...entry,
        locations: [
          { ...relMeta, stixId: 'location--france', stixRelationId: 'relationship--france-a', name: 'France', country: 'France', producerStixId: 'identity--blank', producerName: '', isInferred: false, relConfidence: 90 },
        ],
      }], tenantId, 'stix-import');

      const proof = await readProof(await analysisIdOf(entry.threat.stixId), { countryIds: [await franceId()] });

      expect(proof.relevance!.country.claims[0].producerName).toBe('');
    });

    it('should hold a below-gate claim out of the proof, and let the next read reveal it once the gate drops', async () => {
      const entry = buildRansomwareEntry();
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([{
        ...entry,
        locations: [
          { ...relMeta, ...DEFAULT_PROVENANCE, stixId: 'location--france', stixRelationId: 'relationship--france', name: 'France', country: 'France', relConfidence: 80 },
          { ...relMeta, ...DEFAULT_PROVENANCE, stixId: 'location--france-low', stixRelationId: 'relationship--france-low', name: 'France', country: 'France', relConfidence: 50 },
        ],
      }], tenantId, 'stix-import');
      const analysisId = await analysisIdOf(entry.threat.stixId);
      const countryIds = [await franceId()];

      const gated = await readProof(analysisId, { countryIds });
      expect(gated.relevance!.country.claims.map((claim) => claim.stixRelationId)).toEqual(['relationship--france']);
      // The actor is still ranked: the gate only ever reads the targeting.
      const { items } = await services.withOrigin(adminOrigin).threatAnalyses.getRelevantForScenario({
        attackOutcomeId: getOutcomeId(AttackOutcome_Ransomware),
        countryIds,
        sectorIds: [],
      });
      expect(items.map((item) => item.id)).toContain(analysisId);

      await services.withOrigin(adminOrigin).threatRelevanceSettings
        .updateThreatRelevanceSettings({ ...THREAT_RELEVANCE_DEFAULTS, confidenceGate: 40 });

      const relaxed = await readProof(analysisId, { countryIds });
      expect(relaxed.gate).toBe(40);
      expect(relaxed.relevance!.country.claims.map((claim) => claim.stixRelationId).sort()).toEqual(['relationship--france', 'relationship--france-low']);
    });
  });

  describe('the confidence gate', () => {
    // Recent enough to become the actor's activity anchor: every other fixture date is in 2024.
    const RECENT = new Date(Date.now() - 30 * 86_400_000);
    // The parent's `last_seen`, which anchors activity once every recent claim is gated out.
    const LAST_SEEN = new Date('2024-06-01T00:00:00.000Z');
    // What a claim stating no confidence is read as. Restated rather than imported: the module
    // deliberately does not export `DEFAULT_RELATION_CONFIDENCE`, and pinning the number against a
    // sibling claim that states it explicitly is the whole point of the fixture below.
    const UNSTATED_READS_AS = 60;

    const setGate = async (confidenceGate: number): Promise<void> => {
      await services.withOrigin(adminOrigin).threatRelevanceSettings
        .updateThreatRelevanceSettings({ ...THREAT_RELEVANCE_DEFAULTS, confidenceGate });
    };

    // The disruption actor with hand-set technique confidences, so the gate is the only thing
    // deciding which signals are read. `recentIndex` marks the single claim carrying a recent
    // window: the one that would anchor activity if the gate let it through.
    const buildGatedEntry = (confidences: Array<number | null>, recentIndex?: number): ParsedThreatInput => {
      const entry = buildDisruptionEntry();
      return {
        ...entry,
        techniques: confidences.map((relConfidence, i) => ({
          ...entry.techniques[i],
          relConfidence,
          relStopTime: i === recentIndex ? RECENT : null,
        })),
      };
    };

    const readRelevant = async () => services.withOrigin(adminOrigin).threatAnalyses.getRelevantForScenario({
      attackOutcomeId: getOutcomeId(AttackOutcome_ServiceDisruption),
      countryIds: [],
      sectorIds: [],
    });

    it('should read a claim whose confidence equals the gate and omit the one just below it', async () => {
      await setGate(60);
      await services.withOrigin(adminOrigin).threatAnalyses
        .ingestBundle([buildGatedEntry([60, 59])], tenantId, 'stix-import');
      await recomputeListProjections();

      const [row] = await services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS).then((r) => r.items);
      expect(row.techniqueCount).toBe(1);

      const detail = await services.withOrigin(adminOrigin).threatAnalyses.getDetail(row.id);
      expect(detail!.techniques.map((t) => t.mitreExternalId)).toEqual(['T1498']);
    });

    it('should keep a below-gate claim in the table while omitting it from every read path', async () => {
      await setGate(60);
      // T1499.001 is below the gate AND carries the only recent date on the actor: read, it would
      // both add a signal to the score and become the activity anchor.
      await services.withOrigin(adminOrigin).threatAnalyses
        .ingestBundle([buildGatedEntry([80, 30], 1)], tenantId, 'stix-import');
      await recomputeActivity();
      await recomputeListProjections();

      const [row] = await services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS).then((r) => r.items);

      const persisted = await db.select().from(threatAnalysisTechniques)
        .where(eq(threatAnalysisTechniques.analysisId, row.id));
      expect(persisted).toHaveLength(2);
      expect(persisted.some((t) => t.mitreExternalId === 'T1499.001' && t.relConfidence === 30)).toBe(true);

      expect(row.techniqueCount).toBe(1);
      const detail = await services.withOrigin(adminOrigin).threatAnalyses.getDetail(row.id);
      expect(detail!.techniques.map((t) => t.mitreExternalId)).toEqual(['T1498']);

      // The counter reads the description, never a claim: gating one moves no percentage.
      const { items } = await readRelevant();
      expect(items).toHaveLength(1);

      // The anchor falls back to the parent's `last_seen` instead of the below-gate row's window.
      expect(row.lastActivityAt).toEqual(LAST_SEEN);
    });

    it('should read a claim stating no confidence exactly as one stating 60', async () => {
      await services.withOrigin(adminOrigin).threatAnalyses
        .ingestBundle([buildGatedEntry([UNSTATED_READS_AS, null])], tenantId, 'stix-import');
      const [{ id }] = await services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS).then((r) => r.items);
      const readTechniqueIds = async (): Promise<Array<string>> => {
        const detail = await services.withOrigin(adminOrigin).threatAnalyses.getDetail(id);
        return detail!.techniques.map((t) => t.mitreExternalId).toSorted();
      };

      // Read or omitted together at every gate: that is what pins the substituted value to
      // exactly 60 rather than to "somewhere at or above 40".
      await setGate(60);
      expect(await readTechniqueIds()).toEqual(['T1498', 'T1499.001']);

      await setGate(80);
      expect(await readTechniqueIds()).toEqual([]);
    });

    // A gate change re-reads the claims with no re-ingestion. Both the counts and the activity
    // columns are projections, so each follows on the run the settings write books, and the
    // activity run rewrites no anchor.
    it('should apply a changed gate to the counts and the activity on their next run', async () => {
      await setGate(60);
      await services.withOrigin(adminOrigin).threatAnalyses
        .ingestBundle([buildGatedEntry([80, 30], 1)], tenantId, 'stix-import');
      await recomputeActivity();
      await recomputeListProjections();

      const [before] = await services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS).then((r) => r.items);
      expect(before.techniqueCount).toBe(1);
      expect(before.lastActivityAt).toEqual(LAST_SEEN);
      const anchorsBefore = await db.select().from(threatActivityAnchors);

      await setGate(20);

      // The stored count still answers the old gate until the sweep that owns it runs.
      const [stale] = await services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS).then((r) => r.items);
      expect(stale.techniqueCount).toBe(1);

      await recomputeListProjections();
      const [counted] = await services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS).then((r) => r.items);
      expect(counted.techniqueCount).toBe(2);

      await recomputeActivity();
      const [after] = await services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS).then((r) => r.items);
      expect(after.lastActivityAt).toEqual(RECENT);
      expect(await db.select().from(threatActivityAnchors)).toHaveLength(anchorsBefore.length);
    });

    it('should not cite a below-gate flaw through getActiveCitations', async () => {
      await setGate(60);
      const base = buildParsedEntry('initial');
      const relMeta = { ...DEFAULT_PROVENANCE, relCreated: null, relStartTime: null, relModified: null };
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([{
        ...base,
        // An above-gate location carrying a recent window, so the actor reads active: without it
        // the citations would come back empty for a reason that has nothing to do with the gate.
        locations: [{ ...relMeta, stixId: 'location--france', stixRelationId: 'relationship--france', name: 'France', country: 'France', relStopTime: RECENT, relConfidence: 90 }],
        sectors: [],
        cves: [
          { ...relMeta, relStopTime: null, stixId: 'vulnerability--cited', stixRelationId: 'relationship--cited-cve', cveId: KNOWN_CVE_ID, relConfidence: 90 },
          { ...relMeta, relStopTime: null, stixId: 'vulnerability--gated', stixRelationId: 'relationship--gated-cve', cveId: UNKNOWN_CVE_ID, relConfidence: 30 },
        ],
      }], tenantId, 'stix-import');
      await recomputeActivity();

      const [row] = await services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS).then((r) => r.items);
      expect(row.lastObservedAt).toEqual(RECENT);

      const citations = await services.withOrigin(adminOrigin).threatAnalyses.getActiveCitations();
      expect(citations.cveIds).toEqual([KNOWN_CVE_ID]);
      expect(citations.analysisCountByCveId).toEqual({ [KNOWN_CVE_ID]: 1 });

      // Lowering the gate cites both: the omission above is the gate, not a gap in the fixture.
      await setGate(20);
      const relaxed = await services.withOrigin(adminOrigin).threatAnalyses.getActiveCitations();
      expect(relaxed.cveIds.toSorted()).toEqual([KNOWN_CVE_ID, UNKNOWN_CVE_ID].toSorted());
    });

    it('should cite an actor the job has not folded yet, which every reader already shows as not dated', async () => {
      await setGate(60);
      await services.withOrigin(adminOrigin).threatAnalyses
        .ingestBundle([buildParsedEntry('initial')], tenantId, 'stix-import');

      // No recompute: the column is still NULL, which is the state between an ingestion and the
      // job's next pass. A bare `last_observed_at > since` would not match it.
      const [row] = await services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS).then((r) => r.items);
      expect(row.lastObservedAt).toBeNull();

      const citations = await services.withOrigin(adminOrigin).threatAnalyses.getActiveCitations();
      expect(citations.cveIds).toContain(KNOWN_CVE_ID);

      // And it stays cited once the job writes the same verdict into the column.
      await recomputeActivity();
      const [folded] = await services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS).then((r) => r.items);
      expect(folded.lastObservedAt).toEqual(new Date('2024-06-01T00:00:00.000Z'));
      const afterFold = await services.withOrigin(adminOrigin).threatAnalyses.getActiveCitations();
      expect(afterFold.cveIds).not.toContain(KNOWN_CVE_ID);
    });

    it('should read the gate on the targeting alone: a below-gate claim stops matching, it never delists the threat', async () => {
      await setGate(60);
      const base = buildRansomwareEntry();
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([{
        ...base,
        locations: [{ ...base.locations[0], relConfidence: 30 }],
        sectors: [{ ...base.sectors[0], relConfidence: 30 }],
        cves: [],
        techniques: [],
      }], tenantId, 'stix-import');

      const countries = await services.withOrigin(adminOrigin).countries.getCountries();
      const sectors = await services.withOrigin(adminOrigin).sectors.getSectors();
      const scenario = {
        attackOutcomeId: getOutcomeId(AttackOutcome_Ransomware),
        countryIds: [countries.find((c) => c.name === 'France')!.id],
        sectorIds: [sectors.find((s) => s.name === 'Defense')!.id],
      };

      const gated = await services.withOrigin(adminOrigin).threatAnalyses.getRelevantForScenario(scenario);
      expect(gated.items).toHaveLength(1);
      expect([gated.items[0].countryMatch, gated.items[0].sectorMatch]).toEqual([false, false]);

      await setGate(20);
      const relaxed = await services.withOrigin(adminOrigin).threatAnalyses.getRelevantForScenario(scenario);
      expect(relaxed.items).toHaveLength(1);
      expect([relaxed.items[0].countryMatch, relaxed.items[0].sectorMatch]).toEqual([true, true]);
      expect(relaxed.items[0].combinedRelevance).toBeCloseTo(gated.items[0].combinedRelevance * MAX_TAU, 9);
    });

    it('should read the tenant\'s own gate on the job-side attacker-mixture path, not the shipped default', async () => {
      // Confidence 30 sits below the shipped default (60) and above the gate the tenant picks
      // below: a job-side read falling back to the default would never see it.
      await services.withOrigin(adminOrigin).threatAnalyses
        .ingestBundle([buildGatedEntry([80, 30])], tenantId, 'stix-import');
      const disruptionOutcomeId = getOutcomeId(AttackOutcome_ServiceDisruption);

      const readAsJob = async (): Promise<Array<string>> => {
        const [evidence] = await services.withOrigin({ type: 'system' }).threatAnalyses.getAttackerMixtureEvidenceByProfile({
          attackOutcomeIds: [disruptionOutcomeId],
          profiles: [{ countryIds: [], sectorIds: [] }],
          tenantId,
        });
        return evidence.get(disruptionOutcomeId)!.groups[0].techniqueExternalIds.toSorted();
      };

      await setGate(60);
      expect(await readAsJob()).toEqual(['T1498']);

      await setGate(20);
      expect(await readAsJob()).toEqual(['T1498', 'T1499.001']);
    });

    it('should produce the same numbers on two runs over the same data and the same gate', async () => {
      await setGate(60);
      await services.withOrigin(adminOrigin).threatAnalyses
        .ingestBundle([buildGatedEntry([80, 60, null], 0)], tenantId, 'stix-import');
      await recomputeActivity();

      // `activityScore` decays against a clock read per call, so the two runs are compared on the
      // values the engine derives from the data alone.
      const stable = (item: Awaited<ReturnType<typeof readRelevant>>['items'][number]) => ({
        name: item.name,
        combinedRelevance: item.combinedRelevance,
        lastActivityAt: item.lastActivityAt,
      });

      const first = await readRelevant();
      const second = await readRelevant();
      expect(first.items).toHaveLength(1);
      expect(second.items.map(stable)).toEqual(first.items.map(stable));
    });

    it('should report the same activity on the list and on the detail', async () => {
      await setGate(60);
      await services.withOrigin(adminOrigin).threatAnalyses
        .ingestBundle([buildGatedEntry([80, 30], 0)], tenantId, 'stix-import');
      await recomputeActivity();
      const [row] = await services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS).then((r) => r.items);
      const detail = await services.withOrigin(adminOrigin).threatAnalyses.getDetail(row.id);

      // Both paths must anchor on the same rows, or a group reads active on one surface and
      // dormant on the other. Scores are computed at two slightly different `now`.
      expect(detail!.activity.lastObservedAt).toEqual(row.lastObservedAt);
      expect(detail!.activity.lastActivityAt).toEqual(row.lastActivityAt);
      expect(detail!.activity.activityScore).toBeCloseTo(row.activityScore!, 6);
    });
  });

  describe('the activity weight', () => {
    const RECENT = new Date(Date.now() - 30 * 86_400_000);
    const floorFor = (ageDays: number): number => ACTIVITY_SIGNAL_BASE_WEIGHT * 2 ** (-ageDays / ACTIVITY_HALF_LIFE_DAYS);

    // Two actors on the Service Disruption outcome: one with a recent observed window, one with no
    // date anywhere, which the daily fold leaves at a NULL score.
    const ingestDatedAndUndatedActors = async (): Promise<void> => {
      const dated = buildDisruptionEntry();
      const undated = buildDisruptionEntry();
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([
        {
          ...dated,
          threat: { ...dated.threat, name: 'Dated Crew' },
          techniques: dated.techniques.map((technique, i) => ({ ...technique, relStopTime: i === 0 ? RECENT : null })),
        },
        {
          ...undated,
          threat: {
            ...undated.threat,
            stixId: 'intrusion-set--33333333-3333-3333-3333-333333333333',
            name: 'Undated Crew',
            mitreGroupId: 'G9997',
            firstSeen: null,
            lastSeen: null,
          },
          aliases: ['Undated Crew', 'UC-9997'],
        },
      ], tenantId, 'stix-import');
      await recomputeActivity();
    };

    const readRelevantByName = async () => {
      const { items } = await services.withOrigin(adminOrigin).threatAnalyses.getRelevantForScenario({
        attackOutcomeId: getOutcomeId(AttackOutcome_ServiceDisruption),
        countryIds: [],
        sectorIds: [],
      });
      expect(items).toHaveLength(2);
      return { dated: items.find((item) => item.name === 'Dated Crew')!, undated: items.find((item) => item.name === 'Undated Crew')! };
    };

    const setUnknownActivityAgeDays = async (unknownActivityAgeDays: number): Promise<void> => {
      await services.withOrigin(adminOrigin).threatRelevanceSettings
        .updateThreatRelevanceSettings({ ...THREAT_RELEVANCE_DEFAULTS, unknownActivityAgeDays });
    };

    it('should weigh a dated threat at its stored score and an undated one at the floor of the default age', async () => {
      await ingestDatedAndUndatedActors();

      const { dated, undated } = await readRelevantByName();

      expect(dated.lastObservedAt).not.toBeNull();
      expect(dated.activityScore).not.toBeNull();
      expect(dated.activityWeight).toBe(dated.activityScore);
      expect(undated.lastObservedAt).toBeNull();
      expect(undated.activityWeight).toBeCloseTo(floorFor(THREAT_RELEVANCE_DEFAULTS.unknownActivityAgeDays), 10);
      expect(undated.activityWeight).toBeGreaterThan(0);
      expect(dated.activityWeight).toBeGreaterThan(undated.activityWeight);
    });

    it('should read a null activity score for an undated threat and a number for a dated one, on the relevant threats and on the list', async () => {
      await ingestDatedAndUndatedActors();

      const { dated, undated } = await readRelevantByName();
      expect(undated.activityScore).toBeNull();
      expect(typeof dated.activityScore).toBe('number');

      const { items } = await services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS);
      expect(items.find((item) => item.name === 'Undated Crew')!.activityScore).toBeNull();
      expect(typeof items.find((item) => item.name === 'Dated Crew')!.activityScore).toBe('number');
    });

    it('should read a legacy row stored at zero without a date as unknown at once, before any daily pass', async () => {
      await ingestDatedAndUndatedActors();
      await db.update(threatAnalyses).set({ activityScore: 0, lastObservedAt: null }).where(eq(threatAnalyses.name, 'Undated Crew'));

      const { undated } = await readRelevantByName();
      expect(undated.activityScore).toBeNull();
      expect(undated.activityWeight).toBeCloseTo(floorFor(THREAT_RELEVANCE_DEFAULTS.unknownActivityAgeDays), 10);

      const { items } = await services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS);
      expect(items.find((item) => item.name === 'Undated Crew')!.activityScore).toBeNull();

      const detail = await services.withOrigin(adminOrigin).threatAnalyses.getDetail(undated.id);
      expect(detail!.activity.activityScore).toBeNull();
    });

    it('should apply a changed assumed age on the next read, with no activity recompute', async () => {
      await ingestDatedAndUndatedActors();
      const before = await readRelevantByName();
      const anchorsBefore = await db.select().from(threatActivityAnchors);

      await setUnknownActivityAgeDays(30);

      const after = await readRelevantByName();
      expect(after.undated.activityWeight).toBeCloseTo(floorFor(30), 10);
      expect(after.undated.activityWeight).toBeGreaterThan(before.undated.activityWeight);
      expect(after.dated.activityWeight).toBe(before.dated.activityWeight);
      expect(await db.select().from(threatActivityAnchors)).toHaveLength(anchorsBefore.length);
    });

    it('should carry the weight and the assumed age on the detail', async () => {
      await ingestDatedAndUndatedActors();
      await setUnknownActivityAgeDays(200);
      const { dated, undated } = await readRelevantByName();

      const undatedDetail = await services.withOrigin(adminOrigin).threatAnalyses.getDetail(undated.id);
      const datedDetail = await services.withOrigin(adminOrigin).threatAnalyses.getDetail(dated.id);

      expect(undatedDetail!.activity.unknownActivityAgeDays).toBe(200);
      expect(undatedDetail!.activity.activityWeight).toBeCloseTo(floorFor(200), 10);
      expect(datedDetail!.activity.unknownActivityAgeDays).toBe(200);
      expect(datedDetail!.activity.activityWeight).toBe(dated.activityScore);
    });
  });
});
