import { newError } from '@app/utils';
import { uuidv7 } from 'uuidv7';
import type { ActivityAssessment, ActivityColumns } from './activity-scoring';
import type { ActorClass } from './actor-classes';
import type { ThreatEntityType } from './entity-types';
import type { ThreatListSortKey } from './list-sort';
import type { ThreatSourceKind } from './source-kinds';
import type { MixtureGroupInput, TechniqueLink } from './technique-weighting';
import type { OutcomeCounter } from './outcome-counter/outcome-counter';
import type { InferRepository } from '../../registry';
import { defineService } from '../../registry';
import { cveService } from '../cve';
import { threatRelevanceSettingsService } from '../threat-relevance-settings';
import { deriveActorClass } from './actor-classes';
import { dedupeAliases, dedupeCaseInsensitive } from './aliases';
import { activeSince } from './activity-grades';
import { activityWeightFor, assessmentActivityAnchor, assessmentFromActivityColumns, notAfter } from './activity-scoring';
import { deriveCanonicalAnalysis } from './canonical';
import { collapseClaimsByTarget } from './claim-collapse';
import { DEFAULT_RELATION_CONFIDENCE } from './constants';
import { bucketDistribution } from './outcome-distribution';
import { threatAnalysesRepository } from './repository';
import { explainRelevance } from './relevance-proof';
import { resolveCatalogAttackOutcomeRowIds } from './outcome-counter/catalog-outcome-rows';
import { buildCounterParents, buildCounterRecord, orderParentsFirst } from './outcome-counter/counter-record';
import { hasMinimumEvidence, loadOutcomeCounter, OUTCOME_COUNTER_OUTCOMES, OUTCOME_COUNTER_VERSION } from './outcome-counter/outcome-counter';
import { computeRelevance, effectiveOutcomeWeight, STRONG_OUTCOME_MATCH_SCORE } from './outcome-counter/outcome-weight';
import { compareRelevantThreats, projectOutcomeScoreRows } from './outcome-selection';

// A parent's percentage must move by more than this for its children, which read it, to be rescored:
// below it a child would barely move, and two threats attributed to each other would keep waking each
// other for vanishing differences.
const CHILD_RESCORE_THRESHOLD = 0.01;

// Below this, a bundle's own claims are too few to have moved the planner's row estimates enough
// to be worth an `ANALYZE`. Counted in rows of the analyzed tables, not in bundle entries: one
// threat carrying hundreds of CVE and technique relationships moves those estimates more than
// fifty claim-less actors do. Every row of an actor the ingestion wrote counts, an upper bound of
// what it moved, since a change to one claim is not told apart from a rewrite of all of them. A live
// connector's single-group flush is one actor, its claims and its stored percentages, which stays an
// order of magnitude under this.
const ANALYZE_AFTER_CLAIM_ROWS = 500;

// How many matching actors the attack outcome overview's own table shows, mirroring the
// dashboard's `TOP_CONTROLS_LIMIT`-style caps rather than shipping every match to the client.
const TOP_MATCHING_ACTORS_LIMIT = 5;

const groupByAnalysisId = <T extends { analysisId: string }>(
  rows: Array<T>,
  pick: (row: T) => string,
): Map<string, Array<string>> => {
  const byAnalysisId = new Map<string, Array<string>>();
  for (const row of rows) {
    const values = byAnalysisId.get(row.analysisId) ?? [];
    values.push(pick(row));
    byAnalysisId.set(row.analysisId, values);
  }
  return byAnalysisId;
};

/** The tRPC link has no date transformer: a date reaches the client as a `YYYY-MM-DD` string. */
const calendarDate = (date: Date | null | undefined): string | null => date?.toISOString().slice(0, 10) ?? null;

const uniqueById = <T extends { id: string }>(rows: Array<T>): Array<T> =>
  [...new Map(rows.map((row) => [row.id, row])).values()];

const spreadActivity = <T extends ActivityColumns>(rows: Array<T>): Array<T & ActivityAssessment> =>
  rows.map((row) => ({ ...row, ...assessmentFromActivityColumns(row) }));

const catalogByType = async (repo: InferRepository<typeof threatAnalysesRepository>) => {
  const analyses = await repo.countCatalogByType({ activeSince: activeSince(new Date()) });
  const total = (entityType: ThreatEntityType): number => analyses.find((row) => row.entityType === entityType)?.total ?? 0;
  return {
    threatActors: total('threat-actor'),
    intrusionSets: total('intrusion-set'),
    campaigns: total('campaign'),
    active: analyses.reduce((sum, row) => sum + row.active, 0),
  };
};

/**
 * A relationship's standard id folds in `start_time`/`stop_time`, so a foreign producer's id
 * resolves nowhere but its own platform: only a connector actor's ids are safe to link.
 * `stixRelationId` is dropped rather than left for the router to strip.
 */
const linkableClaims = <T extends { stixRelationId: string }>(
  rows: Array<T>,
  kind: ThreatSourceKind,
): Array<Omit<T, 'stixRelationId'> & { openctiStixRelationId: string | null }> =>
  rows.map(({ stixRelationId, ...row }) => ({
    ...row,
    openctiStixRelationId: kind === 'connector' ? stixRelationId : null,
  }));

type MixtureEvidence = { groups: Array<MixtureGroupInput>, links: Array<TechniqueLink> };

/** An organization's country and sector: the only selection input that differs between organizations. */
export interface TargetingProfile {
  countryIds: Array<string>,
  sectorIds: Array<string>,
}

type SelectedThreat = Awaited<ReturnType<typeof threatAnalysesRepository.findSelectedThreats>>[number];

interface Targeting {
  countryMatch: boolean,
  sectorMatch: boolean,
}

const NO_TARGETING: Targeting = { countryMatch: false, sectorMatch: false };

interface Selection {
  /** The threats leading to each requested outcome, with their effective weight on it. */
  byOutcomeId: Map<string, Array<{ threat: SelectedThreat, weight: number }>>,
  /** Every selected threat, once. */
  analysisIds: Array<string>,
  /** What each targeting profile matches among the selected threats, one map per profile in input order. */
  targetingByProfile: Array<Map<string, Targeting>>,
}

/**
 * The threats a scenario's outcomes select: those with a positive effective weight on the outcome,
 * read in SQL from the stored percentages. Targeting plays no part in it: it is read afterwards, for
 * the selected threats alone and per profile, and only scales their relevance.
 */
const selectThreats = async (
  repo: InferRepository<typeof threatAnalysesRepository>,
  gate: number,
  params: { attackOutcomeIds: Array<string>, profiles: Array<TargetingProfile>, tenantId?: string, analysisIds?: Array<string> },
): Promise<Selection> => {
  const rows = await repo.findSelectedThreats({
    attackOutcomeIds: params.attackOutcomeIds,
    tenantId: params.tenantId,
    analysisIds: params.analysisIds,
  });
  const byOutcomeId = new Map<string, Array<{ threat: SelectedThreat, weight: number }>>(
    params.attackOutcomeIds.map((attackOutcomeId) => [attackOutcomeId, []]),
  );
  for (const threat of rows) {
    byOutcomeId.get(threat.attackOutcomeId)?.push({
      threat,
      weight: effectiveOutcomeWeight({ probability: threat.probability, evidenceSufficient: true }),
    });
  }
  const analysisIds = [...new Set(rows.map((row) => row.id))];

  // Sequential, not `Promise.all`: the platform seed calls this on its transaction's one connection.
  const targetingByProfile: Array<Map<string, Targeting>> = [];
  for (const profile of params.profiles) {
    const matches = profile.countryIds.length === 0 && profile.sectorIds.length === 0
      ? []
      : await repo.findTargetingMatches({
        analysisIds,
        countryIds: profile.countryIds,
        sectorIds: profile.sectorIds,
        gate,
      });
    targetingByProfile.push(new Map(matches.map((match) => [
      match.id,
      { countryMatch: Boolean(match.countryMatch), sectorMatch: Boolean(match.sectorMatch) },
    ])));
  }
  return { byOutcomeId, analysisIds, targetingByProfile };
};

