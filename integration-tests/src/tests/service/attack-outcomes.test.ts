import type { AttackOutcomeReference, EventOrigin, ParsedThreatInput } from '@app/module';
import {
  ATTACK_OUTCOMES,
  AttackOutcome_DataBreachResale,
  AttackOutcome_Espionage,
  AttackOutcome_FinancialFraudFundsTheft,
  AttackOutcome_Ransomware,
  attackOutcomeMitreTechniques,
  attackOutcomes as attackOutcomesTable,
  deriveSeedId,
  INFERRED_MAX_COUNT,
  INFERRED_MIN_WEIGHT,
  isActiveTechnique,
  mitreTechniquesData,
  seedAttackOutcomes,
  THREAT_RELEVANCE_DEFAULTS,
  threatAnalysisOutcomeProbabilities,
} from '@app/module';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recomputeAttackOutcomeMixtures } from '../../helpers/attack-outcome-mixtures';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { DATA_BREACH_DESCRIPTION, readStoredProbability } from '../../helpers/threat-analyses-fixtures';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

/**
 * The mixture reads an actor's activity as columns. Ingesting without a run of the job that writes
 * them hands the engine an actor no fold has dated, which is a different `rho` from the one every
 * expectation here is written against.
 */
const recomputeActivityFor = async (tenantId: string): Promise<void> => {
  await services.withOrigin({ type: 'job', tenantId, jobKind: 'threat-activity-recompute', interactive: true })
    .threatActivity.recomputeActivity({ now: new Date(), isDailyBooking: false });
};

// The CRQ job and the platform seed run outside a tenant-scoped origin, which is exactly where the
// explicit tenant scope has to do the work the secured views cannot.
const SYSTEM_ORIGIN: EventOrigin = { type: 'system' };

const DAY_MS = 86_400_000;

