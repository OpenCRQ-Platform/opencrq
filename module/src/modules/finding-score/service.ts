import { newError } from '@app/utils';
import { uuidv7 } from 'uuidv7';
import type { CapabilityFunction, CoverageBucket, StrengthRung } from '../controls/capability/constants';
import type { AssetCategory, AssetCriticality, DismissalType, ExpectationType } from '../supporting-assets/constants';
import type { EvidenceHistoryOrigin, EvidenceState, SupportingAssetExposure } from '../supporting-assets/schema';
import type { ExposureCounts } from '../crq-indicators/engine/asset-relevance';
import type { MappingRole } from '../technique-mapping/data/curated-technique-mappings';
import type {
  AttackGroup,
  MappingConfidence,
  TechniqueClaimLane,
  TechniqueGrain,
  TechniqueResolutionState,
} from '../technique-mapping/constants';
import type { AttackClaim, ClaimJustification } from '../technique-mapping/attack-claims';
import type { EventOrigin, ExtractPublicFromDef, InferRepository } from '../../registry';
import type { EvidenceScope, FindingSortKey, ListedFindingsFilter, UniqueFindingListOptions, UniqueFindingScope, UniqueFindingSortKey } from './repository';
import type { FindingScore, FindingScorePolicy, TechniqueInReach } from './engine';
import type { SeverityBand } from './bands';
import type { VulnerabilityFilter } from './vulnerability-filter';
import type { AssetPosture, AssetPostureHistoryLine } from './asset-posture';
import type { UniqueScoreComposition } from './unique-score-composition';
import type { UniqueFindingEvent } from './unique-finding-events';
import type { UniqueFindingsPanelCounts } from './unique-findings-panel';
import type { FindingScoreHistoryLine } from './score-journal';
import type { UniqueAttack, UniqueAttackInput } from './unique-attack';
import type { OpenFindingFigures, TechniqueTestPosture } from './estate-figures';
import type { CapabilityStateInput, ResistanceEdgeIndex, ScenarioNodeInput, SusceptibilityOptions, TechniqueResistanceTerms } from '../controls/capability/susceptibility-engine';
import type { CvssTerms } from '../cve/cvss-vector';
import type { EntryAsset } from '../attack-surfaces/entry-applicability';
import type { EntryOpeningKey, EntryOpeningRow, HeldOpening, HeldOpenings, SusceptibilityCell, TechniqueScoreCellKey, TechniqueScoreSource } from './technique-scores';
import { defineService } from '../../registry';
import { requireTenantId } from '../../security';
import { impactTechniquesOf, readAttackClaims, techniquesInReachOf } from '../technique-mapping/attack-claims';
import { UNCLASSIFIED_ASSET_CATEGORY } from '../supporting-assets/constants';
import { MAPPING_CONFIDENCE_VALUES, MAPPING_LANE_CONFIDENCE } from '../technique-mapping/constants';
import { computeAssetRelevance } from '../crq-indicators/engine/asset-relevance';
import { buildResistanceEdgeIndex, computeTechniqueResistanceWithIndex, explainTechniqueResistance } from '../controls/capability/susceptibility-engine';
import { buildFamilyShares } from '../crq-indicators/engine/family-shares';
import { isCisaListed } from '../cve/cisa-listing';
import { entryImpact, explainCvssContributions, parseCvssContributions, readCvssMetrics } from '../cve/cvss-vector';
import { countedExposure, entryTechniqueApplies } from '../attack-surfaces/entry-applicability';
import { PHISHING_TECHNIQUE } from '../attack-surfaces/phishing';
import { attackSurfacesService } from '../attack-surfaces/service';
import { controlCapabilityService } from '../controls/capability/service';
import { crqIndicatorSettingsService } from '../crq-indicator-settings';
import { threatAnalysesService } from '../threat-analyses';
import { techniqueMappingService } from '../technique-mapping/service';
import { composeParts, computeFindingScore, exposureWeightsByExposure, partFigure, resolveLimitingTerm } from './engine';
import { computeAssetPosture, explainAssetPosture } from './asset-posture';
import { findingScoreRepository } from './repository';
import { BAND_METRIC_KEYS, utcDayOf } from './metrics';
import { posturesOwingAJournalLine, rowsOwingAJournalLine, uniqueFindingsOwingAJournalLine } from './score-journal';
import { computeUniqueScore } from './unique-score';
import { explainUniqueScore } from './unique-score-composition';
import { aggregateUniqueAttack, ASSET_EXPOSURE_VALUES } from './unique-attack';
import { explainUniqueFindingEvents } from './unique-finding-events';
import { explainPostureHistory } from './posture-cause';
import { resolveFindingTrendWindow } from './trend-window';
import { foldUniqueFindingsPanel } from './unique-findings-panel';
import { AGED_FINDING_DAYS, daysBefore, expectationTally, TECHNIQUE_POSTURE_CHANGE_DAYS } from './estate-figures';
import { resolveSeverityBand, SEVERITY_BANDS, truncateScore } from './bands';
import { mapInYieldedChunks } from './yield-chunks';
import { entryOpeningKey, findingOpenings, heldOpeningKey, holdWorstOpening, openingFigure, susceptibilityCell } from './technique-scores';
import { UNIQUE_SCORE_HISTORY_RETENTION_DAYS } from './retention';

/** Findings held in memory per round, which is what the pass costs. */
const SCORE_BATCH_SIZE = 1000;

/** Held under Postgres' bind-parameter limit at fifteen columns. */
const SCORE_UPSERT_CHUNK_SIZE = 1000;

/**
 * The longest window a finding's lifeline offers, twelve months, so a plot never opens on a trimmed day.
 *
 * Only a caller naming no retention lands here: a deployment's own value reaches the run from its
 * config, which always carries one.
 */
export const SCORE_HISTORY_RETENTION_DAYS = 365;

/** The longest window an asset's posture card offers, twelve months. */
export const POSTURE_HISTORY_RETENTION_DAYS = 365;

/**
 * How many findings are scored back to back before the loop hands the event loop back.
 *
 * `recomputeFindingScores` runs in the worker, the same process that renews job leases on a
 * `setInterval` and answers the process manager's metrics-collect IPC message. Neither can fire
 * while a synchronous scoring pass over a full batch holds the thread, so a large tenant would
 * starve its own lease renewal and drop out of every metrics scrape started meanwhile.
 */
const FINDINGS_PER_YIELD = 100;

/**
 * `computeTechniqueResistanceWithIndex` walks the whole node x function x capability grid on its
 * own, unlike the per-finding projection above where each item is cheap and only the batch as a
 * whole is expensive. `buildScoringContext` calls it once per category and again once per
 * platform/category pair, so on a tenant with many asset categories and platform types this
 * repeats a graph-sized computation dozens of times before the batch loop (and its own yields)
 * ever starts. Yielding after each run bounds uninterrupted work to one graph pass before the
 * worker can service lease-renewal timers and metrics IPC.
 */
const RESISTANCE_RUNS_PER_YIELD = 1;

const DETECTION_FUNCTIONS: ReadonlyArray<CapabilityFunction> = ['detect'];

export interface ScoredFindingPage {
  items: Array<{
    evidenceId: string,
    supportingAssetId: string,
    /** Null on a technique finding, which the score never reads, and on a CVE finding pending a vector. */
    score: number | null,
    band: SeverityBand | null,
    pendingVector: boolean,
    currentState: EvidenceState,
    stateOrigin: EvidenceHistoryOrigin | null,
    dismissalType: DismissalType | null,
    cveId: string | null,
    cveTitle: string | null,
    mitreTechniqueExternalId: string | null,
    mitreTechniqueName: string | null,
    expectationType: ExpectationType | null,
    assetName: string | null,
    assetDerivedName: string | null,
    assetCategoryId: AssetCategory,
    assetCriticality: AssetCriticality,
    assetPlatforms: Array<string>,
    assetExposure: SupportingAssetExposure,
    sources: Array<string>,
    /** Every reporting source, a deleted connector's included: zero means nobody reports it. */
    sourceCount: number,
    lastEvaluatedAt: Date | null,
    firstSeenAt: Date,
  }>,
  total: number,
  page: number,
  limit: number,
  /**
   * CVE findings with no projection row yet, which is what a fresh import looks like until the
   * recompute. Reported rather than ranked: a list ordered by score cannot place a figure nobody
   * computed. A technique finding is never one: it carries no score by design.
   */
  unscored: number,
}

export interface UniqueFindingPage {
  items: Array<{
    /** Stable across pages and requests: the CVE, or the technique and its expectation. */
    key: string,
    cveId: string | null,
    cveTitle: string | null,
    knownExploited: boolean | null,
    epss: number | null,
    mitreTechniqueExternalId: string | null,
    mitreTechniqueName: string | null,
    expectationType: ExpectationType | null,
    /** Truncated as a finding's score is. Null on a technique group, as on its findings. */
    score: number | null,
    /** The unique score's own band, which breadth can lift above the worst finding's. */
    band: SeverityBand | null,
    worstScore: number | null,
    worstBand: SeverityBand | null,
    /** A CVE group whose members are all unscored, one of them pending a vector. */
    pendingVector: boolean,
    affectedAssetCount: number,
    sources: Array<string>,
    firstSeenAt: Date,
    /** The CVE's row id, with the three gain figures below, present when the list was asked with a `gainRunId`; the figures are null on a CVE that run holds no row for. */
    cveRef?: string | null,
    gainMean?: number | null,
    gainP10?: number | null,
    gainP90?: number | null,
  }>,
  total: number,
  page: number,
  limit: number,
}

/** A CVE as one unique finding in an estate, figured as the Unique findings tab figures its row. */
export interface UniqueCveFinding {
  cveId: string,
  cveTitle: string | null,
  knownExploited: boolean,
  epss: number | null,
  /** Null with no applicable member in the estate, or none scored yet; truncated otherwise. */
  score: number | null,
  band: SeverityBand | null,
  worstScore: number | null,
  worstBand: SeverityBand | null,
  pendingVector: boolean,
  affectedAssetCount: number,
  sources: Array<string>,
  firstSeenAt: Date | null,
  /** Read from the members as they stand, which the stored score catches up with at the next run. */
  composition: UniqueScoreComposition | null,
}

export const THREAT_CVE_PRESENCES = ['present', 'computing', 'absent'] as const;

/** `computing`: applicable findings in the estate, and no unique finding stored for them yet. */
export type ThreatCvePresence = (typeof THREAT_CVE_PRESENCES)[number];

/** A CVE a threat targets, with the figures the unique findings page shows for it in the estate. */
export interface ThreatCveFinding {
  cveId: string,
  /** Null, like the catalogue facts below, on a CVE the catalogue does not list. */
  cveTitle: string | null,
  knownExploited: boolean | null,
  epss: number | null,
  presence: ThreatCvePresence,
  score: number | null,
  band: SeverityBand | null,
  worstScore: number | null,
  worstBand: SeverityBand | null,
  pendingVector: boolean,
  affectedAssetCount: number,
  sources: Array<string>,
  firstSeenAt: Date | null,
  openctiStixRelationId: string | null,
}

const PRESENCE_RANK: Record<ThreatCvePresence, number> = { present: 0, computing: 1, absent: 2 };

/** The unique findings page's score order, the CVEs it does not list after it. */
const compareThreatCveFindings = (a: ThreatCveFinding, b: ThreatCveFinding): number =>
  PRESENCE_RANK[a.presence] - PRESENCE_RANK[b.presence]
  || (b.score ?? -1) - (a.score ?? -1)
  || b.affectedAssetCount - a.affectedAssetCount
  || a.cveId.localeCompare(b.cveId);

export interface UniqueFindingEventPage {
  items: Array<UniqueFindingEvent>,
  total: number,
  page: number,
  limit: number,
}

export interface TechniqueScoreHolder {
  evidenceId: string,
  cveId: string,
  cveTitle: string | null,
  cvssVector: string,
  epss: number | null,
  knownExploited: boolean,
  /** The three terms the opening multiplies, on 0 to 1. */
  access: number,
  threat: number,
  impact: number,
}

export interface AssetTechniqueScore {
  mitreTechniqueId: string,
  externalId: string,
  name: string,
  score: number,
  /** Null for a cell no finding holds, which is a person's susceptibility. */
  evidenceId: string | null,
  source: TechniqueScoreSource,
  lane: TechniqueClaimLane | null,
  /** Present on a susceptibility cell only. */
  susceptibility?: Omit<SusceptibilityCell, 'score'>,
}

export interface AssetTechniqueScores {
  techniques: Array<AssetTechniqueScore>,
  findings: Array<TechniqueScoreHolder>,
}

export interface FindingsPanelCounts {
  windowStart: Date,
  findings: number,
  impactedAssets: number,
  newInWindow: number,
  /** How many assets the estate the tiles read holds: what each tile's figure is out of. */
  estateAssetCount: number,
  bands: Array<{ band: SeverityBand, total: number, newInWindow: number }>,
  /** Counted in `findings` and in no band. */
  pendingVector: number,
}