/**
 * Evidence the attacker-mixture weighting consumes, per attack outcome, in the exact input shape
 * of `computeAttackerMixture` and `computeScenarioTechniqueWeights`, one map per targeting profile
 * in input order. Only the targeting flags depend on the profile: every other read serves all of
 * them, so the scenarios of several organizations cost one pass, not one per organization.
 *
 * The groups are `selectThreats`, so the actors backing a weight are exactly the actors the
 * Relevant Threats tab lists. What differs is the payload: graded anchors, aliases and the group's
 * WHOLE ingested repertoire.
 *
 * Binding universe contract: `links` and `MixtureGroupInput.techniqueExternalIds` are both the
 * unfiltered repertoire, served by the same query. The published weight is therefore the share of
 * the selected mixture whose repertoire contains the technique, whether or not that technique is
 * curated on the outcome, which is exactly what makes the inferred set commensurable with the
 * curated one.
 */
const readMixtureEvidence = async (
  repo: InferRepository<typeof threatAnalysesRepository>,
  gate: number,
  params: { attackOutcomeIds: Array<string>, profiles: Array<TargetingProfile>, tenantId?: string },
): Promise<Array<Map<string, MixtureEvidence>>> => {
  const evidenceByProfile = params.profiles.map(() => new Map<string, MixtureEvidence>(
    params.attackOutcomeIds.map((attackOutcomeId) => [attackOutcomeId, { groups: [], links: [] }]),
  ));
  const { byOutcomeId, analysisIds, targetingByProfile } = await selectThreats(repo, gate, params);
  if (analysisIds.length === 0) {
    return evidenceByProfile;
  }

  const aliasRows = await repo.findAliasesForAnalyses(analysisIds);
  const linkRows = await repo.findTechniqueLinksForAnalyses({ analysisIds, gate });

  const aliasesByAnalysisId = groupByAnalysisId(aliasRows, (row) => row.alias);
  const techniquesByAnalysisId = groupByAnalysisId(linkRows, (row) => row.mitreExternalId);

  targetingByProfile.forEach((targeting, profileIndex) => {
    for (const attackOutcomeId of params.attackOutcomeIds) {
      const groups: Array<MixtureGroupInput> = [];
      const links: Array<TechniqueLink> = [];
      for (const { threat, weight } of byOutcomeId.get(attackOutcomeId) ?? []) {
        const techniqueExternalIds = techniquesByAnalysisId.get(threat.id) ?? [];
        groups.push({
          groupKey: threat.id,
          name: threat.name,
          entityType: threat.entityType,
          aliases: aliasesByAnalysisId.get(threat.id) ?? [],
          mitreGroupId: threat.mitreGroupId,
          stixId: threat.stixId,
          anchor: assessmentActivityAnchor(assessmentFromActivityColumns(threat)),
          ...(targeting.get(threat.id) ?? NO_TARGETING),
          weight,
          techniqueExternalIds,
        });
        for (const mitreExternalId of techniqueExternalIds) {
          links.push({ groupKey: threat.id, mitreExternalId });
        }
      }
      evidenceByProfile[profileIndex].set(attackOutcomeId, { groups, links });
    }
  });
  return evidenceByProfile;
};

export interface AdmittedThreat {
  id: string,
  name: string,
  entityType: ThreatEntityType,
  activityScore: number | null,
  lastObservedAt: Date | null,
  /** The `combinedRelevance` `getRelevantForScenario` gives it for that pair. */
  combinedRelevance: number,
}

/** Analyses whose projections are held in memory per round, which is what the sweep costs. */
export const LIST_PROJECTION_BATCH_SIZE = 1000;

/**
 * What the list projections were folded by, stamped on every row the sweep writes. The sweep skips
 * an analysis whose inputs are unchanged, so nothing else would ever make it re-read one after a
 * deploy: bump this by hand whenever the projected values could come out different for unchanged
 * inputs — the probability threshold a row needs, the gating of a claim, or the shape of what is
 * projected.
 *
 * Forgetting to bump it leaves already-computed rows on the old fold until their analysis is
 * ingested again; it never serves a wrong count or score for a changed input.
 */
export const LIST_PROJECTION_VERSION = '2026.11';

// The ingestion contract. It repeats the parser's output shape rather than reusing its types, so a
// producer other than the parser satisfies it too.
export interface ClaimProvenanceInput {
  stixRelationId: string,
  producerStixId: string | null,
  producerName: string | null,
  isInferred: boolean,
}

export interface ThreatAnalysisLocationInput extends ClaimProvenanceInput {
  stixId: string,
  name: string,
  country: string | null,
  relCreated: Date | null,
  relStartTime: Date | null,
  relStopTime: Date | null,
  relModified: Date | null,
  relConfidence: number | null,
}

export interface ThreatAnalysisSectorInput extends ClaimProvenanceInput {
  stixId: string,
  name: string,
  relCreated: Date | null,
  relStartTime: Date | null,
  relStopTime: Date | null,
  relModified: Date | null,
  relConfidence: number | null,
}

export interface ThreatAnalysisCveInput extends ClaimProvenanceInput {
  stixId: string,
  cveId: string,
  relCreated: Date | null,
  relStartTime: Date | null,
  relStopTime: Date | null,
  relModified: Date | null,
  relConfidence: number | null,
}

export interface ThreatAnalysisTechniqueInput extends ClaimProvenanceInput {
  stixId: string,
  name: string,
  mitreExternalId: string,
  relCreated: Date | null,
  relStartTime: Date | null,
  relStopTime: Date | null,
  relModified: Date | null,
  relConfidence: number | null,
}

export interface ThreatAnalysisAttributionInput extends ClaimProvenanceInput {
  targetStixId: string,
  relCreated: Date | null,
  relStartTime: Date | null,
  relStopTime: Date | null,
  relModified: Date | null,
  relConfidence: number | null,
}

export interface ThreatAnalysisMalwareInput {
  stixId: string,
  name: string,
  types: Array<string>,
}

export interface ThreatAnalysisReportInput {
  stixId: string,
  title: string,
  summary: string,
  labels: Array<string>,
  published: Date | null,
}