describe('Attack Outcomes Service', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;
  let adminUserId: string;
  let organizationId: string;

  const createOrganization = async (origin: EventOrigin, name: string) => {
    const id = uuidv7();
    await services.withOrigin(origin).organizations.createOrganizations([{ id, name }]);
    return id;
  };

  const createScenario = async (scenarioOrganizationId: string, attackOutcomeId: string) => {
    await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
      id: uuidv7(),
      organizationId: scenarioOrganizationId,
      name: 'Scenario',
      description: null,
      attackOutcomeId,
      primaryAssetIds: [],
    });
  };

  /** Row id of a catalog outcome in the suite's tenant, derived rather than looked up by label. */
  const outcomeRowId = (catalogId: string) => deriveSeedId(tenantId, catalogId);

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
    adminUserId = setup.userId;
    // The weight is keyed by (attack outcome, organization): the targeting profile is the
    // organization's own country and sector, so every read needs one.
    organizationId = await createOrganization(adminOrigin, 'Test Organization');
    // The job stores a mixture only for a pair carrying a risk scenario, and every reader reads that table.
    for (const catalogId of [AttackOutcome_DataBreachResale, AttackOutcome_Ransomware]) {
      await createScenario(organizationId, outcomeRowId(catalogId));
    }
  });

  const recomputeMixtures = () => recomputeAttackOutcomeMixtures(services, tenantId);

  describe('read operations', () => {
    it('should list the seeded attack outcomes', async () => {
      const outcomes = await services.withOrigin(adminOrigin).attackOutcomes.getAttackOutcomes();
      // Tenant bootstrap seeds the 7 catalog outcomes and nothing else.
      expect(outcomes).toHaveLength(7);
      // Every row id is derived from its catalog entry rather than minted.
      expect(outcomes.map((o) => o.id).toSorted()).toEqual(
        ATTACK_OUTCOMES.map((outcome) => outcomeRowId(outcome.id)).toSorted(),
      );
      // Credential Compromise is deleted and Data Exfiltration became Data Breach & Resale.
      expect(outcomes.map((o) => o.name)).not.toContain('Credential Compromise');
      expect(outcomes.map((o) => o.name)).not.toContain('Data Exfiltration');
      expect(outcomes.find((o) => o.id === outcomeRowId(AttackOutcome_DataBreachResale))!.name)
        .toBe('Data Breach & Resale');
    });

    it('should carry a reference dwell on every outcome', async () => {
      const outcomes = await services.withOrigin(adminOrigin).attackOutcomes.getAttackOutcomes();
      expect(outcomes.every((o) => o.referenceDwellDays > 0)).toBe(true);
      // Dwells are pinned to the published industry references: ≈122 days for espionage, 3 for ransomware.
      expect(outcomes.find((o) => o.id === outcomeRowId(AttackOutcome_Espionage))!.referenceDwellDays).toBe(122);
      expect(outcomes.find((o) => o.id === outcomeRowId(AttackOutcome_Ransomware))!.referenceDwellDays).toBe(3);
    });

    it('should get a single attack outcome by id', async () => {
      const outcomes = await services.withOrigin(adminOrigin).attackOutcomes.getAttackOutcomes();
      const coreOutcome = outcomes.at(0);
      expect(coreOutcome).toBeTruthy();

      const result = await services.withOrigin(adminOrigin).attackOutcomes.getAttackOutcome(coreOutcome!.id);
      expect(result).toBeTruthy();
      expect(result!.id).toBe(coreOutcome!.id);
      expect(result!.tenantId).toBe(tenantId);
    });

    it('should return undefined for non-existent outcome', async () => {
      const result = await services.withOrigin(adminOrigin).attackOutcomes.getAttackOutcome('00000000-0000-0000-0000-000000000000');
      expect(result).toBeUndefined();
    });
  });

  describe('MITRE technique associations', () => {
    it('should retrieve seeded techniques for core outcomes', async () => {
      const outcomes = await services.withOrigin(adminOrigin).attackOutcomes.getAttackOutcomes();
      const coreOutcome = outcomes.find((o) => o.id === outcomeRowId(AttackOutcome_Ransomware));
      expect(coreOutcome).toBeTruthy();
      await recomputeMixtures();

      const result = await services.withOrigin(adminOrigin).attackOutcomes.getMitreTechniquesForOutcome(coreOutcome!.id, { organizationId });
      expect(result.techniques.length).toBeGreaterThan(0);

      const signatures = result.techniques.filter((t) => t.category === 'signature');
      expect(signatures.length).toBeGreaterThan(0);

      for (const tech of result.techniques) {
        expect(tech.externalId).toBeTruthy();
        expect(tech.name).toBeTruthy();
        expect(['signature', 'related', 'inferred']).toContain(tech.category);
      }
    });

    it('should fall back to editorial levels when no relevant threat is ingested', async () => {
      const outcomes = await services.withOrigin(adminOrigin).attackOutcomes.getAttackOutcomes();
      const coreOutcome = outcomes.find((o) => o.id === outcomeRowId(AttackOutcome_Ransomware));
      await recomputeMixtures();

      const result = await services.withOrigin(adminOrigin).attackOutcomes.getMitreTechniquesForOutcome(coreOutcome!.id, { organizationId });

      // A tenant with no ingested intrusion set has no mixture at all: the run must stay alive, so
      // every curated technique carries a non-zero editorial level.
      expect(result.evidenceMode).toBe('no-relevant-threats');
      expect(result.techniques.every((technique) => technique.weight > 0)).toBe(true);
      expect(result.techniques.some((technique) => technique.category === 'inferred')).toBe(false);
      const signature = result.techniques.find((technique) => technique.category === 'signature');
      expect(signature!.weight).toBeCloseTo(0.5);
      const related = result.techniques.find((technique) => technique.category === 'related');
      expect(related!.weight).toBeCloseTo(0.2);
    });

    it('should return empty array for outcome with no techniques', async () => {
      const result = await services.withOrigin(adminOrigin).attackOutcomes.getMitreTechniquesForOutcome('00000000-0000-0000-0000-000000000000', { organizationId });
      expect(result.techniques).toHaveLength(0);
    });

    it('should return every curated technique including a sub-technique alongside its parent', async () => {
      // FinancialFraudFundsTheft curates T1114.003 (signature) and its parent T1114 (related): the
      // mixture-weighted read folds them into one, this one must not.
      const outcomeId = outcomeRowId(AttackOutcome_FinancialFraudFundsTheft);
      const curated = await services.withOrigin(adminOrigin)
        .attackOutcomes.getCuratedMitreTechniquesForOutcome(outcomeId);

      const byExternalId = new Map(curated.map((technique) => [technique.externalId, technique]));
      expect(byExternalId.get('T1114.003')?.category).toBe('signature');
      expect(byExternalId.get('T1114')?.category).toBe('related');
      for (const technique of curated) {
        expect(technique.name).toBeTruthy();
        expect(technique.revoked).toBe(false);
      }
    });
  });

  describe('attacker-mixture technique weights', () => {
    // Undated relationships on purpose: with no temporal signal every group lands on the same
    // null-anchor rho and tau 1, so the expected shares are exact rather than clock-dependent.
    interface GroupOptions {
      aliases?: Array<string>,
      /** Extra techniques on top of the two the base fixture carries. */
      extraTechniqueIds?: Array<string>,
      /** Sets an observed activity anchor (`rel_stop_time`), which drives rho to ~1. */
      observedAt?: Date,
      /** Sets an authored-only anchor (`rel_created`), which decays on the authored half-life. */
      authoredAt?: Date,
    }

    const buildGroup = (slug: string, name: string, options: GroupOptions = {}): ParsedThreatInput => {
      const dates = {
        relCreated: options.authoredAt ?? null,
        relStartTime: null,
        relStopTime: options.observedAt ?? null,
        relModified: null,
      };
      const technique = (suffix: string, techniqueName: string, mitreExternalId: string, relConfidence: number) => ({
        stixId: `attack-pattern--${slug}-${suffix}`,
        stixRelationId: `relationship--${slug}-${suffix}`,
        name: techniqueName,
        mitreExternalId,
        producerStixId: 'identity--test-producer',
        producerName: 'Test Producer',
        isInferred: false,
        ...dates,
        relConfidence,
      });
      return {
        threat: {
          stixId: `intrusion-set--${slug}`,
          entityType: 'intrusion-set',
          name,
          description: DATA_BREACH_DESCRIPTION,
          mitreGroupId: null,
          confidence: null,
          stixCreated: null,
          firstSeen: null,
          lastSeen: null,
          primaryMotivation: null,
          resourceLevel: null,
          sophistication: null,
          objective: null,
          labels: [],
        },
        aliases: options.aliases ?? [],
        secondaryMotivations: [],
        goals: [],
        threatActorTypes: [],
        roles: [],
        attributions: [],
        locations: [],
        sectors: [],
        cves: [],
        techniques: [
          // T1213.001 folds onto T1213, a signature technique of Data Breach & Resale.
          technique('repo', 'Data from Information Repositories: Confluence', 'T1213.001', 80),
          // Reconnaissance, curated on no outcome at all: the inferred candidate.
          technique('scan', 'Active Scanning', 'T1595', 60),
          ...(options.extraTechniqueIds ?? []).map((externalId, index) =>
            technique(`extra-${index}`, `Extra technique ${externalId}`, externalId, 60)),
        ],
      };
    };

    const ingest = async (groups: Array<ParsedThreatInput>) => {
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle(groups, tenantId, 'stix-import');
      await recomputeActivityFor(tenantId);
      await recomputeMixtures();
    };

    const getBreachOutcomeId = () => outcomeRowId(AttackOutcome_DataBreachResale);

    const weightsFor = async (attackOutcomeId: string) =>
      services.withOrigin(adminOrigin).attackOutcomes.getMitreTechniquesForOutcome(attackOutcomeId, { organizationId });

    it('should weight curated techniques as repertoire shares and promote a corroborated inferred one', async () => {
      await ingest([buildGroup('alpha', 'Alpha Group'), buildGroup('beta', 'Beta Group')]);
      expect(await readStoredProbability(db, 'intrusion-set--alpha', getBreachOutcomeId())).toBeGreaterThan(0.5);

      const result = await weightsFor(getBreachOutcomeId());

      expect(result.evidenceMode).toBe('attacker-mixture');

      // Used by every admitted actor, so it carries the whole threat.
      const repoTechnique = result.techniques.find((technique) => technique.externalId === 'T1213')!;
      expect(repoTechnique.category).toBe('signature');
      expect(repoTechnique.weight).toBeCloseTo(1, 10);
      expect(repoTechnique.sourceCount).toBe(2);
      expect(repoTechnique.threats.map((threat) => threat.canonicalName).toSorted()).toEqual(['Alpha Group', 'Beta Group']);

      // Curated but used by nobody: zero mass, by design.
      const unused = result.techniques.filter((technique) => technique.category !== 'inferred' && technique.weight === 0);
      expect(unused.length).toBeGreaterThan(0);
      expect(unused.every((technique) => technique.threats.length === 0)).toBe(true);

      // Corroborated by two distinct actors and above the weight floor: enters as inferred. Pinned
      // against the imported floor and against the curated technique it shares its actors with,
      // never against the arithmetic of this particular fixture.
      const scanning = result.techniques.find((technique) => technique.externalId === 'T1595')!;
      expect(scanning.category).toBe('inferred');
      expect(scanning.weight).toBe(repoTechnique.weight);
      expect(scanning.weight).toBeGreaterThan(INFERRED_MIN_WEIGHT);
    });

    it('should leave out a threat at or below 0.5 on the outcome, whatever techniques it plays', async () => {
      const group = buildGroup('alpha', 'Alpha Group');
      // Plays the outcome's signature technique, but nothing in its description leads to a breach.
      await ingest([{ ...group, threat: { ...group.threat, description: 'A fixture intrusion-set for integration tests.' } }]);
      expect(await readStoredProbability(db, 'intrusion-set--alpha', getBreachOutcomeId())).toBeLessThanOrEqual(0.5);

      const result = await weightsFor(getBreachOutcomeId());

      expect(result.evidenceMode).toBe('no-relevant-threats');
    });

    it('should leave every share untouched when the same actor is ingested again under an alias', async () => {
      await ingest([buildGroup('alpha', 'Alpha Group'), buildGroup('beta', 'Beta Group')]);
      const outcomeId = getBreachOutcomeId();
      const before = await weightsFor(outcomeId);

      // Same actor, third source, weaker or equal evidence: cluster-then-normalize must fold it.
      await ingest([buildGroup('alpha-clone', 'Alpha Group Reported Twice', { aliases: ['Alpha Group'] })]);
      const after = await weightsFor(outcomeId);

      const weightsOf = (result: typeof before) =>
        result.techniques.map((technique) => [technique.externalId, technique.weight] as const).toSorted();
      expect(weightsOf(after)).toEqual(weightsOf(before));
    });

    it('should name the share each actor contributes to a technique weight', async () => {
      await ingest([buildGroup('alpha', 'Alpha Group'), buildGroup('beta', 'Beta Group')]);

      const result = await weightsFor(getBreachOutcomeId());

      const repoTechnique = result.techniques.find((technique) => technique.externalId === 'T1213')!;
      const summed = repoTechnique.threats.reduce((total, threat) => total + threat.share, 0);
      expect(summed).toBeCloseTo(repoTechnique.weight, 10);
    });

    it('should resolve several organizations in one call as it resolves each of them alone', async () => {
      const countries = await services.withOrigin(adminOrigin).countries.getCountries();
      const frenchOrganizationId = uuidv7();
      await services.withOrigin(adminOrigin).organizations.createOrganizations([{
        id: frenchOrganizationId,
        name: 'French Organization',
        countryId: countries.find((country) => country.name === 'France')!.id,
      }]);
      await createScenario(frenchOrganizationId, getBreachOutcomeId());
      // Both organizations read the same four threats, but the French one weighs the two groups
      // targeting France 2.5 times heavier: the two read two different mixtures.
      const frenchGroup = (slug: string, name: string): ParsedThreatInput => {
        const base = buildGroup(slug, name, { extraTechniqueIds: ['T1133'] });
        return {
          ...base,
          locations: [{
            stixId: `location--${slug}-france`,
            stixRelationId: `relationship--${slug}-france`,
            name: 'France',
            country: 'France',
            producerStixId: 'identity--test-producer',
            producerName: 'Test Producer',
            isInferred: false,
            relCreated: null,
            relStartTime: null,
            relStopTime: null,
            relModified: null,
            relConfidence: THREAT_RELEVANCE_DEFAULTS.confidenceGate,
          }],
          techniques: base.techniques.filter((technique) => technique.mitreExternalId !== 'T1213.001'),
        };
      };
      await ingest([
        buildGroup('alpha', 'Alpha Group'),
        buildGroup('beta', 'Beta Group'),
        frenchGroup('gamma', 'Gamma Group'),
        frenchGroup('delta', 'Delta Group'),
      ]);
      const outcomeId = getBreachOutcomeId();

      const together = await services.withOrigin(adminOrigin).attackOutcomes.getActiveTechniqueIdsByOrganization(
        new Map([[organizationId, [outcomeId]], [frenchOrganizationId, [outcomeId]]]),
      );

      const aloneFor = async (id: string) => {
        const result = await services.withOrigin(adminOrigin).attackOutcomes.getMitreTechniquesForOutcome(outcomeId, { organizationId: id });
        return new Set(result.techniques.filter(isActiveTechnique).map((technique) => technique.mitreTechniqueId));
      };
      expect(together.get(organizationId)!.get(outcomeId)).toEqual(await aloneFor(organizationId));
      expect(together.get(frenchOrganizationId)!.get(outcomeId)).toEqual(await aloneFor(frenchOrganizationId));
      const weightOfRemoteServices = async (id: string) => {
        const result = await services.withOrigin(adminOrigin).attackOutcomes.getMitreTechniquesForOutcome(outcomeId, { organizationId: id });
        return result.techniques.find((technique) => technique.externalId === 'T1133')!.weight;
      };
      expect(await weightOfRemoteServices(frenchOrganizationId)).toBeGreaterThan(await weightOfRemoteServices(organizationId));
    });

    describe('a pair with no stored mixture', () => {
      const repertoireOf = async (attackOutcomeId: string) =>
        services.withOrigin(adminOrigin).attackOutcomes.getRepertoireTechniquesForOutcome(attackOutcomeId, { organizationId });

      const ingestWithoutJob = async () => {
        await services.withOrigin(adminOrigin).threatAnalyses
          .ingestBundle([buildGroup('alpha', 'Alpha Group'), buildGroup('beta', 'Beta Group')], tenantId, 'stix-import');
        await recomputeActivityFor(tenantId);
      };

      it('should answer mixture-pending for a pair carrying a scenario the job has not run on', async () => {
        await ingestWithoutJob();

        const result = await weightsFor(getBreachOutcomeId());

        expect(result).toEqual({ evidenceMode: 'mixture-pending', mixtureGroups: [], techniques: [] });
      });

      it('should map the pair to null in the active technique sets', async () => {
        await ingestWithoutJob();
        const outcomeId = getBreachOutcomeId();

        const active = await services.withOrigin(adminOrigin).attackOutcomes
          .getActiveTechniqueIdsByOrganization(new Map([[organizationId, [outcomeId]]]));

        expect(active.get(organizationId)!.get(outcomeId)).toBeNull();
      });

      it('should answer mixture-pending on the repertoire read too', async () => {
        await ingestWithoutJob();

        const result = await repertoireOf(getBreachOutcomeId());

        expect(result).toEqual({ evidenceMode: 'mixture-pending', actors: [], techniques: [], unplayedCuratedCount: 0 });
      });

      it('should answer no-scenario with the curated fallback for a pair carrying none, even after a run of the job', async () => {
        await ingestWithoutJob();
        await recomputeMixtures();
        const espionageOutcomeId = outcomeRowId(AttackOutcome_Espionage);

        const result = await weightsFor(espionageOutcomeId);

        expect(result.evidenceMode).toBe('no-scenario');
        expect(result.mixtureGroups).toEqual([]);
        expect(result.techniques.length).toBeGreaterThan(0);
        expect(result.techniques.filter((technique) => technique.category === 'inferred' || technique.threats.length > 0)).toEqual([]);
      });

      it('should answer no-scenario on the repertoire read too, every curated technique unplayed', async () => {
        await ingestWithoutJob();
        await recomputeMixtures();
        const espionageOutcomeId = outcomeRowId(AttackOutcome_Espionage);

        const result = await repertoireOf(espionageOutcomeId);

        const curatedCount = (await weightsFor(espionageOutcomeId)).techniques.length;
        expect(result).toEqual({ evidenceMode: 'no-scenario', actors: [], techniques: [], unplayedCuratedCount: curatedCount });
      });
    });
  });

  describe('repertoire techniques', () => {
    const repertoireFor = async (attackOutcomeId: string) =>
      services.withOrigin(adminOrigin).attackOutcomes.getRepertoireTechniquesForOutcome(attackOutcomeId, { organizationId });

    it('should read the admitted actors whole repertoires and count the curated techniques nobody plays', async () => {
      const breachOutcomeId = outcomeRowId(AttackOutcome_DataBreachResale);
      const buildRepertoireGroup = (slug: string, name: string): ParsedThreatInput => ({
        threat: {
          stixId: `intrusion-set--${slug}`,
          entityType: 'intrusion-set',
          name,
          description: DATA_BREACH_DESCRIPTION,
          mitreGroupId: null,
          confidence: null,
          stixCreated: null,
          firstSeen: null,
          lastSeen: null,
          primaryMotivation: null,
          resourceLevel: null,
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
        techniques: ['T1213.001', 'T1595'].map((mitreExternalId, index) => ({
          stixId: `attack-pattern--${slug}-${index}`,
          stixRelationId: `relationship--${slug}-${index}`,
          name: `Technique ${mitreExternalId}`,
          mitreExternalId,
          producerStixId: 'identity--test-producer',
          producerName: 'Test Producer',
          isInferred: false,
          relCreated: null,
          relStartTime: null,
          relStopTime: null,
          relModified: null,
          relConfidence: 80,
        })),
      });
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle(
        [buildRepertoireGroup('alpha', 'Alpha Group')],
        tenantId,
        'stix-import',
      );
      await recomputeActivityFor(tenantId);
      await recomputeMixtures();

      const result = await repertoireFor(breachOutcomeId);
      const externalIds = result.techniques.map((technique) => technique.externalId);

      expect(result.evidenceMode).toBe('attacker-mixture');
      // T1595 is single-actor and uncurated: the repertoire read applies no inferred gate.
      expect(externalIds.toSorted()).toEqual(['T1213', 'T1595']);
      expect(result.techniques.every((technique) => technique.weight > 0)).toBe(true);
      // Data Breach & Resale curates other techniques the actor's repertoire never touches.
      expect(result.unplayedCuratedCount).toBeGreaterThan(0);
    });

    it('should list nothing and count every curated technique when no actor is admitted', async () => {
      await recomputeMixtures();

      const result = await repertoireFor(outcomeRowId(AttackOutcome_Ransomware));

      expect(result.evidenceMode).toBe('no-relevant-threats');
      expect(result.techniques).toEqual([]);
      expect(result.unplayedCuratedCount).toBeGreaterThan(0);
    });
  });

  describe('inferred technique gate', () => {
    // Repeated from the block above rather than shared: these fixtures pin the gate, so they must
    // stay readable next to the numbers they produce.
    interface GateGroup {
      slug: string,
      name: string,
      techniqueIds: Array<string>,
      observedAt?: Date,
    }

    const buildGateGroup = (group: GateGroup): ParsedThreatInput => ({
      threat: {
        stixId: `intrusion-set--${group.slug}`,
        entityType: 'intrusion-set',
        name: group.name,
        description: DATA_BREACH_DESCRIPTION,
        mitreGroupId: null,
        confidence: null,
        stixCreated: null,
        firstSeen: null,
        lastSeen: null,
        primaryMotivation: null,
        resourceLevel: null,
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
      // T1213.001 folds onto T1213, a signature technique of Data Breach & Resale.
      techniques: ['T1213.001', ...group.techniqueIds].map((mitreExternalId, index) => ({
        stixId: `attack-pattern--${group.slug}-${index}`,
        stixRelationId: `relationship--${group.slug}-${index}`,
        name: `Technique ${mitreExternalId}`,
        mitreExternalId,
        producerStixId: 'identity--test-producer',
        producerName: 'Test Producer',
        isInferred: false,
        relCreated: null,
        relStartTime: null,
        relStopTime: group.observedAt ?? null,
        relModified: null,
        relConfidence: 60,
      })),
    });

    const ingestGate = async (groups: Array<GateGroup>) => {
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle(groups.map(buildGateGroup), tenantId, 'stix-import');
      await recomputeActivityFor(tenantId);
      await recomputeMixtures();
    };

    const breachOutcomeId = () => outcomeRowId(AttackOutcome_DataBreachResale);

    const inferredOf = async () => {
      const result = await services.withOrigin(adminOrigin).attackOutcomes
        .getMitreTechniquesForOutcome(breachOutcomeId(), { organizationId });
      return { result, inferred: result.techniques.filter((technique) => technique.category === 'inferred') };
    };

    it('should never infer a technique corroborated by a single actor', async () => {
      // Alpha is freshly observed, so its share alone (0.6154) clears the weight floor: the only
      // gate that can keep its private technique out is the corroboration count.
      await ingestGate([
        { slug: 'alpha', name: 'Alpha Group', techniqueIds: ['T1595', 'T1590'], observedAt: new Date() },
        { slug: 'beta', name: 'Beta Group', techniqueIds: ['T1595'] },
      ]);

      const single = await inferredOf();
      expect(single.inferred.map((technique) => technique.externalId)).toEqual(['T1595']);

      // Same technique, same weight floor, one more distinct actor: it now qualifies.
      await ingestGate([{ slug: 'gamma', name: 'Gamma Group', techniqueIds: ['T1595', 'T1590'] }]);
      const corroborated = await inferredOf();
      const gathered = corroborated.inferred.find((technique) => technique.externalId === 'T1590')!;
      expect(gathered.sourceCount).toBe(2);
      expect(gathered.weight).toBeGreaterThan(INFERRED_MIN_WEIGHT);
    });

    it('should drop a corroborated technique that stays below the weight floor', async () => {
      // Alpha carries the whole mass (freshly observed), so a technique shared by the two stale
      // actors only reaches 0.25/1.75 = 0.143 even though two distinct actors corroborate it.
      await ingestGate([
        { slug: 'alpha', name: 'Alpha Group', techniqueIds: ['T1595'], observedAt: new Date() },
        { slug: 'beta', name: 'Beta Group', techniqueIds: ['T1595', 'T1596'] },
        { slug: 'gamma', name: 'Gamma Group', techniqueIds: ['T1595', 'T1596'] },
      ]);

      const { inferred } = await inferredOf();
      const faint = inferred.find((technique) => technique.externalId === 'T1596');
      expect(faint).toBeUndefined();
      expect(inferred.map((technique) => technique.externalId)).toEqual(['T1595']);
    });

    it('should keep only the strongest INFERRED_MAX_COUNT candidates, in descending weight order', async () => {
      // 12 candidates qualify on both gates; only the strongest 10 may reach the CRQ set, otherwise
      // the inferred set alone can saturate vulnerability.
      const pool = ['T1133', 'T1189', 'T1190', 'T1200', 'T1566', 'T1583', 'T1584', 'T1587', 'T1588', 'T1590', 'T1592', 'T1595'];
      const observedAt = new Date();

      await ingestGate([
        { slug: 'alpha', name: 'Alpha Group', techniqueIds: pool, observedAt },
        { slug: 'beta', name: 'Beta Group', techniqueIds: pool, observedAt },
      ]);

      const { inferred } = await inferredOf();

      expect(inferred).toHaveLength(INFERRED_MAX_COUNT);
      // Ties break on the technique id code points, so the truncation is fully deterministic: the
      // two highest ids of the pool are the ones that fall off.
      expect(inferred.map((technique) => technique.externalId)).toEqual(pool.toSorted().slice(0, INFERRED_MAX_COUNT));
      for (let index = 1; index < inferred.length; index += 1) {
        expect(inferred[index - 1].weight).toBeGreaterThanOrEqual(inferred[index].weight);
      }
      expect(inferred.every((technique) => technique.weight > INFERRED_MIN_WEIGHT)).toBe(true);
    });

    it('should drop an inferred candidate whose external id is not in the MITRE catalog', async () => {
      // Both gates pass for T9999, but nothing in `mitre_techniques` resolves it: it must be
      // dropped, never fabricated, because every consumer keys on the catalog uuid.
      await ingestGate([
        { slug: 'alpha', name: 'Alpha Group', techniqueIds: ['T1595', 'T9999'], observedAt: new Date() },
        { slug: 'beta', name: 'Beta Group', techniqueIds: ['T1595', 'T9999'], observedAt: new Date() },
      ]);

      const { result, inferred } = await inferredOf();
      expect(result.techniques.some((technique) => technique.externalId === 'T9999')).toBe(false);
      expect(inferred.map((technique) => technique.externalId)).toEqual(['T1595']);
    });
  });

  describe('tenant scoping outside a client origin', () => {
    const buildGroup = (slug: string, name: string, authoredAt: Date | null): ParsedThreatInput => ({
      threat: {
        stixId: `intrusion-set--${slug}`,
        entityType: 'intrusion-set',
        name,
        description: DATA_BREACH_DESCRIPTION,
        mitreGroupId: null,
        confidence: null,
        stixCreated: null,
        firstSeen: null,
        lastSeen: null,
        primaryMotivation: null,
        resourceLevel: null,
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
      techniques: [{
        stixId: `attack-pattern--${slug}-repo`,
        stixRelationId: `relationship--${slug}-repo`,
        name: 'Data from Information Repositories: Confluence',
        mitreExternalId: 'T1213.001',
        producerStixId: 'identity--test-producer',
        producerName: 'Test Producer',
        isInferred: false,
        relCreated: authoredAt,
        relStartTime: null,
        relStopTime: null,
        relModified: null,
        relConfidence: 80,
      }],
    });

    const breachOutcomeId = () => outcomeRowId(AttackOutcome_DataBreachResale);

    it('should refuse to compute without a tenant when the origin carries none', async () => {
      const outcomeId = breachOutcomeId();

      // No tenant on the origin and none supplied: computing anyway would build one distribution
      // over every tenant's intrusion sets and leak actor names into the caller's run.
      await expect(services.withOrigin(SYSTEM_ORIGIN).attackOutcomes
        .getMitreTechniquesForOutcome(outcomeId, { organizationId })).rejects.toThrow(/Tenant context required/);
      await expect(services.withOrigin(SYSTEM_ORIGIN).attackOutcomes
        .getActiveTechniqueIdsByOrganization(new Map([[organizationId, [outcomeId]]]))).rejects.toThrow(/Tenant context required/);
    });

    it('should attribute a system-origin computation to the requested tenant only', async () => {
      const tenantBId = await createTenant(services, adminUserId);
      const tenantBOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenantBId };
      const tenantBOrganizationId = await createOrganization(tenantBOrigin, 'Other Organization');

      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([buildGroup('alpha', 'Tenant A Actor', null)], tenantId, 'stix-import');
      await services.withOrigin(tenantBOrigin).threatAnalyses.ingestBundle([buildGroup('beta', 'Tenant B Actor', null)], tenantBId, 'stix-import');
      await recomputeActivityFor(tenantId);
      await recomputeActivityFor(tenantBId);
      await recomputeMixtures();

      const outcomeId = breachOutcomeId();
      const result = await services.withOrigin(SYSTEM_ORIGIN).attackOutcomes
        .getMitreTechniquesForOutcome(outcomeId, { organizationId, tenantId });

      const repoTechnique = result.techniques.find((technique) => technique.externalId === 'T1213')!;
      expect(repoTechnique.threats.map((threat) => threat.canonicalName)).toEqual(['Tenant A Actor']);
      expect(repoTechnique.sourceCount).toBe(1);

      // The organization keys the targeting profile, so it must belong to the scoped tenant.
      await expect(services.withOrigin(SYSTEM_ORIGIN).attackOutcomes
        .getMitreTechniquesForOutcome(outcomeId, { organizationId: tenantBOrganizationId, tenantId }))
        .rejects.toThrow(/Organization does not belong to the tenant context/);
    });

    it('should apply the tenant relevance settings under a system origin', async () => {
      // Two authored anchors of different ages: the half-life is only observable as the gap it opens
      // between their shares, since a decay every actor undergoes together cancels in the shares.
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle(
        [
          buildGroup('alpha', 'Alpha Group', new Date(Date.now() - 90 * DAY_MS)),
          buildGroup('beta', 'Beta Group', new Date(Date.now() - 365 * DAY_MS)),
        ],
        tenantId,
        'stix-import',
      );
      await recomputeActivityFor(tenantId);
      await recomputeMixtures();
      const outcomeId = breachOutcomeId();
      // The counter reads the name too, so two groups never store the same percentage: equal weights
      // leave the half-life as the only thing separating the shares.
      await db.update(threatAnalysisOutcomeProbabilities).set({ probability: 0.9 })
        .where(eq(threatAnalysisOutcomeProbabilities.attackOutcomeId, outcomeId));
      const scope = { organizationId, tenantId };
      const alphaShareOf = (result: { techniques: Array<{ externalId: string, threats: Array<{ canonicalName: string, share: number }> }> }) =>
        result.techniques.find((technique) => technique.externalId === 'T1213')!
          .threats.find((threat) => threat.canonicalName === 'Alpha Group')!.share;

      const withDefaults = await services.withOrigin(SYSTEM_ORIGIN).attackOutcomes.getMitreTechniquesForOutcome(outcomeId, scope);
      // Default authored half-life 365 days: rho is 2^(-90/365) against 0.5, so alpha holds ~63%.
      expect(alphaShareOf(withDefaults)).toBeCloseTo(0.628, 2);

      await services.withOrigin(adminOrigin).threatRelevanceSettings.updateThreatRelevanceSettings({
        actHalfLifeObservedDays: 30,
        actHalfLifeAuthoredDays: 30,
        confidenceGate: THREAT_RELEVANCE_DEFAULTS.confidenceGate,
      });
      await recomputeMixtures();

      const withSettings = await services.withOrigin(SYSTEM_ORIGIN).attackOutcomes.getMitreTechniquesForOutcome(outcomeId, scope);

      // A 30-day authored half-life ages beta by twelve half-lives against alpha's three: nothing
      // but the settings changed, so an unthreaded tenant would reproduce the defaults exactly.
      expect(alphaShareOf(withSettings)).toBeGreaterThan(0.99);
    });
  });

  describe('tenant isolation', () => {
    let tenantBOrigin: EventOrigin;
    let tenantBId: string;

    beforeEach(async () => {
      tenantBId = await createTenant(services, adminUserId);
      tenantBOrigin = { type: 'client', userId: adminUserId, tenantId: tenantBId };
    });

    it('should see the same core outcomes in both tenants', async () => {
      const tenantAOutcomes = await services.withOrigin(adminOrigin).attackOutcomes.getAttackOutcomes();
      const tenantBOutcomes = await services.withOrigin(tenantBOrigin).attackOutcomes.getAttackOutcomes();

      expect(tenantAOutcomes.length).toBe(tenantBOutcomes.length);
      for (const outcome of tenantAOutcomes) {
        expect(outcome.tenantId).toBe(tenantId);
      }
      for (const outcome of tenantBOutcomes) {
        expect(outcome.tenantId).toBe(tenantBId);
      }
    });

    it('should not expose an outcome curated in another tenant', async () => {
      const outcomeIdOfTenantA = outcomeRowId(AttackOutcome_Ransomware);
      const curated = await services.withOrigin(tenantBOrigin)
        .attackOutcomes.getCuratedMitreTechniquesForOutcome(outcomeIdOfTenantA);

      expect(curated).toEqual([]);
    });
  });
});