export interface ScoredFinding extends FindingScore {
  evidenceId: string,
  supportingAssetId: string,
  assetName: string | null,
  assetDerivedName: string | null,
  assetCriticality: AssetCriticality,
  assetExposure: SupportingAssetExposure,
  assetCategoryId: AssetCategory,
  assetLastSeenAt: Date | null,
  assetOwnerName: string | null,
  /** The tenant's `cve` row the finding points at, which is what the technique mapping is keyed on. */
  cveRowId: string | null,
  cveId: string | null,
  cveTitle: string | null,
  /** Published exploitation probability on the flaw, as read; null when no feed answered. */
  epss: number | null,
  knownExploited: boolean,
  /** Every connector reporting the finding (CAP-4); empty when a person attached it by hand. */
  sources: Array<string>,
  /** When the connector last spoke about the finding; null on a finding no connector reported. */
  lastEvaluatedAt: Date | null,
  /** When the finding was first recorded on the asset. */
  firstSeenAt: Date,
  currentState: EvidenceState,
  /** Since when the finding has stood in its current state, without interruption. */
  currentStateSince: Date | null,
  /** The flaw's own CVSS base vector, as published; null when none was. */
  cvssVector: string | null,
  cvssV2UserInteractionRequired: boolean | null,
}

/**
 * One control the score weighs on this finding, as the mitigations column lists it.
 *
 * A control that stands on the technique without protecting the asset's family is listed with the
 * gate flagged rather than dropped, because a panel explaining a figure has to be able to say what
 * stood there and earned nothing. Read `protectsAssetFamily` and `scoredHere` before crediting a row.
 */
export interface DeclaredControl {
  capabilityId: string,
  externalId: string,
  name: string,
  strengthRung: StrengthRung,
  coverageBucket: CoverageBucket,
  /**
   * The control protects the family of the asset the finding sits on, so the score credits it.
   * Always true on an unclassified asset, where the family gate does not apply. On the impact
   * side, where controls are credited on the whole estate, it means protecting some of the estate.
   *
   * Protection is what the control defends, never where it is installed: the two questions come
   * apart, and reading this one as deployment scope narrows it back to an installation matrix.
   */
  protectsAssetFamily: boolean,
  /**
   * The control acts on a technique in reach, preventing or detecting it, and is one the engine
   * credits at all: L0 and a coverage of `L0` both give an efficacy of zero, so a control at
   * either earns nothing whatever edge it carries.
   * Such a control stands in the list earning nothing, and a panel that did not say so would show
   * a stack the figure above it never counted.
   */
  scoredHere: boolean,
  /**
   * The techniques in reach this control has an edge on, with the functions those edges carry.
   * An edge on a parent technique is listed under the child it covers, the same way the engine
   * credits it.
   */
  standsOn: Array<{ mitreTechniqueId: string, functions: Array<CapabilityFunction> }>,
  /**
   * A run of a platform implementing this control, on a technique it stands on and through a
   * function it carries, got through on this asset and nothing held. The declaration survives on
   * screen; what it promised did not.
   *
   * The platform is part of the question: a run of a product that does not implement the control
   * says nothing about it, and reading the technique's runs as a whole would strike a declaration
   * down on evidence that never exercised it.
   */
  knockedDownHere: boolean,
}

/** How many runs held out of how many ran. Never stands in for a scope where nothing ran. */
export interface TestTally {
  held: number,
  total: number,
}

/** What the platform's expectation runs observed on one technique, at both scopes. */
export interface TechniqueTestRecord {
  mitreTechniqueId: string,
  externalId: string,
  name: string | null,
  here: TechniqueTestScope,
  fleet: TechniqueTestScope & { assetCount: number },
}

export interface TechniqueTestScope {
  prevention: TestTally | null,
  detection: TestTally | null,
  lastRunAt: Date | null,
}

export interface AssetTechniqueTests {
  /** Summed over every technique the asset was tested on, including those its TTP tab does not show. */
  prevention: TestTally | null,
  detection: TestTally | null,
  techniques: Array<{ mitreTechniqueId: string, prevention: TestTally | null, detection: TestTally | null }>,
}

export interface TechniqueTestPlatform extends TestTally {
  securityPlatformType: string | null,
  lastRunAt: Date | null,
}

export interface TechniqueTestSection {
  here: TestTally | null,
  fleet: TestTally | null,
  /** One row per platform family, whose tallies add up to `here`. */
  platforms: Array<TechniqueTestPlatform>,
}

export interface AssetTechniqueTestDetail {
  prevention: TechniqueTestSection,
  detection: TechniqueTestSection,
}

/**
 * Everything the finding detail draws beside the score, one entry per column.
 *
 * It is assembled only for a single finding: the lists draw the figure and its band, and paying
 * for the control names and the run breakdown on every row of an estate would buy nothing.
 */
export interface FindingScoreColumns {
  reachability: {
    exposure: SupportingAssetExposure,
    categoryId: AssetCategory,
    assetLastSeenAt: Date | null,
    /** The access metrics as published, empty when no vector was. */
    cvssMetrics: Array<{ metric: string, value: string }>,
  },
  threat: {
    exploitationProbability: number | null,
    knownExploited: boolean,
    /** Distinct active threats citing the flaw. */
    activeThreatCount: number,
    attackComplexity: string | null,
  },
  /**
   * What the platform's expectation runs observed on the techniques in reach, on this asset.
   * Null when no technique in reach was ever run here, which the surface states in words.
   *
   * It is never fed by the finding's own verdicts: on a CVE finding they come from the
   * vulnerability scanner, and reporting them as a verdict presents a scan result as a control
   * validation.
   */
  validation: {
    techniquesTested: number,
    techniquesInReach: number,
    prevention: TestTally | null,
    detection: TestTally | null,
    lastRunAt: Date | null,
  } | null,
  /** The declared stack, split by whether the run spoke for it. Null when nothing stands in reach. */
  mitigations: Array<DeclaredControl> | null,
  /**
   * The exploitation techniques in reach that no creditable control prevents, by external id.
   *
   * They are what pins the exploitation controls: the weakest technique decides them, so a single
   * technique nothing prevents holds the panel's figure at three quarters or more, whatever stands
   * on the others. A panel listing the controls alone would show a stack under a figure that stack
   * never earned.
   */
  uncoveredTechniqueExternalIds: Array<string>,
  /**
   * The exploitation technique whose path set what the controls let through, and how far the claim
   * that the finding reaches it is believed. Null when nothing stands in reach.
   *
   * The figure is that one path and nothing else, so naming it is what lets a reader tell a
   * figure held up by a control from one held down by a claim nobody is sure of.
   */
  weakestPath: { externalId: string, confidence: MappingConfidence } | null,
  /** One entry per technique in reach, with what a run said about it here and across the estate. */
  techniqueTests: Array<TechniqueTestRecord>,
  exploitationTechniques: Array<SideTechnique>,
  /** The same reading on the impact techniques, whose controls are credited on the whole estate. */
  impactControls: {
    mitigations: Array<DeclaredControl> | null,
    weakestPath: { externalId: string, confidence: MappingConfidence } | null,
    techniques: Array<SideTechnique>,
  },
  /**
   * Null on a CVE row never resolved that the topology rule does not answer either, which is not
   * the claim the `unresolved` state makes.
   */
  techniques: {
    state: TechniqueResolutionState,
    rows: Array<{
      mitreTechniqueId: string,
      externalId: string,
      name: string,
      role: MappingRole,
      lane: TechniqueClaimLane,
      group: AttackGroup,
      justification: ClaimJustification,
      grain: TechniqueGrain,
      /**
       * Whether the family of the asset this finding sits on can carry the technique. Only an
       * exploitation row is set aside when it cannot: the score never reads it, and the screen
       * shows it apart, since it is a step of an attack that continues on another asset.
       */
      carriedByAssetFamily: boolean,
    }>,
  } | null,
  potentialImpact: {
    criticality: AssetCriticality,
    ownerName: string | null,
    /** The impact metrics as published, empty when no vector was. */
    cvssMetrics: Array<{ metric: string, value: string }>,
  },
}

/** One technique on a side of the score, with the controls the engine credits on it. */
export interface SideTechnique {
  mitreTechniqueId: string,
  externalId: string,
  name: string | null,
  group: AttackGroup | null,
  preventingCapabilityIds: Array<string>,
  detectingCapabilityIds: Array<string>,
}

/** The declared resistance of the weakest path, as the runs that produced it built it. */
export interface WeakestPathResistance {
  declared: TechniqueResistanceTerms,
  detection: TechniqueResistanceTerms,
}

export interface FindingScoreBreakdown extends ScoredFinding {
  columns: FindingScoreColumns,
  /** Assets other than this one carrying the same CVE. */
  otherImpactedAssetCount: number,
  /** The run behind each side's weakest technique, null on a side no technique stands on. */
  resistance: {
    exploitation: WeakestPathResistance | null,
    impact: WeakestPathResistance | null,
  },
  /** The weights behind the vector's contributions; null on a finding with no readable vector. */
  cvss: CvssTerms | null,
}

/** A finding the recompute has not scored yet, or left pending a vector: its evidence, and no figure a score would print. */
export interface UnscoredFindingBreakdown extends Omit<ScoredFinding, keyof FindingScore> {
  score: null,
  band: null,
  pendingVector: boolean,
  columns: FindingScoreColumns,
  otherImpactedAssetCount: number,
}

/**
 * The past the findings panel cannot fold out of the findings it already loaded.
 *
 * Only stocks and flows are here. Nothing bands last week's findings, because the declarations a
 * score rested on a week ago are gone: a severity a week old is not reconstructible, only claimable.
 */
export interface FindingBaselines {
  /**
   * The instant every figure here was replayed at, and the one a caller must fold its own live
   * counts against. Both halves of a comparison have to hang off a single boundary, and only the
   * side that ran the replay knows which one that was.
   */
  windowStart: Date,
  /** Applicable findings the tenant carried one window ago. */
  findingsStockBefore: number,
  /** Assets carrying at least one of them. */
  impactedAssetsStockBefore: number,
  /** Findings born during the window before the current one, and applicable at its end. */
  newInPreviousWindow: number,
}

const ACCESS_METRICS = ['AV', 'PR', 'Au', 'UI', 'S', 'AT'];
const IMPACT_METRICS = ['C', 'I', 'A', 'VC', 'VI', 'VA'];

type Repo = InferRepository<typeof findingScoreRepository>;

type EvidenceRows = Awaited<ReturnType<Repo['findScoredEvidence']>>;

type ScoringInputRow = Awaited<ReturnType<Repo['findScoringInputs']>>[number];

const uniqueFindingKey = (group: { cveId: string | null, mitreTechniqueId: string | null, expectationType: string | null }): string =>
  (group.cveId === null ? `technique:${group.mitreTechniqueId}:${group.expectationType}` : `cve:${group.cveId}`);

type UniqueFindingInput = Awaited<ReturnType<Repo['findUniqueFindingInputs']>>[number];

/** Stores one estate's unique findings, run inside the transaction that wrote the scores they read. */
const projectUniqueFindingScores = async (
  repo: Repo,
  inputs: ReadonlyArray<UniqueFindingInput>,
  { tenantId, organizationId, computedAt }: { tenantId: string, organizationId: string | null, computedAt: Date },
): Promise<void> => {
  const incoming = inputs.map((group) => {
    const score = computeUniqueScore(group.scores);
    return {
      id: uuidv7(),
      tenantId,
      organizationId,
      cveId: group.cveRef,
      mitreTechniqueId: group.mitreTechniqueRef,
      expectationType: group.expectationType,
      score,
      band: score === null ? null : resolveSeverityBand(truncateScore(score)),
      worstScore: group.scores.length === 0 ? null : group.scores.reduce((worst, member) => Math.max(worst, member)),
      affectedAssetCount: group.affectedAssetCount,
      firstSeenAt: group.firstSeenAt,
    };
  });
  const stored = await repo.findStoredUniqueFindingScores(organizationId);
  const storedFigures = new Map(stored.map((row) => [uniqueFindingKey(row), row] as const));
  const cveGroups = incoming.flatMap((row) => (row.cveId === null ? [] : [{ ...row, cveId: row.cveId }]));
  const journaled = uniqueFindingsOwingAJournalLine(cveGroups, storedFigures, uniqueFindingKey);
  const incomingKeys = new Set(incoming.map(uniqueFindingKey));
  const lost = stored.filter((row) => !incomingKeys.has(uniqueFindingKey(row)));

  for (let i = 0; i < journaled.length; i += SCORE_UPSERT_CHUNK_SIZE) {
    await repo.insertUniqueFindingScoreHistoryBatch(journaled.slice(i, i + SCORE_UPSERT_CHUNK_SIZE).map((row) => ({
      id: uuidv7(),
      tenantId,
      organizationId,
      cveId: row.cveId,
      score: row.score,
      band: row.band,
      worstScore: row.worstScore,
      affectedAssetCount: row.affectedAssetCount,
      changedAt: computedAt,
    })));
  }
  for (let i = 0; i < incoming.length; i += SCORE_UPSERT_CHUNK_SIZE) {
    await repo.upsertUniqueFindingScoreBatch(incoming.slice(i, i + SCORE_UPSERT_CHUNK_SIZE));
  }
  for (let i = 0; i < lost.length; i += SCORE_UPSERT_CHUNK_SIZE) {
    const chunk = lost.slice(i, i + SCORE_UPSERT_CHUNK_SIZE);
    await repo.deleteUniqueFindingScores(chunk.map((row) => row.id));
    await repo.insertUniqueFindingScoreHistoryBatch(chunk.flatMap((row) => (row.cveId === null
      ? []
      : [{ id: uuidv7(), tenantId, organizationId, cveId: row.cveId, score: null, changedAt: computedAt }])));
  }
};