export interface ParsedThreatInput {
  threat: {
    stixId: string,
    entityType: ThreatEntityType,
    name: string,
    description: string | null,
    mitreGroupId: string | null,
    confidence: number | null,
    stixCreated: Date | null,
    firstSeen: Date | null,
    lastSeen: Date | null,
    primaryMotivation: string | null,
    resourceLevel: string | null,
    sophistication: string | null,
    objective: string | null,
    // Read at ingestion, never stored: they feed the outcome counter, and derive the class the actor
    // row keeps unless the producer states one (`statedActorClass`).
    labels: Array<string>,
  },
  // Required (not optional): `replaceAnalysisChildren` makes the stored aliases equal to this list, so a
  // producer that simply forgets the field would silently wipe previously ingested aliases.
  aliases: Array<string>,
  // Same reason `aliases` is required: every child collection is made equal to its list, so an
  // omitted field would silently wipe what a previous ingestion stored.
  secondaryMotivations: Array<string>,
  goals: Array<string>,
  threatActorTypes: Array<string>,
  roles: Array<string>,
  attributions: Array<ThreatAnalysisAttributionInput>,
  locations: Array<ThreatAnalysisLocationInput>,
  sectors: Array<ThreatAnalysisSectorInput>,
  cves: Array<ThreatAnalysisCveInput>,
  techniques: Array<ThreatAnalysisTechniqueInput>,
  // Read by the outcome counter and never stored, like `threat.labels`: unlike the collections above, a
  // producer leaving them out wipes nothing, it only gives the counter less to read.
  malware?: Array<ThreatAnalysisMalwareInput>,
  reports?: Array<ThreatAnalysisReportInput>,
  // Probabilities a judgment set gives the threat, by catalogue attack-outcome id. They stand in for the
  // counter's on every outcome they state, and the counter's fill the others. Left out, the counter
  // assesses the threat alone, and a threat a previous ingestion gave judgments loses them.
  judgedOutcomes?: { judgedAt: Date, probabilities: ReadonlyMap<string, number> },
  // The class the producer states, standing in for the one `threat.labels` and `threat.resourceLevel`
  // derive. A label written for it would also move the counter's probabilities.
  statedActorClass?: ActorClass,
}