const OUTCOMES_DATA_PATH = '../../../../module/src/modules/attack-outcomes/data/attack-outcomes-data';

/**
 * Re-seeds the tenant against a catalog the shipped reference does not contain, which is the only
 * way to observe what a future edit of the reference would do. A plain `vi.mock` factory does not
 * reach the seeder's own static import of the module's data, so the module graph is rebuilt around
 * the override and the seeder is re-imported from it.
 */
const seedWithCatalog = async (outcomes: ReadonlyArray<AttackOutcomeReference>): Promise<void> => {
  vi.resetModules();
  vi.doMock(OUTCOMES_DATA_PATH, async () => ({
    ...(await vi.importActual<object>(OUTCOMES_DATA_PATH)),
    ATTACK_OUTCOMES: outcomes,
  }));
  const overridden = await import('@app/module');
  await overridden.seedAttackOutcomes(db);
};

const externalIdByTechniqueId = new Map(mitreTechniquesData.map((technique) => [technique.id, technique.externalId]));
const techniqueIdByExternalId = new Map(mitreTechniquesData.map((technique) => [technique.externalId, technique.id]));

/** The tenant's curated technique links, as `outcome row id -> technique external id -> category`. */
const outcomeTechniques = async (tenantId: string): Promise<Map<string, Map<string, string>>> => {
  const rows = await db
    .select({
      attackOutcomeId: attackOutcomeMitreTechniques.attackOutcomeId,
      mitreTechniqueId: attackOutcomeMitreTechniques.mitreTechniqueId,
      category: attackOutcomeMitreTechniques.category,
    })
    .from(attackOutcomeMitreTechniques)
    .innerJoin(attackOutcomesTable, eq(attackOutcomesTable.id, attackOutcomeMitreTechniques.attackOutcomeId))
    .where(eq(attackOutcomesTable.tenantId, tenantId));

  const byOutcome = new Map<string, Map<string, string>>();
  for (const row of rows) {
    const links = byOutcome.get(row.attackOutcomeId) ?? new Map<string, string>();
    links.set(externalIdByTechniqueId.get(row.mitreTechniqueId)!, row.category);
    byOutcome.set(row.attackOutcomeId, links);
  }
  return byOutcome;
};