/** Sized by the catalogue and the tenant's declarations, never by the estate, so a run builds it once. */
interface ScoringContext {
  policy: FindingScorePolicy,
  /** Memoised per CVE row and exposure: the topology rule answers per asset, never per CVE. */
  techniquesFor: (cveRowId: string, exposure: SupportingAssetExposure) => TechniquesBySide,
  carriedByCategory: Map<AssetCategory, Set<string>>,
  externalIdByTechnique: Map<string, string>,
  muByCategory: Map<AssetCategory, Map<string, number>>,
  /** Resistance with every control credited on the share of the estate it protects, for the impact techniques. */
  muOnEstate: Map<string, number>,
  detectMuByCategory: Map<AssetCategory, Map<string, number>>,
  detectMuOnEstate: Map<string, number>,
  citedCveIds: Set<string>,
  /**
   * What the resistance runs above were given, so the detail read can replay one technique's run
   * term by term instead of rebuilding a context to explain a figure it already has.
   */
  resistance: {
    edgeIndex: ResistanceEdgeIndex,
    states: Array<CapabilityStateInput>,
    nodeByTechnique: Map<string, ScenarioNodeInput>,
    optionsByCategory: Map<AssetCategory, SusceptibilityOptions>,
    estateOptions: SusceptibilityOptions,
  },
}

interface TechniquesBySide {
  exploitation: Map<string, MappingConfidence>,
  impact: Map<string, MappingConfidence>,
}

interface Deps {
  crqIndicatorSettings: ExtractPublicFromDef<typeof crqIndicatorSettingsService>,
  controlCapabilities: ExtractPublicFromDef<typeof controlCapabilityService>,
  threatAnalyses: ExtractPublicFromDef<typeof threatAnalysesService>,
  techniqueMapping: ExtractPublicFromDef<typeof techniqueMappingService>,
  attackSurfaces: ExtractPublicFromDef<typeof attackSurfacesService>,
}

/**
 * The techniques the family of an asset can carry, or null when every technique is carried.
 *
 * A vulnerability resolves to its techniques from the flaw alone, so a finding on a web application
 * inherits the host's ways in, and only the family it sits on says which of them can run there.
 * Null for the unclassified bucket, which carries the whole catalogue by the surface resolver's own
 * rule rather than by an exemption from this one.
 */
const carriedByFamily = (
  carriedByCategory: Map<AssetCategory, Set<string>>,
  categoryId: AssetCategory,
): Set<string> | null => (
  categoryId === UNCLASSIFIED_ASSET_CATEGORY ? null : carriedByCategory.get(categoryId) ?? new Set<string>()
);

const highestConfidenceTier = (claims: Map<string, MappingConfidence>): Map<string, MappingConfidence> => {
  const present = new Set(claims.values());
  const highest = MAPPING_CONFIDENCE_VALUES.find((confidence) => present.has(confidence));
  return new Map([...claims].filter(([, confidence]) => confidence === highest));
};

const carriedTechniques = (
  claims: Map<string, MappingConfidence>,
  carried: Set<string> | null,
): Array<[string, MappingConfidence]> => [...claims.entries()]
  .filter(([techniqueId]) => carried === null || carried.has(techniqueId));

/** The same rule as `carriedByFamily`, for the detail read, which asks about one family only. */
const carriedByFamilyFor = async (
  deps: Deps,
  techniqueIds: Array<string>,
  categoryId: AssetCategory,
  tenantId: string,
): Promise<Set<string> | null> => {
  if (categoryId === UNCLASSIFIED_ASSET_CATEGORY) {
    return null;
  }
  const pairs = await deps.attackSurfaces.getApplicablePairsForTechniques(techniqueIds, { tenantId });
  return new Set(pairs.filter((pair) => pair.categoryId === categoryId).map((pair) => pair.mitreTechniqueId));
};

type TechniqueClaims = Awaited<ReturnType<Deps['techniqueMapping']['getTechniqueClaims']>>;

const attackClaimsReader = (claims: TechniqueClaims) => {
  const storedByCveRow = Map.groupBy(claims.mappings, (mapping) => mapping.cveId);
  const cveByRow = new Map(claims.cves.map((cve) => [cve.cveRowId, cve]));
  return (cveRowId: string, exposure: SupportingAssetExposure): Array<AttackClaim> => {
    const cve = cveByRow.get(cveRowId);
    return readAttackClaims({
      stored: storedByCveRow.get(cveRowId) ?? [],
      cwe: cve?.cwe ?? null,
      cvssVector: cve?.cvssVector ?? null,
      cvssV2UserInteractionRequired: cve?.cvssV2UserInteractionRequired ?? null,
      exposure,
      ruleCatalogue: claims.ruleCatalogue,
    });
  };
};

const readCveAttackResolution = async (
  deps: Deps,
  cveRowId: string,
  tenantId: string,
): Promise<Omit<UniqueAttackInput, 'members'>> => {
  const [claims, settings] = await Promise.all([
    deps.techniqueMapping.getTechniqueClaims([cveRowId]),
    deps.crqIndicatorSettings.getCrqIndicatorSettings(),
  ]);
  const claimsOn = attackClaimsReader(claims);
  const byExposure = new Map(ASSET_EXPOSURE_VALUES.map((exposure) => [exposure, claimsOn(cveRowId, exposure)]));
  const techniqueIds = [...new Set([...byExposure.values()].flat().map((claim) => claim.mitreTechniqueId))];
  const carriedByCategory = new Map<AssetCategory, Set<string>>();
  for (const pair of await deps.attackSurfaces.getApplicablePairsForTechniques(techniqueIds, { tenantId })) {
    carriedByCategory.set(pair.categoryId, (carriedByCategory.get(pair.categoryId) ?? new Set<string>()).add(pair.mitreTechniqueId));
  }
  return {
    claimsFor: (exposure) => byExposure.get(exposure) ?? [],
    unknownExposureCountsAs: settings.unknownExposureCountsAs,
    carriedFor: (categoryId) => carriedByFamily(carriedByCategory, categoryId),
  };
};

const exploitationLaneOf = (claims: ReadonlyArray<AttackClaim>, techniqueId: string): TechniqueClaimLane | null => {
  const lanes = claims
    .filter((claim) => claim.group === 'exploitation' && claim.mitreTechniqueId === techniqueId)
    .map((claim) => claim.lane)
    .sort((left, right) => MAPPING_CONFIDENCE_VALUES.indexOf(MAPPING_LANE_CONFIDENCE[left]) - MAPPING_CONFIDENCE_VALUES.indexOf(MAPPING_LANE_CONFIDENCE[right]));
  return lanes[0] ?? null;
};

const buildExposureCounts = (
  rows: Array<{ categoryId: AssetCategory, exposure: SupportingAssetExposure, assetCount: number }>,
): Record<string, ExposureCounts> => {
  const counts: Record<string, ExposureCounts> = {};
  for (const row of rows) {
    const categoryCounts = counts[row.categoryId] ?? {};
    categoryCounts[row.exposure] = Number(row.assetCount);
    counts[row.categoryId] = categoryCounts;
  }
  return counts;
};

/**
 * Score every finding in scope, with the arithmetic each one rests on.
 *
 * Only the recompute keeps the figures. A surface keeps the arithmetic and prints the figures
 * `finding_scores` holds, or it would disagree with every screen reading the projection.
 */
const buildScoringContext = async (
  { repo, deps, eventOrigin }: { repo: Repo, deps: Deps, eventOrigin: EventOrigin },
  scope: EvidenceScope,
): Promise<ScoringContext> => {
  const tenantId = requireTenantId(eventOrigin);
  const keys = await repo.findScoringKeysInScope(scope);
  const settings = await deps.crqIndicatorSettings.getCrqIndicatorSettings();
  const policy: FindingScorePolicy = {
    unknownCriticalityCountsAs: settings.unknownCriticalityCountsAs,
    unknownExposureCountsAs: settings.unknownExposureCountsAs,
    exposureWeights: {
      internet_facing: settings.exposureWeightInternetFacing,
      internal: settings.exposureWeightInternal,
    },
  };

  const claims = await deps.techniqueMapping.getTechniqueClaims(keys.cveRowIds);
  const claimsFor = attackClaimsReader(claims);
  const bySideByKey = new Map<string, TechniquesBySide>();
  const techniquesFor = (cveRowId: string, exposure: SupportingAssetExposure): TechniquesBySide => {
    const key = `${cveRowId}|${exposure}`;
    const known = bySideByKey.get(key);
    if (known !== undefined) {
      return known;
    }
    const read = claimsFor(cveRowId, exposure);
    const bySide = { exploitation: techniquesInReachOf(read), impact: highestConfidenceTier(impactTechniquesOf(read)) };
    bySideByKey.set(key, bySide);
    return bySide;
  };
  const techniqueIds = [...new Set([
    ...claims.mappings.map((mapping) => mapping.mitreTechniqueId),
    ...[...claims.ruleCatalogue.values()].map((technique) => technique.id),
  ])];
  const [citations, resistanceInputs, assetCounts, applicablePairs] = await Promise.all([
    deps.threatAnalyses.getActiveCitations(),
    deps.controlCapabilities.queryCapabilityResistanceInputs(techniqueIds, tenantId),
    repo.findAssetCountsByCategoryAndExposure(),
    deps.attackSurfaces.getApplicablePairsForTechniques(techniqueIds, { tenantId }),
  ]);
  const carriedByCategory = new Map<AssetCategory, Set<string>>();
  for (const pair of applicablePairs) {
    const carried = carriedByCategory.get(pair.categoryId) ?? new Set<string>();
    carried.add(pair.mitreTechniqueId);
    carriedByCategory.set(pair.categoryId, carried);
  }

  const protectionPairs = await deps.controlCapabilities.getProtectedFamilies(
    [...new Set(resistanceInputs.edges.map((edge) => edge.capabilityId))],
  );

  // The share of the estate each control protects, families weighted by their exposure-weighted
  // asset counts, the spread the simulation applies. The impact techniques read it, since what
  // follows a breach runs wherever the attacker goes, and so does an unclassified asset's
  // exploitation, since its family says nothing about what an attack on it would run into.
  const touchedCategoryIds = [...new Set(assetCounts.map((row) => row.categoryId))];
  // The mapping is empty on purpose: only `perCategory` is read here, and no technique is being
  // weighted against the estate.
  const assetRelevance = computeAssetRelevance({
    categoryIds: touchedCategoryIds,
    techniqueCategoryMapping: {},
    supportingAssetCounts: buildExposureCounts(assetCounts),
    exposureWeights: exposureWeightsByExposure(policy),
  });
  const estateOptions: SusceptibilityOptions = {
    gamma: settings.susceptibilityGamma,
    familyShareByCapability: buildFamilyShares({
      pairs: protectionPairs,
      touchedCategoryIds,
      categoryWeights: assetRelevance?.perCategory ?? null,
    }),
  };
  // A control that does not protect the family of the asset the finding sits on earns no credit
  // against its exploitation, whatever it protects elsewhere: protection is binary, so at a known
  // family the share is a 0-or-1 gate. The family is a property of the finding, so the score stays
  // identical on the asset page and on the estate list.
  const categoriesInScope = keys.categoryIds;
  const resistanceOptionsByCategory = new Map(categoriesInScope.map((categoryId) => [categoryId, categoryId === UNCLASSIFIED_ASSET_CATEGORY
    ? estateOptions
    : {
      gamma: settings.susceptibilityGamma,
      familyShareByCapability: buildFamilyShares({ pairs: protectionPairs, touchedCategoryIds: [categoryId], categoryWeights: null }),
    }]));
  // The edge topology does not depend on which capabilities are declared, so the index is built
  // once and reused across the runs per family below.
  const edgeIndex = buildResistanceEdgeIndex(resistanceInputs.edges);
  const muByCategory = new Map(await mapInYieldedChunks(categoriesInScope, RESISTANCE_RUNS_PER_YIELD, (categoryId) => [
    categoryId,
    computeTechniqueResistanceWithIndex(
      resistanceInputs.nodes,
      edgeIndex,
      resistanceInputs.states,
      resistanceOptionsByCategory.get(categoryId),
    ),
  ] as const));
  const muOnEstate = computeTechniqueResistanceWithIndex(resistanceInputs.nodes, edgeIndex, resistanceInputs.states, estateOptions);
  const detectMuByCategory = new Map(await mapInYieldedChunks(categoriesInScope, RESISTANCE_RUNS_PER_YIELD, (categoryId) => [
    categoryId,
    computeTechniqueResistanceWithIndex(
      resistanceInputs.nodes,
      edgeIndex,
      resistanceInputs.states,
      { ...resistanceOptionsByCategory.get(categoryId), functions: DETECTION_FUNCTIONS },
    ),
  ] as const));
  const detectMuOnEstate = computeTechniqueResistanceWithIndex(
    resistanceInputs.nodes,
    edgeIndex,
    resistanceInputs.states,
    { ...estateOptions, functions: DETECTION_FUNCTIONS },
  );

  const citedCveIds = new Set(citations.cveIds);
  const externalIdByTechnique = new Map([
    ...claims.mappings.map((mapping) => [mapping.mitreTechniqueId, mapping.techniqueExternalId] as const),
    ...[...claims.ruleCatalogue.values()].map((technique) => [technique.id, technique.externalId] as const),
  ]);

  return {
    policy,
    techniquesFor,
    carriedByCategory,
    externalIdByTechnique,
    muByCategory,
    muOnEstate,
    detectMuByCategory,
    detectMuOnEstate,
    citedCveIds,
    resistance: {
      edgeIndex,
      states: resistanceInputs.states,
      nodeByTechnique: new Map(resistanceInputs.nodes.map((node) => [node.techniqueId, node])),
      optionsByCategory: resistanceOptionsByCategory,
      estateOptions,
    },
  };
};