export const threatAnalysesService = defineService(
  'threatAnalyses',
  threatAnalysesRepository,
).dependsOn(() => [cveService, threatRelevanceSettingsService]).implement({
  /**
   * The order in which a caller updating several actors of a tenant in one transaction must take
   * them: by the primary key its updates target, which is the key the activity recompute walks too. One STIX id is one actor, so a STIX id with no row yet sorts last and
   * inserts one nothing else can be waiting on.
   */
  orderStixIdsByAnalysis: async (
    { repo }, tenantId: string, sourceKind: ThreatSourceKind, stixIds: Array<string>,
  ): Promise<Array<string>> => {
    const analysisIdByStixId = new Map(
      (await repo.findAnalysisIdsByStixIds(tenantId, sourceKind, stixIds)).map((row) => [row.stixId, row.analysisId]),
    );
    return [...stixIds].sort((left, right) => {
      const leftId = analysisIdByStixId.get(left);
      const rightId = analysisIdByStixId.get(right);
      if (leftId === undefined || rightId === undefined) {
        return (leftId === undefined ? 1 : 0) - (rightId === undefined ? 1 : 0) || left.localeCompare(right);
      }
      return leftId.localeCompare(rightId);
    });
  },

  /**
   * Folds a parsed STIX bundle into the tenant's threat catalog.
   *
   * Two guarantees, and they are the whole point of this method:
   *
   * 1. **Written as a difference.** Re-ingesting an upstream object makes its actor's attributes and
   *    every one of its claims equal to the object's: a relationship dropped upstream disappears,
   *    and what it states again is not written, so an unchanged object rings no doorbell.
   * 2. **One STIX id, one actor.** The only resolution is the actor row already carrying that STIX
   *    id; anything else is a new actor, whatever name, alias or MITRE group id it shares with an
   *    existing one. Nothing here merges two upstream objects: a reader can explain a visible
   *    duplicate, and a customer who wants two actors to be one merges them in OpenCTI, whose merge
   *    the connector follows.
   *
   * Each entry is processed in its own transaction so a failure on one threat doesn't roll back the
   * others.
   *
   * The outcome counter scores each entry in that same transaction, parents first: a campaign reads
   * the percentages its group was just given. A parent outside the batch is read as stored. An entry
   * carrying `judgedOutcomes` stores them instead, the counter's percentage filling an outcome the
   * judgment leaves out, and counts as having enough evidence. The
   * `onProbabilitiesChanged` is told the STIX id of each entry whose percentages moved by more than
   * `CHILD_RESCORE_THRESHOLD`, for a caller
   * that knows their children (the mirror rebuild); a bundle has no mirror to mark.
   *
   * `rescoreOnly` writes an entry only while its actor exists and is scored under another model
   * version: a file replayed for a new model must neither bring back an actor deleted since nor
   * overwrite one a newer ingestion already rescored.
   *
   * `counter` replaces the shipped model, which is loaded on first use otherwise: the platform seed
   * answers its demo threats from stored percentages rather than pay for the model.
   */
  ingestBundle: async (
    { atomic, deps, repo },
    parsed: Array<ParsedThreatInput>,
    tenantId: string,
    sourceKind: ThreatSourceKind,
    options: { onProbabilitiesChanged?: (stixId: string) => void, rescoreOnly?: boolean, counter?: OutcomeCounter } = {},
  ) => {
    const { onProbabilitiesChanged, rescoreOnly = false } = options;
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    let skipped = 0;
    let claimRows = 0;
    const counter = options.counter ?? loadOutcomeCounter();

    // Upsert a CVE catalog shell for every targeted CVE, same pattern as the Microsoft Defender
    // import (`cveService.upsertCves`): keeps existing authoritative scores (NIST/FIRST/CISA)
    // untouched, but guarantees the CVE exists in the catalog so the CVEs tab can show it even
    // before any scoring sync has run.
    const allCveIds = [...new Set(parsed.flatMap((entry) => entry.cves.map((c) => c.cveId)))];
    if (allCveIds.length > 0) {
      await deps.cve.upsertCves(allCveIds.map((cveId) => ({ cveId })));
    }

    const catalogOutcomeIdsByRowId = resolveCatalogAttackOutcomeRowIds(await repo.findAttackOutcomeNames());
    const rowIdByCatalogId = new Map([...catalogOutcomeIdsByRowId].map(([rowId, catalogId]) => [catalogId, rowId]));

    for (const entry of orderParentsFirst(parsed)) {
      const aliases = dedupeAliases(entry.aliases);
      // Same rule as aliases: dedup this object's own contribution so the unique index on
      // (analysis_id, lower(value)) cannot be violated by a feed listing the same word twice under
      // a different casing.
      const secondaryMotivations = dedupeCaseInsensitive(entry.secondaryMotivations);
      const goals = dedupeCaseInsensitive(entry.goals);
      const threatActorTypes = dedupeCaseInsensitive(entry.threatActorTypes);
      const roles = dedupeCaseInsensitive(entry.roles);

      const outcome = await atomic(async ({ repo: atomicRepo }) => {
        const existing = await atomicRepo.findAnalysisByStixId(tenantId, entry.threat.stixId);
        if (rescoreOnly && (existing === undefined || existing.outcomeModelVersion === OUTCOME_COUNTER_VERSION)) {
          return null;
        }

        const parentStixIds = [...new Set(entry.attributions.map((attribution) => attribution.targetStixId))];
        const counterRecord = buildCounterRecord(
          { ...entry, malware: entry.malware ?? [], reports: entry.reports ?? [] },
          buildCounterParents(
            entry.attributions,
            await atomicRepo.findOutcomeProbabilitiesByStixIds(tenantId, parentStixIds),
            catalogOutcomeIdsByRowId,
          ),
        );
        const counterProbabilities = counter.predict(counterRecord);

        const stated = deriveCanonicalAnalysis({
          stixId: entry.threat.stixId,
          entityType: entry.threat.entityType,
          name: entry.threat.name,
          description: entry.threat.description,
          mitreGroupId: entry.threat.mitreGroupId,
          confidence: entry.threat.confidence,
          stixCreated: entry.threat.stixCreated,
          firstSeen: entry.threat.firstSeen,
          lastSeen: entry.threat.lastSeen,
          primaryMotivation: entry.threat.primaryMotivation,
          resourceLevel: entry.threat.resourceLevel,
          sophistication: entry.threat.sophistication,
          objective: entry.threat.objective,
          actorClass: entry.statedActorClass ?? deriveActorClass(entry.threat.labels, entry.threat.resourceLevel),
        });
        const ingestedAt = new Date();
        const judged = entry.judgedOutcomes;
        const actorValues = {
          kind: sourceKind,
          ...stated,
          outcomeModelVersion: OUTCOME_COUNTER_VERSION,
          // A judgment is the evidence, including one that the threat leads to no outcome at all.
          outcomeEvidenceSufficient: judged !== undefined || hasMinimumEvidence(counterRecord),
          outcomeJudgedAt: judged?.judgedAt ?? null,
          lastIngestedAt: ingestedAt,
        };

        // `tenantId` and `firstIngestedAt` are only ever set on insert: the first keeps an actor
        // from moving between tenants, the second is when it entered the catalog. The restatement
        // comes first so its row lock serializes two ingests of the same actor.
        const restated = existing ? await atomicRepo.restateAnalysis(existing.id, actorValues) : undefined;
        const analysisId = restated
          ? restated.id
          : (await atomicRepo.insertAnalysis({ id: uuidv7(), tenantId, ...actorValues, firstIngestedAt: ingestedAt, updatedAt: ingestedAt })).id;
        // Compared with this run's own stamp, not with the row read before the lock: a concurrent
        // ingest that committed in between would otherwise read as this run's change.
        const attributesChanged = restated?.updatedAt.getTime() === ingestedAt.getTime();

        const claimsChanged = await atomicRepo.replaceAnalysisChildren(analysisId, {
          aliases: aliases.map((alias) => ({ id: uuidv7(), analysisId, alias })),
          secondaryMotivations: secondaryMotivations.map((value) => ({ id: uuidv7(), analysisId, value })),
          goals: goals.map((value) => ({ id: uuidv7(), analysisId, value })),
          threatActorTypes: threatActorTypes.map((value) => ({ id: uuidv7(), analysisId, value })),
          roles: roles.map((value) => ({ id: uuidv7(), analysisId, value })),
          attributions: entry.attributions.map((a) => ({ id: uuidv7(), analysisId, ...a })),
          locations: entry.locations.map((l) => ({ id: uuidv7(), analysisId, ...l })),
          sectors: entry.sectors.map((s) => ({ id: uuidv7(), analysisId, ...s })),
          cves: entry.cves.map((c) => ({ id: uuidv7(), analysisId, ...c })),
          techniques: entry.techniques.map((t) => ({ id: uuidv7(), analysisId, ...t })),
        });

        const probabilityRows = OUTCOME_COUNTER_OUTCOMES.flatMap((catalogId, index) => {
          const attackOutcomeId = rowIdByCatalogId.get(catalogId);
          if (attackOutcomeId === undefined) {
            return [];
          }
          const judgedProbability = judged?.probabilities.get(catalogId);
          return [{ attackOutcomeId, probability: judgedProbability ?? counterProbabilities[index], judged: judgedProbability !== undefined }];
        });
        // A child's own evidence reads its parent's flag, so a flip rescores it however little the percentages moved.
        const evidenceFlipped = existing !== undefined && existing.outcomeEvidenceSufficient !== actorValues.outcomeEvidenceSufficient;
        const largestMove = await atomicRepo.replaceOutcomeProbabilitiesForAnalysis(tenantId, analysisId, probabilityRows);
        const probabilitiesWritten = largestMove > 0;

        // `updated_at` is the watermark of everything the actor claims and of its stored percentages,
        // not only of its own attributes: the recomputes fold a claim or a percentage they have not
        // seen move it.
        if (existing && (claimsChanged || probabilitiesWritten) && !attributesChanged) {
          await atomicRepo.updateAnalysis(analysisId, { updatedAt: ingestedAt });
        }

        return {
          isNewAnalysis: existing === undefined,
          changed: existing === undefined || attributesChanged || claimsChanged || probabilitiesWritten,
          wroteClaims: existing === undefined || claimsChanged,
          probabilityRowsWritten: probabilitiesWritten ? probabilityRows.length : 0,
          probabilitiesMoved: largestMove > CHILD_RESCORE_THRESHOLD || evidenceFlipped,
        };
      });

      if (outcome === null) {
        skipped += 1;
        continue;
      }
      if (outcome.isNewAnalysis) {
        created += 1;
      } else if (outcome.changed) {
        updated += 1;
      } else {
        unchanged += 1;
      }
      if (outcome.probabilitiesMoved) {
        onProbabilitiesChanged?.(entry.threat.stixId);
      }
      if (outcome.wroteClaims) {
        claimRows += 1 + entry.cves.length + entry.techniques.length;
      }
      claimRows += outcome.probabilityRowsWritten;
    }

    if (claimRows >= ANALYZE_AFTER_CLAIM_ROWS) {
      await repo.analyzeClaimTablesAfterIngestion();
    }

    return { created, updated, unchanged, skipped };
  },

  /**
   * Withdraws actors of one kind that disappeared upstream: the actor row goes, its claims, aliases,
   * activity anchors and stored outcome probabilities cascading with it, so a deletion upstream never
   * silently keeps a claim alive.
   *
   * Only the named kind is ever removed: a `connector` tombstone leaves an actor an uploaded bundle
   * wrote under the same STIX id alone.
   */
  retractActors: async (
    { atomic }, tenantId: string, sourceKind: ThreatSourceKind, stixIds: Array<string>,
  ): Promise<{ retracted: number }> =>
    atomic(async ({ repo: tx }) => {
      const deleted = await tx.deleteAnalysesByStixIds(tenantId, sourceKind, stixIds);
      return { retracted: deleted.length };
    }),

  /** A connector's threat is left alone whatever id is passed: its feed would bring it back. */
  deleteImported: async ({ atomic }, ids: Array<string>): Promise<{ deleted: number }> =>
    atomic(async ({ repo: tx }) => {
      const deleted = await tx.deleteAnalysesByIds('stix-import', ids);
      return { deleted: deleted.length };
    }),

  /**
   * Pins the actor class by hand, or clears the pin back to the derived class with null. The
   * override lives in its own column, which ingestion never writes: it survives every resync.
   */
  // eslint-disable-next-line app/no-unused-service-method -- no router caller yet; the actor detail surface is its first reader
  setActorClassOverride: async ({ repo }, analysisId: string, actorClass: ActorClass | null) =>
    repo.updateAnalysis(analysisId, { actorClassOverride: actorClass, updatedAt: new Date() }),

  /**
   * Returns one page of the threat-center list, including either the winning outcome per row or
   * the selected outcome's score when `outcomeId` is provided.
   */
  list: async ({ repo }, params: {
    page: number,
    limit: number,
    sortBy?: ThreatListSortKey,
    sortDesc: boolean,
    outcomeId?: string,
    search?: string,
    entityType?: ThreatEntityType,
    kind?: ThreatSourceKind,
  }) => {
    const { outcomeId, search, entityType, kind } = params;
    // Outcome match is the whole point of the outcome-filtered view, and the most useful landing
    // sort otherwise — a product call, not a technical one.
    const sortBy = params.sortBy ?? 'outcomeScore';

    const offset = (params.page - 1) * params.limit;
    // Under an outcome filter, `findScoredAnalysesPage` inner-joins the score rows: a
    // not-yet-projected analysis can never appear there, projected or not, so it is not "pending"
    // for this view the way it is for the unfiltered list.
    const [rows, total, pending] = await Promise.all([
      repo.findScoredAnalysesPage({ outcomeId, search, entityType, kind, sortBy, sortDesc: params.sortDesc, limit: params.limit, offset }),
      repo.countScoredAnalyses({ outcomeId, search, entityType, kind }),
      outcomeId ? Promise.resolve(0) : repo.countPendingAnalyses({ search, entityType, kind }),
    ]);

    return { items: spreadActivity(rows), total, page: params.page, limit: params.limit, pending };
  },

  hasAny: async ({ repo }) => repo.hasAnyAnalysis(),

  /** The tenant's whole ingested catalog: no scope narrows it, and no confidence gate either. */
  getCatalogVolumes: async ({ repo }) => {
    const [byType, citedCves] = await Promise.all([catalogByType(repo), repo.countCitedCves()]);
    return { ...byType, citedCves };
  },

  /** Unlike `getCatalogVolumes`, the CVEs pass the confidence gate, as the list's CVE column counts them. */
  getCatalogKpis: async ({ repo, deps }) => {
    const { confidenceGate: gate } = await deps.threatRelevanceSettings.getThreatRelevanceSettings();
    const [byType, exposure] = await Promise.all([
      catalogByType(repo),
      repo.countCatalogExposure({ strongScore: STRONG_OUTCOME_MATCH_SCORE, gate }),
    ]);
    return { ...byType, ...exposure };
  },

  /**
   * The analyses scored under no model or under a model other than `OUTCOME_COUNTER_VERSION`, default
   * threats left out. Ingestion keeps a freshly-touched analysis current; this is what finds the rest,
   * since a new model changes the judgment and not any ingested data. The counter's inputs are not
   * stored here (malware, reports and labels live in their sources), so an analysis can only be
   * rescored by ingesting its source again: the caller sends it back there. A default threat's source
   * is the Default Threats file, which its sync reloads whole on the first run under a new app or outcome model version, so
   * that sync already rescores it.
   */
  getStaleOutcomeAnalyses: async ({ repo, eventOrigin }): Promise<Array<{ id: string, stixId: string }>> => {
    if (eventOrigin.type !== 'job') {
      throw newError('Stale outcome analyses are read by the counter recompute job alone', { origin: eventOrigin.type });
    }
    const watermarks = await repo.findOutcomeModelWatermarks();
    return watermarks
      .filter((watermark) => watermark.outcomeModelVersion !== OUTCOME_COUNTER_VERSION)
      .map(({ id, stixId }) => ({ id, stixId }));
  },

  /** The counter version this tenant's stale analyses were last all sent back under, if any. */
  getDispatchedOutcomeCounterVersion: async ({ repo }): Promise<string | null> => repo.findDispatchedOutcomeCounterVersion(),

  recordDispatchedOutcomeCounterVersion: async ({ repo, eventOrigin }, version: string): Promise<void> => {
    if (eventOrigin.type !== 'job') {
      throw newError('The dispatched outcome counter version is written by the counter recompute job alone', { origin: eventOrigin.type });
    }
    await repo.upsertDispatchedOutcomeCounterVersion(eventOrigin.tenantId, version);
  },

  /**
   * The only writer of the two tables the threat-center list reads its derived values from,
   * `threat_outcome_scores` and `threat_analysis_counts`.
   *
   * Walks the analyses whose fold is stale and those alone. What the fold reads — the stored outcome
   * percentages, the claim tables behind the counts, the confidence gate — has no single watermark,
   * so the counts row carries a stamp of each instead, and `findStaleAnalysisIdBatch` selects on all
   * of them at once. A gate move differs for every row and sweeps the tenant whole; an
   * ingestion, which rewrites an analysis's percentages and its `updated_at` together, differs for
   * the actors it touched and sweeps those.
   *
   * No scope to pick, unlike the `recomputeActivity` next door: that one folds a wider set than it
   * rebuilds and decays with the day, so it has to choose. This has one fold and no clock, which
   * leaves the predicate selecting the stale rows as the whole of the scope.
   *
   * One transaction for the whole walk, or a reader pages over an ordering half of which is the
   * previous run's. Every statement is issued on an empty batch too: a job replaces its own observed
   * read set on every run, so a quiet pass that skipped these reads would drop them from the
   * subscription and never wake on the next ingestion — the same reason an empty tenant runs them
   * all here, and why a run with nothing stale still costs one pass of empty statements.
   */
  recomputeListProjections: async ({ atomic, deps, eventOrigin }): Promise<{ scored: number, counted: number }> => {
    if (eventOrigin.type !== 'job') {
      throw newError('Threat list projections are recomputed by their job alone', { origin: eventOrigin.type });
    }
    const { tenantId } = eventOrigin;
    const { confidenceGate: gate } = await deps.threatRelevanceSettings.getThreatRelevanceSettings();
    let scored = 0;
    let counted = 0;
    await atomic(async ({ repo: tx }) => {
      // Fixed for the whole walk, not re-read per batch: the outcome catalogue does not change
      // while the sweep is in flight, and every batch needs the full set to name its outcomes.
      const attackOutcomes = await tx.findAttackOutcomeNames();
      const outcomeNameById = new Map(attackOutcomes.map((outcome) => [outcome.id, outcome.name]));
      const catalogueFingerprint = await tx.findCatalogueFingerprint();
      let afterAnalysisId: string | null = null;
      for (;;) {
        const stale = await tx.findStaleAnalysisIdBatch({
          afterAnalysisId,
          limit: LIST_PROJECTION_BATCH_SIZE,
          gate,
          projectionVersion: LIST_PROJECTION_VERSION,
          catalogueFingerprint,
        });
        const analysisIds = stale.map((row) => row.id);
        // Sequential, not `Promise.all`: every statement shares the transaction's one connection.
        const probabilities = await tx.findSufficientOutcomeProbabilities(analysisIds);
        // Read before either upsert, and both write only what it answered for. It is driven from
        // the analyses themselves, so it is the batch's surviving set: the transaction is `read
        // committed` and the staleness scan takes no row lock, so a `retractActors` committing
        // mid-batch would otherwise have the score upsert insert a row whose parent is gone. This
        // narrows that window to the writes below rather than closing it — an actor retracted
        // inside it still fails the run on the foreign key, and the next run redoes it.
        const counts = await tx.findComputedAnalysisCounts({ gate, analysisIds });
        const countsByAnalysisId = new Map(counts.map((row) => [row.analysisId, row]));
        const projected = projectOutcomeScoreRows(probabilities, outcomeNameById, tenantId)
          .filter((row) => countsByAnalysisId.has(row.analysisId));
        await tx.upsertOutcomeScoreBatch(projected);
        await tx.deleteOutcomeScoresOutsideBatch({
          analysisIds,
          keptAnalysisIds: projected.map((row) => row.analysisId),
          keptAttackOutcomeIds: projected.map((row) => row.attackOutcomeId),
        });

        await tx.upsertAnalysisCountBatch(stale.flatMap((row) => {
          const computed = countsByAnalysisId.get(row.id);
          return computed === undefined ? [] : [{
            ...computed,
            tenantId,
            sourceUpdatedAt: row.sourceUpdatedAt,
            confidenceGate: gate,
            projectionVersion: LIST_PROJECTION_VERSION,
            catalogueFingerprint,
          }];
        }));

        scored += projected.length;
        counted += counts.length;
        if (stale.length < LIST_PROJECTION_BATCH_SIZE) {
          break;
        }
        afterAnalysisId = analysisIds[analysisIds.length - 1] ?? null;
      }
    });
    return { scored, counted };
  },

  getAnalysesTargetingCves: async ({ repo, deps }, cveIds: Array<string>) => {
    const { confidenceGate: gate } = await deps.threatRelevanceSettings.getThreatRelevanceSettings();
    return repo.findAnalysesTargetingCves({ cveIds, gate });
  },

  /**
   * The flaws cited by the threats the tenant currently reads as active. Flaw ids come back
   * upper-cased and trimmed, which is how the citation tables store them inconsistently and how
   * every comparison against them is written.
   *
   * The counts are per distinct analysis, so a group citing one flaw twice counts once. The score
   * reads the list and only a surface naming how many groups are at it reads the counts.
   */
  getActiveCitations: async ({ repo, deps }) => {
    const { confidenceGate: gate } = await deps.threatRelevanceSettings.getThreatRelevanceSettings();
    const [activeIds, citations] = await Promise.all([repo.findActiveAnalysisIds({ activeSince: activeSince(new Date()) }), repo.findOngoingCveCitations({ gate })]);
    const active = new Set(activeIds);

    const analysesByCveId = new Map<string, Set<string>>();
    for (const row of citations) {
      if (active.has(row.analysisId)) {
        const cveId = row.cveId.trim().toUpperCase();
        analysesByCveId.set(cveId, (analysesByCveId.get(cveId) ?? new Set()).add(row.analysisId));
      }
    }

    return {
      cveIds: [...analysesByCveId.keys()],
      analysisCountByCveId: Object.fromEntries([...analysesByCveId].map(([cveId, analyses]) => [cveId, analyses.size])),
    };
  },

  getByStixIds: async ({ repo }, stixIds: Array<string>) => repo.findByStixIds(stixIds),

  getByCveId: async ({ repo, deps }, cveId: string) => {
    const { confidenceGate: gate } = await deps.threatRelevanceSettings.getThreatRelevanceSettings();
    return spreadActivity(await repo.findAnalysesByCveId({ cveId, gate }));
  },

  // Turns each threat's CVE-targeting window into "applicable"/"inactive" activity
  // events — same event shape as the asset evidence activity heatmap, so the frontend can reuse
  // the same generic heatmap component for the CVE detail page's Threats section.
  // Real STIX `targets` relationships (OpenCTI exports) rarely carry a `start_time` — falls back
  // to `relCreated` so the heatmap isn't empty for the common case. Windows with neither are
  //  skipped — there's no day left to anchor them to.
  getActivityForCve: async ({ repo, deps }, cveId: string) => {
    const { confidenceGate: gate } = await deps.threatRelevanceSettings.getThreatRelevanceSettings();
    const windows = await repo.findCveTargetingWindowsByCveId({ cveId, gate });
    const events: Array<{ analysisId: string, state: 'applicable' | 'inactive', stateChangedAt: Date }> = [];
    const now = new Date();
    for (const window of windows) {
      const startedAt = window.relStartTime ?? window.relCreated;
      if (!startedAt) {
        continue;
      }
      events.push({ analysisId: window.analysisId, state: 'applicable', stateChangedAt: notAfter(startedAt, now) });
      // A window the source closes in the future is still open today.
      if (window.relStopTime && window.relStopTime <= now) {
        events.push({ analysisId: window.analysisId, state: 'inactive', stateChangedAt: window.relStopTime });
      }
    }
    return events.sort((a, b) => a.stateChangedAt.getTime() - b.stateChangedAt.getTime());
  },

  /** The CVEs `getDetail` lists, without the rest of the detail. */
  getCves: async ({ repo, deps }, id: string) => {
    const { confidenceGate: gate } = await deps.threatRelevanceSettings.getThreatRelevanceSettings();
    const claims = await repo.findAnalysisCves({ id, gate });
    if (claims === undefined) {
      return undefined;
    }
    return linkableClaims(collapseClaimsByTarget(claims.cves, (c) => c.cveId), claims.kind);
  },

  /** The catalogue ids of the techniques {@link getDetail} matches for the analysis, each once. */
  getMatchedTechniqueIds: async ({ repo, deps }, id: string): Promise<Array<string>> => {
    const { confidenceGate: gate } = await deps.threatRelevanceSettings.getThreatRelevanceSettings();
    return repo.findMatchedTechniqueIds({ id, gate });
  },

  getDetail: async ({ repo, deps }, id: string) => {
    const { confidenceGate: gate, unknownActivityAgeDays } = await deps.threatRelevanceSettings.getThreatRelevanceSettings();
    const fullDetail = await repo.findAnalysisDetail({ id, gate });
    if (!fullDetail) {
      return undefined;
    }
    // Reshaped into `declaredIntent` below and never returned as-is.
    const {
      secondaryMotivations: rawSecondaryMotivations,
      goals: rawGoals,
      lastObservedVia,
      ...detail
    } = fullDetail;

    const mitreTechniqueIds = detail.techniques
      .map((t) => t.mitreTechniqueId)
      .filter((techniqueId): techniqueId is string => techniqueId !== null);
    const [tactics, attributions] = await Promise.all([
      repo.findTacticsForTechniques(mitreTechniqueIds),
      repo.findAttributionsForAnalysis({
        tenantId: detail.analysis.tenantId,
        analysisId: detail.analysis.id,
        stixId: detail.analysis.stixId,
        gate,
      }),
    ]);

    const tacticsByTechniqueId = new Map<string, Array<{ id: string, externalId: string, name: string }>>();
    for (const row of tactics) {
      const arr = tacticsByTechniqueId.get(row.techniqueId) ?? [];
      arr.push({ id: row.tacticId, externalId: row.externalId, name: row.name });
      tacticsByTechniqueId.set(row.techniqueId, arr);
    }

    const activity = {
      ...assessmentFromActivityColumns(detail.analysis),
      lastObservedAt: detail.analysis.lastObservedAt,
      activityWeight: activityWeightFor(detail.analysis, unknownActivityAgeDays),
      unknownActivityAgeDays,
      lastObservedVia,
    };

    const declaredIntent = {
      primaryMotivations: detail.analysis.primaryMotivation === null ? [] : [{ value: detail.analysis.primaryMotivation }],
      secondaryMotivations: rawSecondaryMotivations.map(({ value }) => ({ value })),
      goals: rawGoals.map(({ value }) => ({ value })),
    };

    // Every id the actor cited for a technique it plays, so the row merging a revoked citation with
    // its successor names them all rather than only the claim it kept.
    const citedByPlayed = new Map<string, Set<string>>();
    for (const technique of detail.techniques) {
      const cited = citedByPlayed.get(technique.mitreExternalId) ?? new Set<string>();
      cited.add(technique.citedExternalId);
      citedByPlayed.set(technique.mitreExternalId, cited);
    }

    const now = new Date();
    return {
      ...detail,
      analysis: {
        ...detail.analysis,
        firstSeen: notAfter(detail.analysis.firstSeen, now),
        lastSeen: notAfter(detail.analysis.lastSeen, now),
      },
      origin: {
        kind: detail.analysis.kind,
        stixId: detail.analysis.stixId,
        firstIngestedAt: detail.analysis.firstIngestedAt,
        lastIngestedAt: detail.analysis.lastIngestedAt,
      },
      activity,
      declaredIntent,
      // Two relationships between the same pair of threats name one attribution.
      attributedTo: uniqueById(attributions.attributedTo),
      attributedFrom: uniqueById(attributions.attributedFrom),
      // `matchesOrganization` comes back as `unknown` from the raw SQL `exists(...)` expressions in
      // the repository: coerce to a proper boolean here.
      //
      // The location key is namespaced by branch: a row carrying a country is keyed on that country
      // (which is also the column the `countries` join resolves on, so every row sharing the key
      // resolves identically and the recency pick cannot change the resolution), a country-less row
      // is keyed on its own name. Without the prefix the two namespaces collide on the location
      // names that are also country names, and a city "Singapore" with the fresher anchor would
      // swallow the country "Singapore" and show it as unrecognized.
      locations: linkableClaims(collapseClaimsByTarget(detail.locations, (l) => (l.country === null
        ? `name:${l.name.toLowerCase()}`
        : `country:${l.country.toLowerCase()}`)), detail.analysis.kind)
        .map((l) => ({ ...l, matchesOrganization: Boolean(l.matchesOrganization) })),
      // Sectors need no such prefix: their key IS their join column.
      sectors: linkableClaims(collapseClaimsByTarget(detail.sectors, (s) => s.name.toLowerCase()), detail.analysis.kind)
        .map((s) => ({ ...s, matchesOrganization: Boolean(s.matchesOrganization) })),
      cves: linkableClaims(collapseClaimsByTarget(detail.cves, (c) => c.cveId), detail.analysis.kind),
      // Keyed on the played id, so a revoked citation and its successor's own citation are one row.
      techniques: linkableClaims(collapseClaimsByTarget(detail.techniques, (t) => t.mitreExternalId), detail.analysis.kind).map(({ citedExternalId: _citedByKeptClaim, ...t }) => ({
        ...t,
        citedExternalIds: [...citedByPlayed.get(t.mitreExternalId) ?? []].sort(),
        tactics: t.mitreTechniqueId ? (tacticsByTechniqueId.get(t.mitreTechniqueId) ?? []) : [],
      })),
    };
  },

  /** One mixture evidence map per targeting profile, in input order. */
  getAttackerMixtureEvidenceByProfile: async ({ repo, deps }, params: {
    attackOutcomeIds: Array<string>,
    profiles: Array<TargetingProfile>,
    tenantId?: string,
  }): Promise<Array<Map<string, MixtureEvidence>>> => {
    const { confidenceGate: gate } = await deps.threatRelevanceSettings.getThreatRelevanceSettings(params.tenantId);
    return readMixtureEvidence(repo, gate, params);
  },

  /**
   * The threats `getRelevantForScenario` would list for each (targeting profile, attack outcome)
   * pair, one map per profile in input order, without its per-row display payload. Every read the
   * profiles have in common is issued once for the whole call.
   */
  getAdmittedThreatsByProfile: async ({ repo, deps }, params: {
    attackOutcomeIds: Array<string>,
    profiles: Array<TargetingProfile>,
  }): Promise<Array<Map<string, Array<AdmittedThreat>>>> => {
    const { confidenceGate: gate } = await deps.threatRelevanceSettings.getThreatRelevanceSettings();
    const { byOutcomeId, targetingByProfile } = await selectThreats(repo, gate, params);

    return targetingByProfile.map((targeting) => new Map(params.attackOutcomeIds.map((attackOutcomeId) => [
      attackOutcomeId,
      (byOutcomeId.get(attackOutcomeId) ?? []).map(({ threat, weight }) => {
        const { activityScore } = assessmentFromActivityColumns(threat);
        return {
          id: threat.id,
          name: threat.name,
          entityType: threat.entityType,
          activityScore,
          lastObservedAt: threat.lastObservedAt,
          combinedRelevance: computeRelevance({ weight, ...(targeting.get(threat.id) ?? NO_TARGETING) }),
        };
      }),
    ])));
  },

  getRelevantForScenario: async ({ repo, deps }, params: {
    attackOutcomeId: string,
    countryIds: Array<string>,
    sectorIds: Array<string>,
    // The organization's own country/sector name, used only for the "matched entry" highlight
    // below — the selection itself comes from the stored outcome percentages.
    organizationCountryName?: string | null,
    organizationSectorName?: string | null,
    analysisIds?: Array<string>,
  }) => {
    const { confidenceGate: gate, unknownActivityAgeDays } = await deps.threatRelevanceSettings.getThreatRelevanceSettings();
    const selected = await repo.findSelectedThreats({ attackOutcomeIds: [params.attackOutcomeId], analysisIds: params.analysisIds });
    if (selected.length === 0) {
      return { items: [] };
    }
    const weightByAnalysisId = new Map(selected.map((threat) => [
      threat.id,
      effectiveOutcomeWeight({ probability: threat.probability, evidenceSufficient: true }),
    ]));
    const rows = await repo.findRelevantForScenario({
      countryIds: params.countryIds,
      sectorIds: params.sectorIds,
      gate,
      analysisIds: [...weightByAnalysisId.keys()],
    });

    // Case-insensitive match against the organization's own country/sector name — locations
    // and sectors targeted by the threat are raw STIX names, matched elsewhere via ilike.
    const findMatch = (names: Array<string>, target: string | null): string | null =>
      (target ? names.find((name) => name.toLowerCase() === target.toLowerCase()) ?? null : null);

    const items = rows.map((row) => {
      const matchedCountry = findMatch(row.countries, params.organizationCountryName ?? null);
      const matchedSector = findMatch(row.sectors, params.organizationSectorName ?? null);
      // countryMatch/sectorMatch come back as `unknown` from the raw SQL `exists` expressions in
      // the repository — coerce them to proper booleans here.
      const countryMatch = Boolean(row.countryMatch);
      const sectorMatch = Boolean(row.sectorMatch);

      return {
        ...row,
        ...assessmentFromActivityColumns(row),
        activityWeight: activityWeightFor(row, unknownActivityAgeDays),
        countryMatch,
        sectorMatch,
        combinedRelevance: computeRelevance({ weight: weightByAnalysisId.get(row.id) ?? 0, countryMatch, sectorMatch }),
        // Matched entry first so it's the most prominent one in the list.
        countries: matchedCountry ? [matchedCountry, ...row.countries.filter((c) => c !== matchedCountry)] : row.countries,
        sectors: matchedSector ? [matchedSector, ...row.sectors.filter((s) => s !== matchedSector)] : row.sectors,
        matchedCountry,
        matchedSector,
      };
    }).sort(compareRelevantThreats);

    return { items };
  },

  /**
   * Every claim behind one actor's relevance, for the proof panel. Read on demand, one actor at a
   * time, and never persisted or cached, so a gate change applies on the next read.
   *
   * Null when the analysis is not one of the caller's: the secured views filter a foreign or
   * deleted identifier out rather than erroring, and returning the zero proof that falls out of
   * that would assert an actor exists with no evidence behind it.
   *
   * `countryIds`/`sectorIds` describe the organization the reader arrived from. A caller that has
   * no organization — the surfaces arguing an outcome score alone — passes neither, and gets the
   * outcome's stored percentage with no combined relevance to blend it into.
   */
  getRelevanceProof: async ({ repo, deps }, params: {
    analysisId: string,
    attackOutcomeId: string,
    countryIds?: Array<string>,
    sectorIds?: Array<string>,
    countryName?: string | null,
    sectorName?: string | null,
  }) => {
    const analysis = await repo.findAnalysisOrigin(params.analysisId);
    if (!analysis) {
      return null;
    }
    const { confidenceGate: gate } = await deps.threatRelevanceSettings.getThreatRelevanceSettings();
    const countryIds = params.countryIds ?? [];
    const sectorIds = params.sectorIds ?? [];

    const [claims, probabilityRows, attackOutcomeTenantRows] = await Promise.all([
      repo.findRelevanceProofClaims({ analysisId: params.analysisId, countryIds, sectorIds, gate }),
      repo.findSufficientOutcomeProbabilities([params.analysisId]),
      repo.findAttackOutcomesByIds([params.attackOutcomeId]),
    ]);
    const outcomeRow = probabilityRows.find((row) => row.attackOutcomeId === params.attackOutcomeId);
    const probability = outcomeRow?.probability ?? null;
    const evidenceSufficient = analysis.outcomeEvidenceSufficient;
    // The judgment date covers only the outcomes the judgment stated: the counter fills the others.
    const judgedOn = outcomeRow?.judged === true ? calendarDate(analysis.outcomeJudgedAt) : null;

    // A relationship is only linkable to OpenCTI when the actor came through the connector (see
    // `getDetail`'s identical rule): a relationship's standard id folds in `start_time`/`stop_time`,
    // so a foreign producer's id resolves nowhere but its own platform.
    const isConnectorActor = analysis.kind === 'connector';
    const withOpenCtiRelationId = <T extends { stixRelationId: string }>(
      row: T,
    ): T & { openctiStixRelationId: string | null } => ({
      ...row,
      openctiStixRelationId: isConnectorActor ? row.stixRelationId : null,
    });
    const locationClaims = claims.locations.map(withOpenCtiRelationId);
    const sectorClaims = claims.sectors.map(withOpenCtiRelationId);

    // The claim reads are already narrowed to the organization's own countries and sectors, so a
    // returned claim is a match — the same predicate `targetingCountryMatch` expresses as EXISTS.
    const hasOrganizationProfile = countryIds.length > 0 || sectorIds.length > 0;
    const relevance = hasOrganizationProfile
      ? explainRelevance({
        probability,
        evidenceSufficient,
        countryMatch: locationClaims.length > 0,
        sectorMatch: sectorClaims.length > 0,
        countryClaims: locationClaims,
        sectorClaims,
        countryName: params.countryName,
        sectorName: params.sectorName,
      })
      : null;

    return {
      gate,
      // The value an unstated confidence is read at, which is what the gate compares. It travels
      // with the proof so no surface has to restate the engine's own constant to explain it.
      unstatedConfidence: DEFAULT_RELATION_CONFIDENCE,
      attackOutcomeName: attackOutcomeTenantRows.find((row) => row.id === params.attackOutcomeId)?.name ?? null,
      // A threat's standard id is derived from its name alone, so it is the one id portable
      // across OpenCTI platforms. The kind travels with it because only a connector origin
      // guarantees the id resolves.
      origin: { stixId: analysis.stixId, kind: analysis.kind, entityType: analysis.entityType },
      outcome: { probability, evidenceSufficient, modelVersion: analysis.outcomeModelVersion, judgedOn },
      relevance,
    };
  },

  /**
   * What was stored for one threat, the counter's or judged: a percentage per outcome of the tenant, 0
   * for an outcome none was stored for, and null on every outcome of a threat without minimum evidence,
   * which weighs nothing. `judgedOn` dates the judgment set on the rows a judgment gave, as the relevance
   * proof does: a partial judgment leaves the others to the counter.
   */
  getOutcomeScoresForAnalysis: async ({ repo }, analysisId: string) => {
    const [outcomes, analysis, probabilityRows] = await Promise.all([
      repo.findAttackOutcomeNames(),
      repo.findAnalysisOrigin(analysisId),
      repo.findSufficientOutcomeProbabilities([analysisId]),
    ]);
    const probabilityByOutcomeId = new Map(probabilityRows.map((row) => [row.attackOutcomeId, row.probability]));
    const judgedOutcomeIds = new Set(probabilityRows.filter((row) => row.judged).map((row) => row.attackOutcomeId));
    const evidenceSufficient = analysis?.outcomeEvidenceSufficient ?? false;

    return outcomes.map((outcome) => ({
      attackOutcomeId: outcome.id,
      outcomeName: outcome.name,
      score: evidenceSufficient ? probabilityByOutcomeId.get(outcome.id) ?? 0 : null,
      evidenceSufficient,
      judgedOn: evidenceSufficient && judgedOutcomeIds.has(outcome.id) ? calendarDate(analysis?.outcomeJudgedAt) : null,
    })).sort((a, b) => ((b.score ?? 0) - (a.score ?? 0)) || a.outcomeName.localeCompare(b.outcomeName));
  },

  /**
   * Everything the attack outcome overview's "Threat in the wild" card needs: every threat leading
   * to the outcome (`findSelectedThreats`), ranked by its stored percentage, but bounded before it
   * leaves the service — `distributions` are computed here over the whole matching set (never sent
   * raw to the client) and `topActors` caps the table at `TOP_MATCHING_ACTORS_LIMIT`, mirroring
   * `dashboard.getTopControls`'s own slice.
   *
   * The mirror of `getOutcomeScoresForAnalysis` on the other axis: one outcome against every
   * analysis, rather than one analysis against every outcome. It has no organization to compare
   * against, so targeting plays no part.
   */
  getMatchingActorsForOutcome: async ({ repo, deps }, attackOutcomeId: string) => {
    const { confidenceGate: gate } = await deps.threatRelevanceSettings.getThreatRelevanceSettings();
    const selected = await repo.findSelectedThreats({ attackOutcomeIds: [attackOutcomeId] });

    const matchingActors = selected
      .map((threat) => ({
        analysisId: threat.id,
        analysisName: threat.name,
        entityType: threat.entityType,
        resourceLevel: threat.resourceLevel,
        primaryMotivation: threat.primaryMotivation,
        score: threat.probability,
      }))
      .sort((a, b) => (b.score - a.score) || a.analysisName.localeCompare(b.analysisName) || a.analysisId.localeCompare(b.analysisId));

    return {
      gate,
      matchingCount: matchingActors.length,
      distributions: {
        resourceLevel: bucketDistribution(matchingActors.map((actor) => actor.resourceLevel)),
        primaryMotivation: bucketDistribution(matchingActors.map((actor) => actor.primaryMotivation)),
      },
      topActors: matchingActors.slice(0, TOP_MATCHING_ACTORS_LIMIT).map((actor) => ({
        analysisId: actor.analysisId,
        analysisName: actor.analysisName,
        entityType: actor.entityType,
        score: actor.score,
      })),
    };
  },
});