/** The module owns its catalog and the technique junction: the boot seeder reprovisions both. */
describe('Attack Outcomes re-seed', () => {
  let adminUserId: string;
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminUserId = setup.userId;
    tenantId = setup.tenantId;
  });

  afterEach(() => {
    vi.doUnmock(OUTCOMES_DATA_PATH);
    vi.resetModules();
  });

  it('should give the criteria reached to the outcomes of a new tenant and backfill those of an existing one', async () => {
    const criteriaOf = async (id: string) => (await db
      .select({
        name: attackOutcomesTable.name,
        availability: attackOutcomesTable.reachesAvailability,
        integrity: attackOutcomesTable.reachesIntegrity,
        confidentiality: attackOutcomesTable.reachesConfidentiality,
        traceability: attackOutcomesTable.reachesTraceability,
      })
      .from(attackOutcomesTable)
      .where(eq(attackOutcomesTable.tenantId, id)))
      .map(({ name, ...criteria }) => [name, criteria] as const)
      .toSorted(([a], [b]) => a.localeCompare(b));
    const expected = ATTACK_OUTCOMES
      .map((outcome) => [outcome.name, outcome.criteriaReached] as const)
      .toSorted(([a], [b]) => a.localeCompare(b));

    expect(await criteriaOf(tenantId)).toEqual(expected);

    // What the migration leaves on a deployment that predates the columns.
    await db.update(attackOutcomesTable).set({
      reachesAvailability: 'none', reachesIntegrity: 'none', reachesConfidentiality: 'none', reachesTraceability: 'none',
    }).where(eq(attackOutcomesTable.tenantId, tenantId));
    await seedAttackOutcomes(db);

    expect(await criteriaOf(tenantId)).toEqual(expected);
  });

  it('should relink every outcome technique after the junction was emptied', async () => {
    const before = await outcomeTechniques(tenantId);
    expect(before.size).toBe(ATTACK_OUTCOMES.length);

    // A migration wiping the outcomes cascades the junction away on an existing deployment, and
    // nothing but this seeder ever puts the links back.
    await db.delete(attackOutcomeMitreTechniques);
    expect((await outcomeTechniques(tenantId)).size).toBe(0);

    await seedAttackOutcomes(db);

    const after = await outcomeTechniques(tenantId);
    expect(after).toEqual(before);
    for (const outcome of ATTACK_OUTCOMES) {
      const links = after.get(deriveSeedId(tenantId, outcome.id));
      // A CRQ run on an outcome with no active signature technique fails non-retryably.
      expect([...links!.values()].filter((category) => category === 'signature').length).toBeGreaterThan(0);
    }
  });

  it('should propagate a technique list edited in the reference', async () => {
    const breachRowId = deriveSeedId(tenantId, AttackOutcome_DataBreachResale);
    const espionageRowId = deriveSeedId(tenantId, AttackOutcome_Espionage);
    const before = await outcomeTechniques(tenantId);
    expect(before.get(breachRowId)!.get('T1041')).toBe('signature');
    expect(before.get(breachRowId)!.get('T1560')).toBe('related');
    expect(before.get(breachRowId)!.get('T1005')).toBe('signature');

    await seedWithCatalog(ATTACK_OUTCOMES.map((outcome) => (outcome.id === AttackOutcome_DataBreachResale
      ? { ...outcome, signatureTechniqueExternalIds: ['T1041', 'T1560'], relatedTechniqueExternalIds: ['T1005'] }
      : outcome)));

    const after = await outcomeTechniques(tenantId);
    // Added, promoted from related to signature, demoted to related, and everything else pruned.
    expect(after.get(breachRowId)).toEqual(new Map([['T1041', 'signature'], ['T1560', 'signature'], ['T1005', 'related']]));
    expect(after.get(espionageRowId)).toEqual(before.get(espionageRowId));
  });

  it('should prune a pair the catalog never curated without reaching another tenant', async () => {
    const otherTenantId = await createTenant(services, adminUserId);
    const breachRowId = deriveSeedId(tenantId, AttackOutcome_DataBreachResale);

    // T1002 is revoked and cited by no catalog entry: the shape of a hand-inserted extra link.
    await db.insert(attackOutcomeMitreTechniques)
      .values({ attackOutcomeId: breachRowId, mitreTechniqueId: techniqueIdByExternalId.get('T1002')!, category: 'signature' })
      .onConflictDoNothing();
    const otherBefore = await outcomeTechniques(otherTenantId);

    await seedAttackOutcomes(db);

    expect((await outcomeTechniques(tenantId)).get(breachRowId)!.has('T1002')).toBe(false);
    expect(await outcomeTechniques(otherTenantId)).toEqual(otherBefore);
  });
});