/** One finding's score and the fields the projection stores, from the scoring columns alone. */
const scoreRow = (context: ScoringContext, row: ScoringInputRow) => {
  const muByTechnique = context.muByCategory.get(row.assetCategoryId);
  const detectMuByTechnique = context.detectMuByCategory.get(row.assetCategoryId);
  const bySide = row.cveRowId === null
    ? null
    : context.techniquesFor(row.cveRowId, countedExposure(row.assetExposure, context.policy.unknownExposureCountsAs));
  const exploitationTechniques: Array<TechniqueInReach> = carriedTechniques(
    bySide?.exploitation ?? new Map(),
    carriedByFamily(context.carriedByCategory, row.assetCategoryId),
  )
    .map(([techniqueId, claimConfidence]) => ({
      techniqueId,
      claimConfidence,
      declaredMu: muByTechnique?.get(techniqueId) ?? null,
      detectMu: detectMuByTechnique?.get(techniqueId) ?? null,
    }));
  const impactTechniques: Array<TechniqueInReach> = [...(bySide?.impact ?? new Map<string, MappingConfidence>())]
    .map(([techniqueId, claimConfidence]) => ({
      techniqueId,
      claimConfidence,
      declaredMu: context.muOnEstate.get(techniqueId) ?? null,
      detectMu: context.detectMuOnEstate.get(techniqueId) ?? null,
    }));

  const cvss = parseCvssContributions(row.cvssVector, row.cvssV2UserInteractionRequired);
  const scored = computeFindingScore({
    exposure: row.assetExposure,
    criticality: row.assetCriticality,
    threat: {
      exploitationProbability: row.epss,
      knownExploited: isCisaListed(row),
      citedByActiveThreat: row.cveId !== null && context.citedCveIds.has(row.cveId.trim().toUpperCase()),
    },
    exploitationTechniques,
    impactTechniques,
    cvss,
  }, context.policy);

  return {
    ...scored,
    // Scored without a vector, every unknown term would be priced at the worst case. A severity or base
    // score a source gives such a CVE is a placeholder, not a reading of it.
    pendingVector: cvss === null,
    evidenceId: row.evidenceId,
    firstSeenAt: row.evidenceCreatedAt,
    currentState: row.currentState,
    currentStateSince: row.currentStateSince,
  };
};

/** A finding sits on an asset, never on an identity: no identity carries a CVE, so it is never disabled. */
const entryAssetOf = (row: ScoringInputRow): EntryAsset => ({
  categoryId: row.assetCategoryId,
  subcategoryId: row.assetSubcategoryId,
  exposure: row.assetExposure,
  identityEnabled: true,
});

/** The exploitation techniques the finding claims on its asset read as `exposure`, and the family carries them. */
const carriedExploitation = (
  context: ScoringContext,
  row: ScoringInputRow,
  cveRowId: string,
  exposure: SupportingAssetExposure,
) => carriedTechniques(
  context.techniquesFor(cveRowId, exposure).exploitation,
  carriedByFamily(context.carriedByCategory, row.assetCategoryId),
).map(([techniqueId]) => ({ techniqueId, externalId: context.externalIdByTechnique.get(techniqueId) ?? '' }));

const techniqueOpeningsOf = (
  context: ScoringContext,
  row: ScoringInputRow,
  finding: ReturnType<typeof scoreRow>,
): Array<HeldOpening> => {
  if (row.cveRowId === null || finding.currentState !== 'applicable') {
    return [];
  }
  const cvss = parseCvssContributions(row.cvssVector, row.cvssV2UserInteractionRequired);
  if (cvss === null) {
    return [];
  }
  return findingOpenings({
    asset: entryAssetOf(row),
    unknownExposureCountsAs: context.policy.unknownExposureCountsAs,
    techniques: carriedExploitation(context, row, row.cveRowId, countedExposure(row.assetExposure, context.policy.unknownExposureCountsAs)),
    access: cvss.access,
    threat: finding.factors.threat.value,
    impact: cvss.impact,
  }).map((opening) => ({ ...opening, supportingAssetId: row.supportingAssetId, evidenceId: row.evidenceId }));
};

/**
 * One row per initial access technique the flaw opens on the asset, before any control. A zero
 * opening, a flaw giving neither confidentiality nor integrity, opens nothing and gets no row.
 *
 * Applicability is read with an unknown exposure counted as internet-facing, the widest reading of
 * the tenant setting: the run reapplies the setting it holds when it starts, so a row must exist for
 * every reading the setting can take. A dismissed finding keeps its rows for the same reason: the run
 * reads the finding's latest state, so a dismissal or a reopening leaves this table, and the price
 * pass observing it, untouched.
 */
const entryOpeningsOf = (
  context: ScoringContext,
  row: ScoringInputRow,
  finding: ReturnType<typeof scoreRow>,
): Array<EntryOpeningRow> => {
  const impact = entryImpact(row.cvssVector);
  const cvss = parseCvssContributions(row.cvssVector, row.cvssV2UserInteractionRequired);
  if (row.cveRowId === null || impact === null || cvss === null) {
    return [];
  }
  const opening = cvss.access * impact;
  if (opening <= 0) {
    return [];
  }
  const asset = entryAssetOf(row);
  return carriedExploitation(context, row, row.cveRowId, row.assetExposure)
    .filter((technique) => entryTechniqueApplies(technique.externalId, asset, 'internet_facing'))
    .map((technique) => ({
      assetEvidenceId: row.evidenceId,
      mitreTechniqueId: technique.techniqueId,
      supportingAssetId: row.supportingAssetId,
      cveId: row.cveRowId!,
      opening,
      threat: finding.factors.threat.value,
    }));
};

const PENDING_FIGURES = {
  score: null,
  band: null,
  exploitability: null,
  impact: null,
  potentialImpact: null,
  exploitationLetThrough: null,
  impactLetThrough: null,
  reachability: null,
  threat: null,
  weakestTechniqueId: null,
};

/** A finding pending a vector keeps its row, with no figure: every reader of a part then leaves it out. */
const projectScoredRow = (finding: ReturnType<typeof scoreRow>, tenantId: string, computedAt: Date) => ({
  assetEvidenceId: finding.evidenceId,
  tenantId,
  ...(finding.pendingVector ? PENDING_FIGURES : {
    score: finding.score,
    band: finding.band,
    exploitability: finding.exploitability,
    impact: finding.impact,
    potentialImpact: finding.factors.potentialImpact.value,
    exploitationLetThrough: finding.factors.exploitationControls.value,
    impactLetThrough: finding.factors.impactControls.value,
    reachability: finding.factors.reachability.value,
    threat: finding.factors.threat.value,
    weakestTechniqueId: finding.factors.exploitationControls.weakestPath?.techniqueId ?? null,
  }),
  scoreChangedAt: computedAt,
});

const scoreRows = (
  context: ScoringContext,
  rows: EvidenceRows,
): Array<ScoredFinding> => rows.map((row) => ({
  ...scoreRow(context, row),
  supportingAssetId: row.supportingAssetId,
  assetName: row.assetName,
  assetDerivedName: row.assetDerivedName,
  assetCriticality: row.assetCriticality,
  assetExposure: row.assetExposure,
  assetCategoryId: row.assetCategoryId,
  assetLastSeenAt: row.assetLastSeenAt,
  assetOwnerName: row.assetOwnerName,
  cveRowId: row.cveRowId,
  cveId: row.cveId,
  cveTitle: row.cveTitle,
  epss: row.epss,
  knownExploited: isCisaListed(row),
  sources: row.sources,
  lastEvaluatedAt: row.evaluatedAt,
  cvssVector: row.cvssVector,
  cvssV2UserInteractionRequired: row.cvssV2UserInteractionRequired,
}));

/**
 * The resistance runs behind what the exploitation controls let through, replayed for the one
 * technique that set it. Null when no exploitation technique stood there, where there is no run to explain.
 */
const explainExploitationResistance = (
  context: ScoringContext,
  finding: ScoredFinding,
): WeakestPathResistance | null => {
  const weakest = finding.factors.exploitationControls.weakestPath;
  if (weakest === null) {
    return null;
  }
  const { edgeIndex, states, nodeByTechnique, optionsByCategory } = context.resistance;
  const node = nodeByTechnique.get(weakest.techniqueId) ?? { techniqueId: weakest.techniqueId, parentTechniqueId: null };
  const options = optionsByCategory.get(finding.assetCategoryId);
  return {
    declared: explainTechniqueResistance(node, edgeIndex, states, options),
    detection: explainTechniqueResistance(node, edgeIndex, states, { ...options, functions: DETECTION_FUNCTIONS }),
  };
};

/** The estate-wide runs behind the impact technique letting the most through; null when no impact technique stood there. */
const explainImpactResistance = (
  context: ScoringContext,
  finding: ScoredFinding,
): WeakestPathResistance | null => {
  const weakest = finding.factors.impactControls.weakestPath;
  if (weakest === null) {
    return null;
  }
  const { edgeIndex, states, nodeByTechnique, estateOptions } = context.resistance;
  const node = nodeByTechnique.get(weakest.techniqueId) ?? { techniqueId: weakest.techniqueId, parentTechniqueId: null };
  return {
    declared: explainTechniqueResistance(node, edgeIndex, states, estateOptions),
    detection: explainTechniqueResistance(node, edgeIndex, states, { ...estateOptions, functions: DETECTION_FUNCTIONS }),
  };
};

type StoredScoreFigures = Awaited<ReturnType<Repo['findStoredScoreFigures']>>[number];

/**
 * The terms each factor is explained with stay as read, so they can run ahead of the stored figure
 * until the next recompute commits. Null on a finding with no complete row: unscored, never zero.
 */
const withStoredFigures = (finding: ScoredFinding, stored: StoredScoreFigures | undefined): ScoredFinding | null => {
  if (stored === undefined) {
    return null;
  }
  const { score, band, exploitability, impact, reachability, threat, exploitationLetThrough, potentialImpact, impactLetThrough } = stored;
  if (
    score === null || band === null
    || exploitability === null || impact === null || reachability === null || threat === null
    || exploitationLetThrough === null || potentialImpact === null || impactLetThrough === null
  ) {
    return null;
  }
  const reachabilityAndThreat = (reachability + threat) / 2;
  const { factors } = finding;
  return {
    ...finding,
    score,
    band,
    exploitability,
    impact,
    reachabilityAndThreat,
    composition: composeParts(exploitability, impact),
    limitingTerm: resolveLimitingTerm({
      reachabilityAndThreat,
      exploitationControls: exploitationLetThrough,
      potentialImpact,
      impactControls: impactLetThrough,
    }, exploitability, impact),
    factors: {
      reachability: { ...factors.reachability, value: reachability },
      threat: { ...factors.threat, value: threat },
      exploitationControls: { ...factors.exploitationControls, value: exploitationLetThrough },
      potentialImpact: { ...factors.potentialImpact, value: potentialImpact },
      impactControls: { ...factors.impactControls, value: impactLetThrough },
    },
  };
};

/** Loads the whole scope at once, which suits a single finding. The recompute must not, and drives the halves itself. */
const assembleScoredFindings = async (
  ctx: { repo: Repo, deps: Deps, eventOrigin: EventOrigin },
  scope: EvidenceScope,
): Promise<{ findings: Array<{ read: ScoredFinding, stored: ScoredFinding | null, pendingVector: boolean }>, context: ScoringContext }> => {
  const [context, rows, storedFigures] = await Promise.all([
    buildScoringContext(ctx, scope),
    ctx.repo.findScoredEvidence(scope),
    ctx.repo.findStoredScoreFigures(scope),
  ]);
  const storedByEvidence = new Map(storedFigures.map((row) => [row.assetEvidenceId, row]));
  return {
    findings: scoreRows(context, rows).map((read) => {
      const storedRow = storedByEvidence.get(read.evidenceId);
      return {
        read,
        stored: withStoredFigures(read, storedRow),
        pendingVector: storedRow !== undefined && storedRow.score === null,
      };
    }),
    context,
  };
};

type TestRun = {
  mitreTechniqueId: string | null,
  expectationType: ExpectationType | null,
  held: number,
  total: number,
  assetCount: number,
  lastRunAt: Date | null,
};

const tallyOf = (runs: Array<TestRun>, expectationType: ExpectationType): TestTally | null => {
  const run = runs.find((entry) => entry.expectationType === expectationType);
  return run === undefined || run.total === 0 ? null : { held: run.held, total: run.total };
};

/** One technique's runs at one scope, folded into the two tallies and the date of the last one. */
const readTestScope = (runs: Array<TestRun>, techniqueId: string): TechniqueTestScope => {
  const own = runs.filter((run) => run.mitreTechniqueId === techniqueId);
  const dates = own.map((run) => run.lastRunAt).filter((date): date is Date => date !== null);
  return {
    prevention: tallyOf(own, 'prevention'),
    detection: tallyOf(own, 'detection'),
    lastRunAt: dates.length === 0 ? null : new Date(Math.max(...dates.map((date) => date.getTime()))),
  };
};

/** The function a capability edge carries, read against the expectation the platform runs. */
const EXPECTATION_OF_FUNCTION: Record<CapabilityFunction, ExpectationType> = {
  prevent: 'prevention',
  detect: 'detection',
};

const sumTallies = (tallies: Array<TestTally | null>): TestTally | null => {
  const present = tallies.filter((tally): tally is TestTally => tally !== null);
  return present.length === 0 ? null : {
    held: present.reduce((total, tally) => total + tally.held, 0),
    total: present.reduce((total, tally) => total + tally.total, 0),
  };
};

/** What a run said about the techniques in reach, on this asset. Null when none was ever run here. */
const buildValidation = (records: Array<TechniqueTestRecord>): FindingScoreColumns['validation'] => {
  const tested = records.filter((record) => record.here.lastRunAt !== null);
  if (tested.length === 0) {
    return null;
  }
  const dates = tested.map((record) => record.here.lastRunAt!.getTime());
  return {
    techniquesTested: tested.length,
    techniquesInReach: records.length,
    prevention: sumTallies(tested.map((record) => record.here.prevention)),
    detection: sumTallies(tested.map((record) => record.here.detection)),
    lastRunAt: new Date(Math.max(...dates)),
  };
};

type ResistanceInputs = Awaited<ReturnType<Deps['controlCapabilities']['queryCapabilityResistanceInputs']>>;

/**
 * Which declared controls the engine credits on which technique and through which function, read
 * back from the sources the resistance engine reads, never from the figure it produced: a control
 * contributes only above L0, only with some coverage, only on a family it protects when a family
 * gate applies, and an edge on the parent technique carries onto its children. `protectingIds`
 * null means no family gate.
 */
const readCreditedControls = (inputs: ResistanceInputs, protectingIds: Set<string> | null) => {
  const creditableCapabilityIds = new Set(
    inputs.states
      .filter((state) => state.strengthRung !== 'L0'
        && state.coverageBucket !== 'L0'
        && (protectingIds === null || protectingIds.has(state.capabilityId)))
      .map((state) => state.capabilityId),
  );
  const creditedEdges = inputs.edges.filter((edge) => creditableCapabilityIds.has(edge.capabilityId));
  const parentByTechnique = new Map(inputs.nodes.map((node) => [node.techniqueId, node.parentTechniqueId]));
  const onTechnique = (techniqueId: string) => {
    const parentId = parentByTechnique.get(techniqueId) ?? null;
    return (edge: { techniqueId: string }) => edge.techniqueId === techniqueId || edge.techniqueId === parentId;
  };
  return {
    parentByTechnique,
    scoredCapabilityIds: new Set(creditedEdges.map((edge) => edge.capabilityId)),
    creditedOn: (techniqueId: string, fn: CapabilityFunction): Array<string> => [...new Set(creditedEdges
      .filter((edge) => edge.function === fn && onTechnique(techniqueId)(edge))
      .map((edge) => edge.capabilityId))],
    functionsOn: (capabilityId: string, techniqueId: string): Array<CapabilityFunction> => [...new Set(inputs.edges
      .filter((edge) => edge.capabilityId === capabilityId && onTechnique(techniqueId)(edge))
      .map((edge) => edge.function))],
  };
};

interface ClaimedTechnique {
  externalId: string,
  name: string | null,
  group: AttackGroup | null,
}

const claimedTechniques = (claims: ReadonlyArray<AttackClaim>): Map<string, ClaimedTechnique> => {
  const byTechnique = new Map<string, ClaimedTechnique>();
  for (const claim of claims) {
    if (!byTechnique.has(claim.mitreTechniqueId)) {
      byTechnique.set(claim.mitreTechniqueId, { externalId: claim.techniqueExternalId, name: claim.techniqueName, group: claim.group });
    }
  }
  return byTechnique;
};

const sideTechniques = (
  techniqueIds: ReadonlyArray<string>,
  claimed: Map<string, ClaimedTechnique>,
  groups: ReadonlyArray<AttackGroup>,
  claims: ReadonlyArray<AttackClaim>,
  creditedOn: (techniqueId: string, fn: CapabilityFunction) => Array<string>,
): Array<SideTechnique> => techniqueIds.map((techniqueId) => ({
  mitreTechniqueId: techniqueId,
  externalId: claimed.get(techniqueId)?.externalId ?? techniqueId,
  name: claimed.get(techniqueId)?.name ?? null,
  group: claims.find((claim) => claim.mitreTechniqueId === techniqueId && groups.includes(claim.group))?.group
    ?? claimed.get(techniqueId)?.group
    ?? null,
  preventingCapabilityIds: creditedOn(techniqueId, 'prevent'),
  detectingCapabilityIds: creditedOn(techniqueId, 'detect'),
}));

const IMPACT_GROUPS: ReadonlyArray<AttackGroup> = ['primary_impact', 'secondary_impact', 'weakness'];

/**
 * The controls standing on the impact techniques, credited on the whole estate: a control earns
 * on the share of it that it protects, so only one protecting none of it is set aside, and no run
 * is read, since no platform exercises what follows a breach on this asset.
 */
const assembleImpactColumn = async (
  { repo, deps }: { repo: Repo, deps: Deps },
  claims: ReadonlyArray<AttackClaim>,
  impactClaims: Map<string, MappingConfidence>,
  weakestTechniqueId: string | null,
  estateShareByCapability: ReadonlyMap<string, number>,
  tenantId: string,
): Promise<FindingScoreColumns['impactControls']> => {
  const techniqueIds = [...impactClaims.keys()];
  if (techniqueIds.length === 0) {
    return { mitigations: null, weakestPath: null, techniques: [] };
  }
  const inputs = await deps.controlCapabilities.queryCapabilityResistanceInputs(techniqueIds, tenantId);
  const standingIds = [...new Set(inputs.edges.map((edge) => edge.capabilityId))];
  const names = new Map((await repo.findCapabilityNames(standingIds)).map((row) => [row.id, row]));
  const stateByCapability = new Map(inputs.states.map((state) => [state.capabilityId, state]));
  const protectingIds = new Set(standingIds.filter((capabilityId) => (estateShareByCapability.get(capabilityId) ?? 0) > 0));
  const credited = readCreditedControls(inputs, protectingIds);
  const claimed = claimedTechniques(claims);
  return {
    mitigations: standingIds.map((capabilityId): DeclaredControl => ({
      capabilityId,
      externalId: names.get(capabilityId)?.externalId ?? capabilityId,
      name: names.get(capabilityId)?.name ?? capabilityId,
      strengthRung: stateByCapability.get(capabilityId)?.strengthRung ?? 'L0',
      coverageBucket: stateByCapability.get(capabilityId)?.coverageBucket ?? 'L0',
      protectsAssetFamily: protectingIds.has(capabilityId),
      scoredHere: credited.scoredCapabilityIds.has(capabilityId),
      standsOn: techniqueIds
        .map((techniqueId) => ({ mitreTechniqueId: techniqueId, functions: credited.functionsOn(capabilityId, techniqueId) }))
        .filter((entry) => entry.functions.length > 0),
      knockedDownHere: false,
    })).sort((a, b) => a.externalId.localeCompare(b.externalId)),
    weakestPath: weakestTechniqueId === null ? null : {
      externalId: claimed.get(weakestTechniqueId)?.externalId ?? weakestTechniqueId,
      confidence: impactClaims.get(weakestTechniqueId) ?? 'high',
    },
    techniques: sideTechniques(techniqueIds, claimed, IMPACT_GROUPS, claims, credited.creditedOn),
  };
};

/**
 * The evidence behind one finding, column by column.
 *
 * Every value here is read again from its own source rather than reconstructed from the score:
 * the columns must be able to disagree with the figure out loud, which is the whole point of
 * drawing them, and a column derived from the number it explains never can.
 */
const assembleColumns = async (
  { repo, deps, eventOrigin }: { repo: Repo, deps: Deps, eventOrigin: EventOrigin },
  finding: ScoredFinding,
  estateShareByCapability: ReadonlyMap<string, number>,
): Promise<FindingScoreColumns> => {
  const tenantId = requireTenantId(eventOrigin);
  const metrics = readCvssMetrics(finding.cvssVector);
  const [citations, claims] = await Promise.all([
    deps.threatAnalyses.getActiveCitations(),
    finding.cveRowId === null ? null : deps.techniqueMapping.getTechniqueClaims([finding.cveRowId]),
  ]);

  const attackClaims = claims === null || finding.cveRowId === null
    ? []
    : attackClaimsReader(claims)(finding.cveRowId, finding.factors.reachability.terms.exposureCountedAs);
  const carried = await carriedByFamilyFor(
    deps,
    [...new Set(attackClaims.map((claim) => claim.mitreTechniqueId))],
    finding.assetCategoryId,
    tenantId,
  );
  // The rule answers on read, so a CVE the resolver left unresolved can still be reached.
  const resolutionState = attackClaims.length > 0 ? 'resolved' : claims?.states[0]?.state ?? null;
  const techniques = resolutionState === null ? null : {
    state: resolutionState,
    rows: attackClaims.map((claim) => ({
      mitreTechniqueId: claim.mitreTechniqueId,
      externalId: claim.techniqueExternalId,
      name: claim.techniqueName,
      role: claim.role,
      lane: claim.lane,
      group: claim.group,
      justification: claim.justification,
      grain: claim.grain,
      carriedByAssetFamily: carried === null || carried.has(claim.mitreTechniqueId),
    })),
  };

  const activeThreatCount = finding.cveId === null
    ? 0
    : citations.analysisCountByCveId[finding.cveId.trim().toUpperCase()] ?? 0;

  const impactControls = await assembleImpactColumn(
    { repo, deps },
    attackClaims,
    highestConfidenceTier(impactTechniquesOf(attackClaims)),
    finding.factors.impactControls.weakestPath?.techniqueId ?? null,
    estateShareByCapability,
    tenantId,
  );

  const shared = {
    reachability: {
      exposure: finding.assetExposure,
      categoryId: finding.assetCategoryId,
      assetLastSeenAt: finding.assetLastSeenAt,
      cvssMetrics: metrics.filter((entry) => ACCESS_METRICS.includes(entry.metric)),
    },
    threat: {
      exploitationProbability: finding.epss,
      knownExploited: finding.knownExploited,
      activeThreatCount,
      attackComplexity: metrics.find((entry) => entry.metric === 'AC')?.value ?? null,
    },
    potentialImpact: {
      criticality: finding.assetCriticality,
      ownerName: finding.assetOwnerName,
      cvssMetrics: metrics.filter((entry) => IMPACT_METRICS.includes(entry.metric)),
    },
    impactControls,
    techniques,
  };

  const claimByTechnique = new Map(carriedTechniques(techniquesInReachOf(attackClaims), carried));
  const techniqueIdsInReach = [...claimByTechnique.keys()];
  if (techniqueIdsInReach.length === 0) {
    return {
      ...shared,
      validation: null,
      mitigations: null,
      uncoveredTechniqueExternalIds: [],
      weakestPath: null,
      techniqueTests: [],
      exploitationTechniques: [],
    };
  }

  const [resistanceInputs, platformControls, hereRuns, fleetRuns, fleetAssetCounts, letThroughRuns] = await Promise.all([
    deps.controlCapabilities.queryCapabilityResistanceInputs(techniqueIdsInReach, tenantId),
    repo.findControlsByPlatformType(),
    repo.findTechniqueTestRecords(techniqueIdsInReach, finding.supportingAssetId),
    repo.findTechniqueTestRecords(techniqueIdsInReach),
    repo.findFleetAssetCountsByTechnique(techniqueIdsInReach),
    repo.findLetThroughPlatformsByTechnique(techniqueIdsInReach, finding.supportingAssetId),
  ]);
  const platformsByCapability = new Map<string, Set<string>>();
  for (const pair of platformControls) {
    const platforms = platformsByCapability.get(pair.capabilityId) ?? new Set<string>();
    platforms.add(pair.platformTypeKey);
    platformsByCapability.set(pair.capabilityId, platforms);
  }
  // One key per run that held nothing, so a knock-down asks whether a platform implementing the
  // control is among them rather than whether anything at all got through.
  const letThroughKeys = new Set(
    letThroughRuns
      .filter((run) => run.total > 0 && run.held === 0)
      .map((run) => `${run.mitreTechniqueId}|${run.expectationType}|${run.securityPlatformType}`),
  );
  const stateByCapability = new Map(resistanceInputs.states.map((state) => [state.capabilityId, state]));
  const standingIds = [...new Set(resistanceInputs.edges.map((edge) => edge.capabilityId))];
  const [names, protectionPairs] = await Promise.all([
    repo.findCapabilityNames(standingIds),
    deps.controlCapabilities.getProtectedFamilies(standingIds),
  ]);
  const nameById = new Map(names.map((row) => [row.id, row]));
  // Null when the asset is unclassified: the family gate does not apply there, see the score path.
  const protectingIds = finding.assetCategoryId === UNCLASSIFIED_ASSET_CATEGORY ? null : new Set(
    protectionPairs
      .filter((pair) => pair.categoryId === finding.assetCategoryId)
      .map((pair) => pair.capabilityId),
  );

  const credited = readCreditedControls(resistanceInputs, protectingIds);
  const externalIdByTechnique = new Map(attackClaims.map((claim) => [claim.mitreTechniqueId, claim.techniqueExternalId]));
  const uncoveredTechniqueExternalIds = [...new Set(
    techniqueIdsInReach
      .filter((techniqueId) => credited.creditedOn(techniqueId, 'prevent').length === 0)
      .map((techniqueId) => externalIdByTechnique.get(techniqueId))
      .filter((externalId): externalId is string => externalId !== undefined),
  )].sort((a, b) => a.localeCompare(b));

  const fleetAssetCountByTechnique = new Map(
    fleetAssetCounts
      .filter((row): row is typeof row & { mitreTechniqueId: string } => row.mitreTechniqueId !== null)
      .map((row) => [row.mitreTechniqueId, row.assetCount]),
  );
  const nameByTechnique = new Map<string, string | null>(attackClaims.map((claim) => [claim.mitreTechniqueId, claim.techniqueName]));
  const techniqueTests = techniqueIdsInReach.map((techniqueId) => ({
    mitreTechniqueId: techniqueId,
    externalId: externalIdByTechnique.get(techniqueId) ?? techniqueId,
    name: nameByTechnique.get(techniqueId) ?? null,
    here: readTestScope(hereRuns, techniqueId),
    fleet: {
      ...readTestScope(fleetRuns, techniqueId),
      assetCount: fleetAssetCountByTechnique.get(techniqueId) ?? 0,
    },
  }));

  const mitigations: Array<DeclaredControl> = standingIds.map((capabilityId) => {
    const state = stateByCapability.get(capabilityId);
    const standsOn = techniqueIdsInReach
      .map((techniqueId) => ({ mitreTechniqueId: techniqueId, functions: credited.functionsOn(capabilityId, techniqueId) }))
      .filter((entry) => entry.functions.length > 0);
    return {
      capabilityId,
      externalId: nameById.get(capabilityId)?.externalId ?? capabilityId,
      name: nameById.get(capabilityId)?.name ?? capabilityId,
      strengthRung: state?.strengthRung ?? 'L0',
      coverageBucket: state?.coverageBucket ?? 'L0',
      protectsAssetFamily: protectingIds === null || protectingIds.has(capabilityId),
      scoredHere: credited.scoredCapabilityIds.has(capabilityId),
      standsOn,
      knockedDownHere: standsOn.some((entry) => entry.functions.some((fn) => {
        const expectation = EXPECTATION_OF_FUNCTION[fn];
        return [...(platformsByCapability.get(capabilityId) ?? [])]
          .some((platform) => letThroughKeys.has(`${entry.mitreTechniqueId}|${expectation}|${platform}`));
      })),
    };
  }).sort((a, b) => a.externalId.localeCompare(b.externalId));

  const claimed = new Map([...externalIdByTechnique].map(([techniqueId, externalId]) => [techniqueId, {
    externalId,
    name: nameByTechnique.get(techniqueId) ?? null,
    group: 'exploitation' as const,
  }]));
  const weakestTechniqueId = finding.factors.exploitationControls.weakestPath?.techniqueId ?? null;
  return {
    ...shared,
    validation: buildValidation(techniqueTests),
    mitigations,
    uncoveredTechniqueExternalIds,
    weakestPath: weakestTechniqueId === null ? null : {
      externalId: externalIdByTechnique.get(weakestTechniqueId) ?? weakestTechniqueId,
      confidence: claimByTechnique.get(weakestTechniqueId) ?? 'high',
    },
    techniqueTests,
    exploitationTechniques: sideTechniques(techniqueIdsInReach, claimed, ['exploitation'], attackClaims, credited.creditedOn),
  };
};

export const findingScoreService = defineService(
  'findingScore',
  findingScoreRepository,
).dependsOn(() => [
  crqIndicatorSettingsService,
  controlCapabilityService,
  threatAnalysesService,
  techniqueMappingService,
  attackSurfacesService,
]).implement({
  /** The only writer of `finding_scores`. Runs in the worker: an estate allocates one object per finding. */
  recomputeFindingScores: async (
    ctx,
    params: { scoreHistoryRetentionDays?: number } = {},
  ): Promise<{ scored: number }> => {
    const tenantId = requireTenantId(ctx.eventOrigin);
    const context = await buildScoringContext(ctx, {});
    const computedAt = new Date();
    const retentionDays = params.scoreHistoryRetentionDays ?? SCORE_HISTORY_RETENTION_DAYS;
    let scored = 0;
    // A cell's worst finding can come in any batch, so the cells are only complete once the walk is.
    const heldOpenings: HeldOpenings = new Map();
    const producedEntryOpenings = new Set<string>();

    // One transaction for the whole estate, or a reader between two batches pages over an ordering
    // half of which is the previous run's.
    await ctx.atomic(async ({ repo }) => {
      let afterEvidenceId: string | null = null;
      for (;;) {
        const evidenceIds = await repo.findEvidenceIdBatch({ afterEvidenceId, limit: SCORE_BATCH_SIZE });
        if (evidenceIds.length === 0) {
          break;
        }
        const rows = await repo.findScoringInputs({ evidenceIds });

        const scoredRows = await mapInYieldedChunks(rows, FINDINGS_PER_YIELD, (row) => {
          const finding = scoreRow(context, row);
          return {
            projected: projectScoredRow(finding, tenantId, computedAt),
            openings: techniqueOpeningsOf(context, row, finding),
            entryOpenings: entryOpeningsOf(context, row, finding),
          };
        });
        for (const { openings } of scoredRows) {
          openings.forEach((opening) => holdWorstOpening(heldOpenings, opening));
        }
        // One finding's rows are final within its batch, unlike a cell's worst finding, which only the whole walk settles.
        const entryRows = scoredRows.flatMap((scoredRow) => scoredRow.entryOpenings);
        for (let i = 0; i < entryRows.length; i += SCORE_UPSERT_CHUNK_SIZE) {
          const chunk = entryRows.slice(i, i + SCORE_UPSERT_CHUNK_SIZE);
          await repo.upsertEntryOpeningBatch(chunk.map((entryRow) => ({ ...entryRow, tenantId })));
          chunk.forEach((entryRow) => producedEntryOpenings.add(entryOpeningKey(entryRow)));
        }
        const projected = scoredRows.map((scoredRow) => scoredRow.projected);
        for (let i = 0; i < projected.length; i += SCORE_UPSERT_CHUNK_SIZE) {
          const chunk = projected.slice(i, i + SCORE_UPSERT_CHUNK_SIZE);
          const stored = await repo.findStoredScoreBandings(chunk.map((row) => row.assetEvidenceId));
          await repo.insertFindingScoreHistoryBatch(
            rowsOwingAJournalLine(chunk, new Map(stored.map((row) => [row.assetEvidenceId, row])))
              .map((row) => ({
                id: uuidv7(),
                assetEvidenceId: row.assetEvidenceId,
                tenantId,
                score: row.score,
                band: row.band,
                changedAt: computedAt,
              })),
          );
          await repo.upsertFindingScoreBatch(chunk);
        }
        scored += rows.length;
        afterEvidenceId = evidenceIds[evidenceIds.length - 1]!;
      }

      // Counted after the walk and inside its transaction, so the day's figure and the scores it
      // counts commit together.
      const counted = await repo.countApplicableFindingsByBand();
      const valueByBand = new Map(counted.map((row) => [row.band, Number(row.value)]));
      // Every band gets a row, including one nobody is in: a missing point and a zero look the
      // same on a plot, and only one of them is what happened.
      await repo.upsertFindingMetricDailyBatch(SEVERITY_BANDS.map((band) => ({
        tenantId,
        day: utcDayOf(computedAt),
        metric: BAND_METRIC_KEYS[band],
        value: valueByBand.get(band) ?? 0,
      })));

      const postures = (await repo.findEstatePostureInputs()).map(({ supportingAssetId, worstEvidenceId, worstExploitability, critical, high, medium, low }) => {
        const worstFigure = partFigure(worstExploitability);
        return {
          supportingAssetId,
          score: computeAssetPosture(worstFigure, { critical, high, medium, low }),
          cause: { worstAssetEvidenceId: worstEvidenceId, worstExploitability: worstFigure, criticalCount: critical, highCount: high, mediumCount: medium, lowCount: low },
        };
      });
      for (let i = 0; i < postures.length; i += SCORE_UPSERT_CHUNK_SIZE) {
        const chunk = postures.slice(i, i + SCORE_UPSERT_CHUNK_SIZE);
        const stored = await repo.findStoredAssetPostureScores(chunk.map((posture) => posture.supportingAssetId));
        await repo.insertAssetPostureHistoryBatch(
          posturesOwingAJournalLine(chunk, new Map(stored.map((row) => [row.supportingAssetId, row.score])))
            .map(({ supportingAssetId, score, cause }) => ({ id: uuidv7(), supportingAssetId, tenantId, score, changedAt: computedAt, ...cause })),
        );
        await repo.upsertAssetPostureBatch(chunk.map(({ supportingAssetId, score }) => ({ supportingAssetId, tenantId, score })));
      }
      const lostPostures = await repo.deleteAssetPosturesWithoutApplicableFinding();
      for (let i = 0; i < lostPostures.length; i += SCORE_UPSERT_CHUNK_SIZE) {
        await repo.insertAssetPostureHistoryBatch(lostPostures.slice(i, i + SCORE_UPSERT_CHUNK_SIZE)
          .map((supportingAssetId) => ({ id: uuidv7(), supportingAssetId, tenantId, score: null, changedAt: computedAt })));
      }

      const techniqueScores = [...heldOpenings.values()];
      for (let i = 0; i < techniqueScores.length; i += SCORE_UPSERT_CHUNK_SIZE) {
        await repo.upsertAssetTechniqueScoreBatch(techniqueScores.slice(i, i + SCORE_UPSERT_CHUNK_SIZE).map((held) => ({
          tenantId,
          supportingAssetId: held.supportingAssetId,
          mitreTechniqueId: held.mitreTechniqueId,
          score: openingFigure(held.opening),
          assetEvidenceId: held.evidenceId,
        })));
      }
      // Paged over the stored keys, so no statement grows with the estate. Deleting behind the
      // cursor leaves the pages ahead untouched.
      let afterCell: TechniqueScoreCellKey | null = null;
      for (;;) {
        const stored = await repo.findAssetTechniqueScoreKeyPage({ after: afterCell, limit: SCORE_BATCH_SIZE });
        if (stored.length === 0) {
          break;
        }
        await repo.deleteAssetTechniqueScores(stored.filter((cell) => !heldOpenings.has(heldOpeningKey(cell))));
        afterCell = stored[stored.length - 1]!;
      }
      let afterOpening: EntryOpeningKey | null = null;
      for (;;) {
        const stored = await repo.findEntryOpeningKeyPage({ tenantId, after: afterOpening, limit: SCORE_BATCH_SIZE });
        if (stored.length === 0) {
          break;
        }
        await repo.deleteEntryOpenings(tenantId, stored.filter((opening) => !producedEntryOpenings.has(entryOpeningKey(opening))));
        afterOpening = stored[stored.length - 1]!;
      }

      await projectUniqueFindingScores(repo, await repo.findUniqueFindingInputs(), { tenantId, organizationId: null, computedAt });
      const inputsByOrganization = Map.groupBy(await repo.findOrganizationUniqueFindingInputs(), (input) => input.organizationId);
      // An organization left with no applicable finding has no inputs, and its stored rows still have to go.
      const organizationIds = new Set([...inputsByOrganization.keys(), ...await repo.findStoredUniqueFindingOrganizationIds()]);
      for (const organizationId of organizationIds) {
        await projectUniqueFindingScores(repo, inputsByOrganization.get(organizationId) ?? [], { tenantId, organizationId, computedAt });
      }

      await repo.trimFindingScoreHistory(new Date(computedAt.getTime() - retentionDays * 86_400_000));
      await repo.trimAssetPostureHistory(new Date(computedAt.getTime() - POSTURE_HISTORY_RETENTION_DAYS * 86_400_000));
      await repo.trimUniqueFindingScoreHistory(new Date(computedAt.getTime() - UNIQUE_SCORE_HISTORY_RETENTION_DAYS * 86_400_000));
    });
    return { scored };
  },

  listScoredFindings: async (
    { repo, deps, eventOrigin },
    params: {
      page: number,
      limit: number,
      state: EvidenceState | null,
      source: string | null,
      vulnerability?: VulnerabilityFilter | null,
      /**
       * The findings this way in holds on, by its external id. It is resolved per CVE, so it narrows
       * a CVE's list only, and a technique the CVE does not open there matches nothing.
       */
      technique?: string | null,
      search?: string | null,
      mappedToOrganizationId: string | null,
      sortBy: FindingSortKey,
      sortDesc: boolean,
    },
  ): Promise<ScoredFindingPage> => {
    // A client origin with no tenant contributes no predicate, so a read that does not demand one
    // answers across every tenant.
    const tenantId = requireTenantId(eventOrigin);
    const offset = (params.page - 1) * params.limit;
    const vulnerability = params.vulnerability ?? null;
    const technique = params.technique ?? null;
    const resolveWayIn = async (): Promise<ListedFindingsFilter['wayIn']> => {
      const cveRef = technique === null || vulnerability?.kind !== 'cve' ? undefined : await repo.findCveRef(vulnerability.cveId);
      if (cveRef === undefined) {
        return { exposures: [], setAsideOn: [] };
      }
      const { waysIn } = aggregateUniqueAttack({ ...await readCveAttackResolution(deps, cveRef, tenantId), members: [] });
      const wayIn = waysIn.find((candidate) => candidate.externalId === technique);
      return wayIn === undefined ? { exposures: [], setAsideOn: [] } : { exposures: wayIn.exposures, setAsideOn: wayIn.setAsideOn };
    };
    const filter = {
      state: params.state,
      source: params.source,
      vulnerability,
      wayIn: technique === null ? null : await resolveWayIn(),
      search: params.search ?? null,
      mappedToOrganizationId: params.mappedToOrganizationId,
    };
    const [items, total, unscored] = await Promise.all([
      repo.findListedFindingsPage({ ...filter, limit: params.limit, offset, sortBy: params.sortBy, sortDesc: params.sortDesc }),
      repo.countListedFindings(filter),
      repo.countUnscoredFindings(params.mappedToOrganizationId, params.vulnerability ?? null, params.search ?? null),
    ]);
    return { items, total, page: params.page, limit: params.limit, unscored };
  },

  /** One asset's findings, a CVE finding not scored yet included with no score. */
  listAssetFindings: async (
    { repo, eventOrigin },
    params: {
      supportingAssetId: string,
      page: number,
      limit: number,
      state: EvidenceState | null,
      mitreTechniqueExternalId: string | null,
      expectationType: ExpectationType | null,
      search: string | null,
      sortBy: FindingSortKey,
      sortDesc: boolean,
    },
  ): Promise<Omit<ScoredFindingPage, 'unscored'>> => {
    requireTenantId(eventOrigin);
    const filter = {
      state: params.state,
      source: null,
      mappedToOrganizationId: null,
      search: params.search,
      asset: {
        supportingAssetId: params.supportingAssetId,
        mitreTechniqueExternalId: params.mitreTechniqueExternalId,
        expectationType: params.expectationType,
      },
    };
    const [items, total] = await Promise.all([
      repo.findListedFindingsPage({ ...filter, limit: params.limit, offset: (params.page - 1) * params.limit, sortBy: params.sortBy, sortDesc: params.sortDesc }),
      repo.countListedFindings(filter),
    ]);
    return { items, total, page: params.page, limit: params.limit };
  },

  listUniqueFindings: async (
    { repo, eventOrigin },
    params: { page: number, limit: number, sortBy: UniqueFindingSortKey, sortDesc: boolean } & UniqueFindingScope & UniqueFindingListOptions,
  ): Promise<UniqueFindingPage> => {
    requireTenantId(eventOrigin);
    const gainRunId = params.gainRunId ?? null;
    if (params.sortBy === 'gain' && gainRunId === null) {
      throw newError('Cannot sort unique findings by gain without a gain run');
    }
    const scope = { source: params.source, mappedToOrganizationId: params.mappedToOrganizationId, search: params.search, cveOnly: params.cveOnly };
    const [rows, total] = await Promise.all([
      repo.findUniqueFindingsPage({
        ...scope,
        gainRunId,
        limit: params.limit,
        offset: (params.page - 1) * params.limit,
        sortBy: params.sortBy,
        sortDesc: params.sortDesc,
      }),
      repo.countUniqueFindings(scope),
    ]);
    const items = rows.map((row) => {
      const score = row.uniqueScore === null ? null : truncateScore(row.uniqueScore);
      const worstScore = row.worstScore === null ? null : truncateScore(row.worstScore);
      return {
        key: row.cveRef === null ? `technique:${row.mitreTechniqueRef}:${row.expectationType}` : `cve:${row.cveRef}`,
        cveId: row.cveId,
        cveTitle: row.cveTitle,
        knownExploited: row.cveRef === null ? null : isCisaListed(row),
        epss: row.epss,
        mitreTechniqueExternalId: row.mitreTechniqueExternalId,
        mitreTechniqueName: row.mitreTechniqueName,
        expectationType: row.expectationType,
        score,
        band: score === null ? null : resolveSeverityBand(score),
        worstScore,
        worstBand: worstScore === null ? null : resolveSeverityBand(worstScore),
        pendingVector: row.pendingVector,
        affectedAssetCount: row.affectedAssetCount,
        sources: row.sources,
        firstSeenAt: new Date(row.firstSeenAt),
        ...(gainRunId === null ? {} : { cveRef: row.cveRef, gainMean: row.gainMean, gainP10: row.gainP10, gainP90: row.gainP90 }),
      };
    });
    return { items, total, page: params.page, limit: params.limit };
  },

  getUniqueTechniqueFinding: async (
    { repo, eventOrigin },
    params: { externalId: string, expectationType: ExpectationType, mappedToOrganizationId: string | null },
  ) => {
    requireTenantId(eventOrigin);
    return repo.findUniqueTechniqueFinding(params);
  },

  getUniqueCveFinding: async (
    { repo, eventOrigin },
    params: { cveId: string, mappedToOrganizationId: string | null },
  ): Promise<UniqueCveFinding | undefined> => {
    requireTenantId(eventOrigin);
    const row = await repo.findUniqueCveFinding(params);
    if (row === undefined) {
      return undefined;
    }
    const [sources, levels] = await Promise.all([
      repo.findUniqueCveFindingSources(params),
      repo.findUniqueCveFindingLevels(params),
    ]);
    const score = row.uniqueScore === null ? null : truncateScore(row.uniqueScore);
    const worstScore = row.worstScore === null ? null : truncateScore(row.worstScore);
    return {
      cveId: row.cveId,
      cveTitle: row.cveTitle,
      knownExploited: isCisaListed(row),
      epss: row.epss,
      score,
      band: score === null ? null : resolveSeverityBand(score),
      worstScore,
      worstBand: worstScore === null ? null : resolveSeverityBand(worstScore),
      pendingVector: row.pendingVector,
      affectedAssetCount: row.affectedAssetCount ?? 0,
      sources,
      firstSeenAt: row.firstSeenAt,
      composition: explainUniqueScore(levels),
    };
  },

  /** Undefined for a threat the tenant does not see. */
  listThreatCveFindings: async (
    { repo, deps, eventOrigin },
    params: { threatId: string, mappedToOrganizationId: string | null },
  ): Promise<Array<ThreatCveFinding> | undefined> => {
    requireTenantId(eventOrigin);
    const claims = await deps.threatAnalyses.getCves(params.threatId);
    if (claims === undefined) {
      return undefined;
    }
    // Looked up as stored: the import creates a catalogue row under the id exactly as the bundle
    // spells it, and the unique findings page names that row the same way.
    const claimByCveId = new Map(claims.map((claim) => [claim.cveId, claim]));
    const rows = await repo.findUniqueCveFindingsOf({
      cveIds: [...claimByCveId.keys()],
      mappedToOrganizationId: params.mappedToOrganizationId,
    });
    const rowByCveId = new Map(rows.map((row) => [row.cveId, row]));
    return [...claimByCveId].map(([cveId, claim]): ThreatCveFinding => {
      const row = rowByCveId.get(cveId);
      const presence: ThreatCvePresence = row?.storedId != null ? 'present' : row?.members == null ? 'absent' : 'computing';
      const score = presence === 'present' && row?.uniqueScore != null ? truncateScore(row.uniqueScore) : null;
      const worstScore = presence === 'present' && row?.worstScore != null ? truncateScore(row.worstScore) : null;
      return {
        cveId,
        cveTitle: row?.cveTitle ?? null,
        knownExploited: row === undefined ? null : isCisaListed(row),
        epss: row?.epss ?? null,
        presence,
        score,
        band: score === null ? null : resolveSeverityBand(score),
        worstScore,
        worstBand: worstScore === null ? null : resolveSeverityBand(worstScore),
        pendingVector: presence === 'present' && score === null && (row?.members?.unscoredMember ?? false),
        affectedAssetCount: presence === 'present' ? row?.affectedAssetCount ?? 0 : 0,
        sources: (presence === 'present' ? row?.members?.listedSources : row?.members?.allSources) ?? [],
        firstSeenAt: presence === 'present' ? row?.firstSeenAt ?? null : null,
        openctiStixRelationId: claim.openctiStixRelationId,
      };
    }).sort(compareThreatCveFindings);
  },

  /** Under the members `getUniqueCveFinding` counts, so the counts share its group size. Undefined when the tenant has no such CVE. */
  getUniqueCveFindingAttack: async (
    { repo, deps, eventOrigin },
    params: { cveId: string, mappedToOrganizationId: string | null },
  ): Promise<UniqueAttack | undefined> => {
    const tenantId = requireTenantId(eventOrigin);
    const cveRef = await repo.findCveRef(params.cveId);
    if (cveRef === undefined) {
      return undefined;
    }
    const [resolution, members] = await Promise.all([
      readCveAttackResolution(deps, cveRef, tenantId),
      repo.findUniqueCveFindingMemberKinds(params),
    ]);
    return aggregateUniqueAttack({ ...resolution, members });
  },

  listUniqueFindingEvents: async (
    { repo, eventOrigin },
    params: { cveId: string, mappedToOrganizationId: string | null, page: number, limit: number },
  ): Promise<UniqueFindingEventPage> => {
    requireTenantId(eventOrigin);
    const scope = { cveId: params.cveId, mappedToOrganizationId: params.mappedToOrganizationId };
    const since = new Date(Date.now() - UNIQUE_SCORE_HISTORY_RETENTION_DAYS * 86_400_000);
    const [lines, total] = await Promise.all([
      repo.findUniqueFindingHistoryPage({ ...scope, limit: params.limit, offset: (params.page - 1) * params.limit }),
      repo.countUniqueFindingHistory({ ...scope, since }),
    ]);
    const items = explainUniqueFindingEvents(lines.slice(0, params.limit), lines.at(params.limit) ?? null, since);
    return { items, total, page: params.page, limit: params.limit };
  },

  /**
   * Twelve months of a CVE group's journal in the estate, oldest first, led by the line in force when
   * they open, which reads as a first since the line it moved from is gone.
   */
  getUniqueFindingScoreHistory: async (
    { repo, eventOrigin },
    params: { cveId: string, mappedToOrganizationId: string | null },
  ): Promise<Array<UniqueFindingEvent>> => {
    requireTenantId(eventOrigin);
    const since = new Date(Date.now() - UNIQUE_SCORE_HISTORY_RETENTION_DAYS * 86_400_000);
    const lines = await repo.findUniqueFindingScoreHistory({ ...params, since });
    return explainUniqueFindingEvents(lines.toReversed(), null, new Date(0)).toReversed();
  },

  getCveEstates: async ({ repo, eventOrigin }, cveRowId: string) => {
    requireTenantId(eventOrigin);
    return repo.findCveEstates(cveRowId);
  },

  getScoredFindingsByEvidenceIds: async ({ repo, eventOrigin }, evidenceIds: Array<string>) => {
    requireTenantId(eventOrigin);
    return repo.findScoredFindingsByEvidenceIds(evidenceIds);
  },

  getFindingCountsBySource: async ({ repo, eventOrigin }, mappedToOrganizationId: string | null = null, applicableOnly = false) => {
    requireTenantId(eventOrigin);
    return repo.getFindingCountsBySource(mappedToOrganizationId, applicableOnly);
  },

  getTopVulnerabilities: async ({ repo, eventOrigin }, mappedToOrganizationId: string | null, limit: number) => {
    requireTenantId(eventOrigin);
    return repo.findTopVulnerabilities({ mappedToOrganizationId, limit });
  },

  getFindingsPanelCounts: async ({ repo, eventOrigin }, mappedToOrganizationId: string | null = null): Promise<FindingsPanelCounts> => {
    requireTenantId(eventOrigin);
    const { windowStart } = resolveFindingTrendWindow(new Date());
    const counts = await repo.findFindingsPanelCounts(windowStart, mappedToOrganizationId);
    return { ...counts, windowStart };
  },

  getUniqueFindingsPanelCounts: async ({ repo, eventOrigin }, mappedToOrganizationId: string | null): Promise<UniqueFindingsPanelCounts> => {
    requireTenantId(eventOrigin);
    const window = resolveFindingTrendWindow(new Date());
    const rows = await repo.findUniqueFindingsPanelCounts({ mappedToOrganizationId, ...window });
    return foldUniqueFindingsPanel(rows, window);
  },

  getOpenFindingFigures: async ({ repo, eventOrigin }, mappedToOrganizationId: string | null): Promise<OpenFindingFigures> => {
    requireTenantId(eventOrigin);
    const firstSeenBefore = daysBefore(new Date(), AGED_FINDING_DAYS);
    return repo.findOpenFindingFigures({ mappedToOrganizationId, firstSeenBefore });
  },

  getTechniqueTestPosture: async ({ repo, eventOrigin }, mappedToOrganizationId: string | null): Promise<TechniqueTestPosture> => {
    requireTenantId(eventOrigin);
    const upTo = daysBefore(new Date(), TECHNIQUE_POSTURE_CHANGE_DAYS);
    const [current, previous, testedAssetCount] = await Promise.all([
      repo.findTechniqueTestTallies({ mappedToOrganizationId }),
      repo.findTechniqueTestTallies({ mappedToOrganizationId, upTo }),
      repo.countTechniqueTestedAssets(mappedToOrganizationId),
    ]);
    return {
      testedAssetCount,
      expectations: {
        prevention: { current: expectationTally(current, 'prevention'), previous: expectationTally(previous, 'prevention') },
        detection: { current: expectationTally(current, 'detection'), previous: expectationTally(previous, 'detection') },
      },
    };
  },

  /** Null when no applicable finding of the asset has been scored: that is no data, never a safe asset. */
  getAssetPosture: async ({ repo }, supportingAssetId: string): Promise<AssetPosture | null> => {
    const worst = await repo.findAssetPostureInputs(supportingAssetId);
    if (worst === null || worst.exploitability === null || worst.score === null) {
      return null;
    }
    const countsByBand = { critical: worst.critical, high: worst.high, medium: worst.medium, low: worst.low };
    const exploitability = partFigure(worst.exploitability);
    const { score, composition } = explainAssetPosture(exploitability, countsByBand);
    return {
      score,
      worstFinding: {
        evidenceId: worst.evidenceId,
        name: worst.name,
        exploitability,
        impact: partFigure(worst.impact ?? 0),
        score: worst.score,
      },
      countsByBand,
      composition,
    };
  },

  /** A null score is a stretch with no posture, never a zero. */
  getAssetPostureHistory: async ({ repo, eventOrigin }, supportingAssetId: string): Promise<Array<AssetPostureHistoryLine>> => {
    requireTenantId(eventOrigin);
    const since = new Date(Date.now() - POSTURE_HISTORY_RETENTION_DAYS * 86_400_000);
    const lines = await repo.findAssetPostureHistory(supportingAssetId, since);
    const worstEvidenceIds = [...new Set(lines.flatMap((line) => (line.worstEvidenceId === null ? [] : [line.worstEvidenceId])))];
    const stateChanges = await repo.findEvidenceStateChanges(worstEvidenceIds);
    return explainPostureHistory(lines, stateChanges, lines.length > 0 && lines[0].at.getTime() < since.getTime());
  },

  /**
   * Twelve months of a finding's journal, led by the line in force when they open, so a finding whose
   * last move is older reads flat rather than empty. The score is the one printed, truncated.
   */
  getFindingScoreHistory: async ({ repo, eventOrigin }, evidenceId: string): Promise<Array<FindingScoreHistoryLine>> => {
    requireTenantId(eventOrigin);
    const since = new Date(Date.now() - SCORE_HISTORY_RETENTION_DAYS * 86_400_000);
    const lines = await repo.findFindingScoreHistory(evidenceId, since);
    return lines.map((line) => ({ at: line.at, score: line.score === null ? null : truncateScore(line.score), band: line.band }));
  },

  /**
   * The cells come from the recompute's projection, and a holder's own figures from the threat it
   * stored. A person's phishing cell is computed here from the tenant's settings, and takes the
   * technique over any finding cell.
   */
  getAssetTechniqueScores: async ({ repo, deps, eventOrigin }, supportingAssetId: string): Promise<AssetTechniqueScores> => {
    requireTenantId(eventOrigin);
    const [profile, settings, phishingTechnique, stored] = await Promise.all([
      repo.findAssetEntryProfile(supportingAssetId),
      deps.crqIndicatorSettings.getCrqIndicatorSettings(),
      repo.findTechniqueByExternalId(PHISHING_TECHNIQUE),
      repo.findAssetTechniqueScores(supportingAssetId),
    ]);
    const personCell = profile === undefined ? null : susceptibilityCell(profile, settings, new Date());
    const phishing = personCell === null ? undefined : phishingTechnique;
    const rows = phishing === undefined ? stored : stored.filter((row) => row.mitreTechniqueId !== phishing.id);
    const susceptibilityTechnique = personCell === null || phishing === undefined
      ? []
      : [{
        mitreTechniqueId: phishing.id,
        externalId: phishing.externalId,
        name: phishing.name,
        score: personCell.score,
        evidenceId: null,
        source: 'susceptibility' as const,
        lane: null,
        susceptibility: { rate: personCell.rate, declared: personCell.declared, expired: personCell.expired, measuredOn: personCell.measuredOn },
      }];
    if (rows.length === 0) {
      return { techniques: susceptibilityTechnique, findings: [] };
    }
    const holderRows = await repo.findTechniqueScoreHolders([...new Set(rows.map((row) => row.evidenceId))]);
    const claimsFor = attackClaimsReader(await deps.techniqueMapping.getTechniqueClaims(holderRows.map((holder) => holder.cveRowId)));
    const claimsByEvidence = new Map(holderRows.map((holder) => [holder.evidenceId, claimsFor(holder.cveRowId, holder.assetExposure)]));

    const findings = holderRows.flatMap((holder): Array<TechniqueScoreHolder> => {
      const cvss = parseCvssContributions(holder.cvssVector, holder.cvssV2UserInteractionRequired);
      if (cvss === null || holder.cvssVector === null || holder.threat === null) {
        return [];
      }
      return [{
        evidenceId: holder.evidenceId,
        cveId: holder.cveId,
        cveTitle: holder.cveTitle,
        cvssVector: holder.cvssVector,
        epss: holder.epss,
        knownExploited: isCisaListed(holder),
        access: cvss.access,
        threat: holder.threat,
        impact: cvss.impact,
      }];
    });

    const techniques = rows.map((row): AssetTechniqueScore => ({
      mitreTechniqueId: row.mitreTechniqueId,
      externalId: row.externalId,
      name: row.name,
      score: row.score,
      evidenceId: row.evidenceId,
      source: 'finding',
      lane: exploitationLaneOf(claimsByEvidence.get(row.evidenceId) ?? [], row.mitreTechniqueId),
    }));
    return { techniques: [...techniques, ...susceptibilityTechnique], findings };
  },

  /** The raw connector verdicts, never the finding scores built on them. */
  getAssetTechniqueTests: async ({ repo, eventOrigin }, supportingAssetId: string): Promise<AssetTechniqueTests> => {
    requireTenantId(eventOrigin);
    const rows = await repo.findAssetTechniqueTestRecords(supportingAssetId);
    const tallyOfType = (techniqueRows: typeof rows, expectationType: ExpectationType) => sumTallies(techniqueRows
      .filter((row) => row.expectationType === expectationType)
      .map((row) => ({ held: row.held, total: row.total })));
    const techniqueIds = [...new Set(rows.map((row) => row.mitreTechniqueId))];
    return {
      prevention: tallyOfType(rows, 'prevention'),
      detection: tallyOfType(rows, 'detection'),
      techniques: techniqueIds.map((mitreTechniqueId) => {
        const own = rows.filter((row) => row.mitreTechniqueId === mitreTechniqueId);
        return { mitreTechniqueId, prevention: tallyOfType(own, 'prevention'), detection: tallyOfType(own, 'detection') };
      }),
    };
  },

  getAssetTechniqueTestDetail: async (
    { repo, eventOrigin },
    supportingAssetId: string,
    mitreTechniqueId: string,
  ): Promise<AssetTechniqueTestDetail> => {
    requireTenantId(eventOrigin);
    const [platformRows, fleetRows] = await Promise.all([
      repo.findTechniqueTestPlatforms(mitreTechniqueId, supportingAssetId),
      repo.findTechniqueTestRecords([mitreTechniqueId]),
    ]);
    const section = (expectationType: ExpectationType): TechniqueTestSection => {
      const platforms = platformRows
        .filter((row) => row.expectationType === expectationType)
        .map((row): TechniqueTestPlatform => ({
          securityPlatformType: row.securityPlatformType,
          held: row.held,
          total: row.total,
          lastRunAt: row.lastRunAt,
        }))
        .toSorted((a, b) => b.total - a.total || (a.securityPlatformType ?? '').localeCompare(b.securityPlatformType ?? ''));
      return { here: sumTallies(platforms), fleet: tallyOf(fleetRows, expectationType), platforms };
    };
    return { prevention: section('prevention'), detection: section('detection') };
  },

  /** The two stocks and the one flow the findings panel compares today's figures against. */
  getFindingBaselines: async ({ repo, eventOrigin }): Promise<FindingBaselines> => {
    requireTenantId(eventOrigin);
    const { windowStart, previousWindowStart } = resolveFindingTrendWindow(new Date());
    const stock = await repo.findApplicableStockBefore(windowStart, previousWindowStart);
    return {
      windowStart,
      findingsStockBefore: stock.findingCount,
      impactedAssetsStockBefore: stock.impactedAssetCount,
      newInPreviousWindow: stock.createdInWindowCount,
    };
  },

  /** One finding, with the evidence each column of the detail screen draws. */
  getFindingScoreBreakdown: async (
    ctx,
    evidenceId: string,
  ): Promise<FindingScoreBreakdown | UnscoredFindingBreakdown | null> => {
    const { findings, context } = await assembleScoredFindings(ctx, { evidenceId });
    const assembled = findings[0];
    if (assembled === undefined) {
      return null;
    }
    const { read, stored, pendingVector } = assembled;
    const [columns, otherImpactedAssetCount] = await Promise.all([
      assembleColumns(ctx, read, context.resistance.estateOptions.familyShareByCapability ?? new Map()),
      read.cveId === null
        ? Promise.resolve(0)
        : ctx.repo.countOtherImpactedAssets({
          cveId: read.cveId,
          supportingAssetId: read.supportingAssetId,
        }),
    ]);
    if (stored === null) {
      const {
        score: _score, band: _band, factors: _factors, reachabilityAndThreat: _reachabilityAndThreat,
        exploitability: _exploitability, impact: _impact, composition: _composition, limitingTerm: _limitingTerm,
        ...evidence
      } = read;
      return { ...evidence, score: null, band: null, pendingVector, columns, otherImpactedAssetCount };
    }
    return {
      ...stored,
      columns,
      otherImpactedAssetCount,
      resistance: {
        exploitation: explainExploitationResistance(context, stored),
        impact: explainImpactResistance(context, stored),
      },
      cvss: explainCvssContributions(stored.cvssVector, stored.cvssV2UserInteractionRequired),
    };
  },
});
