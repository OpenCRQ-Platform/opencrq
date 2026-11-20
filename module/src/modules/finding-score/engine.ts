import type { AssetCriticality, DeclaredCriticality } from '../supporting-assets/constants';
import type { MappingConfidence } from '../technique-mapping/constants';
import type { DeclaredExposure, EvidenceState, SupportingAssetExposure } from '../supporting-assets/schema';
import type { UnknownExposureCountsAs } from '../attack-surfaces/entry-applicability';
import type { CvssContributions } from '../cve/cvss-vector';
import type { SeverityBand } from './bands';
import { MAPPING_CONFIDENCE_VALUES } from '../technique-mapping/constants';
import { countedCriticality } from '../supporting-assets/constants';
import { countedExposure } from '../attack-surfaces/entry-applicability';
import { resolveSeverityBand, truncateScore } from './bands';
import {
  CRITICALITY_COST_FACTORS,
  DETECTION_CREDIT,
  INDEPENDENT_SIGNAL_LIFT,
  RESISTANCE_MU_CAP,
  THREAT_FLOORS,
  UNEVALUATED_LET_THROUGH,
} from './constants';

// ─── Inputs (flat: no Drizzle, no service, no IO) ──────────────────────────────

/**
 * The three source families the threat factor knows. Independence is defined on the family, so
 * two threats citing one flaw are one signal while a probability and a catalogue entry on
 * the same flaw are two.
 */
type ThreatSignalFamily = 'exploitation_probability' | 'known_exploited' | 'active_threat';

export type MeasuredVerdict = 'got_through' | 'held';

export interface ThreatSignalInput {
  /** Published exploitation probability on the flaw; null when no feed answered. */
  exploitationProbability: number | null,
  /** True only when the flaw is listed as exploited: false and null are both silence. */
  knownExploited: boolean,
  /** An active threat of the tenant cites the flaw or the technique. */
  citedByActiveThreat: boolean,
}

export interface MeasuredResult {
  verdict: MeasuredVerdict,
  /** When the result was last established; null when the source carried no date. */
  measuredAt: Date | null,
}

export interface TechniqueInReach {
  techniqueId: string,
  /**
   * How far the claim that this finding reaches the technique is believed. A technique a platform
   * observed is not a claim, so it comes in at `high`.
   */
  claimConfidence: MappingConfidence,
  /** Declared resistance against the technique, uncapped; null when nothing is declared. */
  declaredMu: number | null,
  /** Declared resistance from the controls that detect the technique; null when nothing is declared. */
  detectMu: number | null,
}

export interface MeasuredValidityPolicy {
  /** Days a measured result keeps counting as a measurement; null means the window is off. */
  measuredValidityDays: number | null,
}

export interface FindingScorePolicy {
  unknownCriticalityCountsAs: DeclaredCriticality,
  unknownExposureCountsAs: UnknownExposureCountsAs,
  /** The tenant's weight for each declared exposure; an unknown one takes the weight of the one it counts as. */
  exposureWeights: Record<DeclaredExposure, number>,
}

export interface FindingScoreInput {
  exposure: SupportingAssetExposure,
  criticality: AssetCriticality,
  threat: ThreatSignalInput,
  /** How the flaw is exploited, narrowed to what the asset's family carries, controls measured on that family. */
  exploitationTechniques: ReadonlyArray<TechniqueInReach>,
  /**
   * What follows the breach, wherever it runs, so its controls are measured on the whole estate.
   * Only the highest claim confidence present: the side is a mean, which the deductions from the
   * weakness class would dilute.
   */
  impactTechniques: ReadonlyArray<TechniqueInReach>,
  /** What the flaw's own CVSS base vector says; null when none was published or none was read. */
  cvss: CvssContributions | null,
}

// ─── Outputs ───────────────────────────────────────────────────────────────────

export type ScorePart = 'exploitability' | 'impact';

/** The four terms the two parts multiply, the first being the mean of reachability and threat. */
export type ScoreTermKey = 'reachabilityAndThreat' | 'exploitationControls' | 'potentialImpact' | 'impactControls';

export interface ScoredFactor {
  value: number,
}

/**
 * The named terms a factor multiplied, as the engine used them rather than as a reader would
 * re-derive them: a surface that recomputes the arithmetic beside the figure drifts from it the
 * first time a weight moves. Every number here is post-clamp and post-cap, so a term reads as what
 * actually entered the product.
 */
export interface ReachabilityTerms {
  /** The exposure the factor was priced at: the declared one, or the tenant's choice when none is. */
  exposureCountedAs: DeclaredExposure,
  exposureWeight: number,
  /** The vector's access contribution; null when no vector was published, where the factor is the weight alone. */
  cvssAccess: number | null,
}

export interface ThreatSignalTerm {
  family: ThreatSignalFamily,
  floor: number,
}

export interface ThreatTerms {
  baseFloor: number,
  /** Only the signals that spoke. A probability of zero is silence and never appears here. */
  signals: Array<ThreatSignalTerm>,
  /** The highest floor of the base floor and the signals, which is what the lift and the damper act on. */
  maxFloor: number,
  /** Independent families heard; two or more are what earns the lift. */
  familyCount: number,
  /** The floor after the lift, equal to `maxFloor` when fewer than two families spoke. */
  lifted: number,
  cvssComplexity: number | null,
  /** `lifted x complexity`, which is what the base floor is then taken against. */
  damped: number,
  /** `damped` fell under the base floor, so the base floor is what the figure rests on. */
  heldAtBaseFloor: boolean,
}

export interface GettingThroughTerms {
  claimConfidence: MappingConfidence,
  /** The declared resistance after the cap. */
  declaredMu: number,
  /** What was declared stood above `RESISTANCE_MU_CAP`, so the cap is what the figure rests on. */
  cappedResistance: boolean,
  preventionLetThrough: number,
  detectMu: number,
  detectionCredit: number,
}

export interface PotentialImpactTerms {
  /** The band the factor was priced at: the declared one, or the tenant's choice when none is. */
  criticalityCountedAs: DeclaredCriticality,
  criticalityFactor: number,
  /** The vector's impact contribution; null when no vector was published. */
  cvssImpact: number | null,
}

/** `score = trunc(100 x sqrt(exploitability x impact))`, laid out term by term. */
export interface CompositionTerms {
  exploitability: number,
  impact: number,
  product: number,
  raw: number,
  score: number,
}

export interface ReachabilityFactor extends ScoredFactor {
  terms: ReachabilityTerms,
}

export interface ThreatFactor extends ScoredFactor {
  terms: ThreatTerms,
}

export interface PotentialImpactFactor extends ScoredFactor {
  terms: PotentialImpactTerms,
}

export interface TechniquePath extends ScoredFactor {
  techniqueId: string,
  terms: GettingThroughTerms,
}

/**
 * How a side folds its techniques into one figure: the one letting the most through, or the mean.
 *
 * The exploitation techniques are alternative ways in, and the attacker takes the easiest. The
 * impact techniques are what the attacker may do once in, while their cost is priced once for the
 * whole side, so a technique that costs nothing on its own must not decide it.
 */
export type ControlsAggregation = 'weakest' | 'mean';

/**
 * What the controls let through on one side of the score.
 *
 * With no technique on the side, `weakestPath` is null and the value is `UNEVALUATED_LET_THROUGH`:
 * the side is still counted, so every finding is scored on the same two terms.
 */
export interface ControlsFactor extends ScoredFactor {
  aggregation: ControlsAggregation,
  /** The technique letting the most through, which decides the side only when it takes the weakest. */
  weakestPath: TechniquePath | null,
  /** Every technique on the side, the weakest first. */
  paths: Array<TechniquePath>,
}

export interface FindingScore {
  score: number,
  band: SeverityBand,
  factors: {
    reachability: ReachabilityFactor,
    threat: ThreatFactor,
    exploitationControls: ControlsFactor,
    potentialImpact: PotentialImpactFactor,
    impactControls: ControlsFactor,
  },
  /** `(reachability + threat) / 2`, which the exploitation controls then narrow. */
  reachabilityAndThreat: number,
  /** Whether an attempt lands here, on 0 to 1. The asset posture reads it. */
  exploitability: number,
  /** What a landed attempt costs, on 0 to 1. */
  impact: number,
  composition: CompositionTerms,
  /** The lower term of the weaker part, which is what holds the score back the most. */
  limitingTerm: ScoreTermKey,
}

// ─── Factors ───────────────────────────────────────────────────────────────────

const clampUnit = (value: number): number => (Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0);

/**
 * Where the asset stands, narrowed by what the flaw itself demands of an attacker.
 *
 * The two multiply because they are conditions in series: reaching the asset is worth nothing if
 * the flaw needs a local session and administrative rights on top. With no vector published the
 * factor is the exposure weight alone, which is what a finding carrying no CVSS is worth.
 */
export const reachabilityFactor = (
  exposure: SupportingAssetExposure,
  cvss: CvssContributions | null,
  policy: Pick<FindingScorePolicy, 'unknownExposureCountsAs' | 'exposureWeights'>,
): ReachabilityFactor => {
  const countedAs = countedExposure(exposure, policy.unknownExposureCountsAs);
  const weight = clampUnit(policy.exposureWeights[countedAs]);
  return {
    value: weight * (cvss?.access ?? 1),
    terms: { exposureCountedAs: countedAs, exposureWeight: weight, cvssAccess: cvss?.access ?? null },
  };
};

/** The weight each exposure value reads, unknown included: the shape `computeAssetRelevance` takes. */
export const exposureWeightsByExposure = (
  policy: Pick<FindingScorePolicy, 'unknownExposureCountsAs' | 'exposureWeights'>,
): Record<SupportingAssetExposure, number> => ({
  ...policy.exposureWeights,
  unknown: policy.exposureWeights[policy.unknownExposureCountsAs],
});

interface ThreatSignal {
  family: ThreatSignalFamily,
  floor: number,
}

/**
 * Every signal that set a floor. A probability of zero states nothing that raises a floor, so it
 * is silence rather than a signal, which also keeps it out of the independence count.
 */
const resolveThreatSignals = (input: ThreatSignalInput): Array<ThreatSignal> => {
  const signals: Array<ThreatSignal> = [];
  if (input.exploitationProbability !== null && input.exploitationProbability > 0) {
    signals.push({ family: 'exploitation_probability', floor: clampUnit(input.exploitationProbability) });
  }
  if (input.knownExploited) {
    signals.push({ family: 'known_exploited', floor: THREAT_FLOORS.knownExploited });
  }
  if (input.citedByActiveThreat) {
    signals.push({ family: 'active_threat', floor: THREAT_FLOORS.activeThreat });
  }
  return signals;
};

/**
 * Floors, never a noisy-OR: the factor is the highest floor any signal set, lifted a third of the
 * way to certainty when two or more independent families spoke.
 *
 * The base floor participates in the maximum rather than standing in only for total silence. That
 * is what makes the factor monotone in the signals received, which a source going dark, or a very
 * low published probability arriving, would otherwise break.
 *
 * Attack complexity dampens the result and never lifts it, and never past the base floor: a flaw
 * that is hard to weaponise is still being weaponised once somebody has, so the observed signals
 * are discounted rather than overruled.
 */
export const threatFactor = (input: ThreatSignalInput, cvss: CvssContributions | null): ThreatFactor => {
  const signals = resolveThreatSignals(input);
  const families = new Set(signals.map((signal) => signal.family));
  const maxFloor = signals.reduce<number>((floor, signal) => Math.max(floor, signal.floor), THREAT_FLOORS.base);
  const lifted = families.size >= 2
    ? maxFloor + (1 - maxFloor) * INDEPENDENT_SIGNAL_LIFT
    : maxFloor;
  const damped = lifted * (cvss?.complexity ?? 1);
  return {
    value: clampUnit(Math.max(damped, THREAT_FLOORS.base)),
    terms: {
      baseFloor: THREAT_FLOORS.base,
      signals,
      maxFloor,
      familyCount: families.size,
      lifted,
      cvssComplexity: cvss?.complexity ?? null,
      damped,
      heldAtBaseFloor: damped < THREAT_FLOORS.base,
    },
  };
};

/** The stored verdict of one evidence row, as the canonical reader needs it. */
export interface MeasuredRow {
  /** The finding's latest logged test verdict (`asset_evidence_verdicts`); null when no source ever gave one. */
  runVerdict: EvidenceState | null,
  /** When the test behind that verdict was made. */
  runAt: Date | null,
  /** When the row was last evaluated, which a replay advances without appending history. */
  evaluatedAt: Date | null,
}

/**
 * `applicable` from a run means the control failed the test and the attack got through,
 * `dismissed` from a run means it held.
 */
export const measuredVerdictOf = (runVerdict: EvidenceState): MeasuredVerdict =>
  (runVerdict === 'applicable' ? 'got_through' : 'held');

/**
 * The test result an evidence row carries, or null when it carries none.
 *
 * Only a logged test verdict counts. A state a person set is a decision, however recent it
 * is, and a reset handing control back to automation is an administrative act that no test
 * produced: crediting either would let a click change the score and refresh the validity window.
 *
 * Both dates matter: a transition appends history, a same-result replay only advances the
 * evaluation date, so the measurement is as recent as the later of the two.
 */
export const resolveMeasuredResult = (row: MeasuredRow): MeasuredResult | null => {
  if (row.runVerdict === null) {
    return null;
  }
  const dates = [row.evaluatedAt, row.runAt].filter((date): date is Date => date !== null);
  return {
    verdict: measuredVerdictOf(row.runVerdict),
    measuredAt: dates.length === 0 ? null : new Date(Math.max(...dates.map((date) => date.getTime()))),
  };
};

export const isFreshMeasurement = (
  measured: MeasuredResult,
  policy: MeasuredValidityPolicy,
  now: Date,
): boolean => {
  if (policy.measuredValidityDays === null) {
    return true;
  }
  if (measured.measuredAt === null) {
    return false;
  }
  const ageDays = (now.getTime() - measured.measuredAt.getTime()) / 86_400_000;
  return ageDays <= policy.measuredValidityDays;
};

const preventionResidual = (
  technique: TechniqueInReach,
): { value: number, terms: Omit<GettingThroughTerms, 'preventionLetThrough' | 'detectMu' | 'detectionCredit'> } => {
  // The cap belongs to the simulation layer, so it is applied here explicitly: the declared
  // residual is never below 0.03, however much a tenant declares.
  const declared = clampUnit(technique.declaredMu ?? 0);
  const capped = Math.min(declared, RESISTANCE_MU_CAP);
  return {
    value: 1 - capped,
    terms: {
      claimConfidence: technique.claimConfidence,
      declaredMu: capped,
      cappedResistance: declared > RESISTANCE_MU_CAP,
    },
  };
};

const techniqueResidual = (technique: TechniqueInReach): Omit<TechniquePath, 'techniqueId'> => {
  const prevention = preventionResidual(technique);
  const detectMu = clampUnit(technique.detectMu ?? 0);
  return {
    value: prevention.value * (1 - DETECTION_CREDIT * detectMu),
    terms: { ...prevention.terms, preventionLetThrough: prevention.value, detectMu, detectionCredit: DETECTION_CREDIT },
  };
};

/**
 * Controls stacked on one technique already accumulate inside its resistance, so the aggregation
 * only combines the techniques of the side.
 *
 * A technique on the side counts in full whatever its claim's confidence, which only picks, among
 * paths that let through as much, the one named as the weakest.
 */
export const controlsFactor = (
  techniques: ReadonlyArray<TechniqueInReach>,
  aggregation: ControlsAggregation,
): ControlsFactor => {
  const paths = techniques
    .map((technique) => ({ ...techniqueResidual(technique), techniqueId: technique.techniqueId }))
    .sort((left, right) => right.value - left.value
      || MAPPING_CONFIDENCE_VALUES.indexOf(left.terms.claimConfidence) - MAPPING_CONFIDENCE_VALUES.indexOf(right.terms.claimConfidence));
  const weakestPath = paths[0] ?? null;
  const value = weakestPath === null
    ? UNEVALUATED_LET_THROUGH
    : aggregation === 'weakest'
      ? weakestPath.value
      : paths.reduce((sum, path) => sum + path.value, 0) / paths.length;
  return { value, aggregation, weakestPath, paths };
};

/**
 * What the asset is worth, narrowed by how much of it the flaw actually reaches, before any control.
 *
 * The criticality answers what a total loss of this asset costs, and the vector's impact metrics
 * answer how much of that total this flaw takes: an availability-only flaw on the payroll database
 * costs less than the database going away.
 */
export const potentialImpactFactor = (
  criticality: AssetCriticality,
  cvss: CvssContributions | null,
  unknownCountsAs: DeclaredCriticality,
): PotentialImpactFactor => {
  const countedAs = countedCriticality(criticality, unknownCountsAs);
  const criticalityFactor = CRITICALITY_COST_FACTORS[countedAs];
  return {
    value: criticalityFactor * (cvss?.impact ?? 1),
    terms: { criticalityCountedAs: countedAs, criticalityFactor, cvssImpact: cvss?.impact ?? null },
  };
};

// ─── Composition ───────────────────────────────────────────────────────────────

/** A part or a score on 0 to 1, as the 0 to 100 figure a screen prints. */
export const partFigure = (value: number): number => truncateScore(100 * clampUnit(value));

/**
 * `score = trunc(100 x sqrt(exploitability x impact))`.
 *
 * Exploitability then impact are conditions in series, so neither may compensate the other: the
 * score is zero when either part is. A root over exactly two terms never moves with how many
 * factors were read, and always lands between its two parts.
 */
export const composeParts = (exploitability: number, impact: number): CompositionTerms => {
  const e = clampUnit(exploitability);
  const i = clampUnit(impact);
  const product = e * i;
  const raw = 100 * Math.sqrt(product);
  return { exploitability: e, impact: i, product, raw, score: truncateScore(raw) };
};

export const resolveLimitingTerm = (terms: Record<ScoreTermKey, number>, exploitability: number, impact: number): ScoreTermKey => (
  exploitability <= impact
    ? (terms.exploitationControls < terms.reachabilityAndThreat ? 'exploitationControls' : 'reachabilityAndThreat')
    : (terms.impactControls < terms.potentialImpact ? 'impactControls' : 'potentialImpact')
);

export const computeFindingScore = (
  input: FindingScoreInput,
  policy: FindingScorePolicy,
): FindingScore => {
  const reachability = reachabilityFactor(input.exposure, input.cvss, policy);
  const threat = threatFactor(input.threat, input.cvss);
  const exploitationControls = controlsFactor(input.exploitationTechniques, 'weakest');
  const potentialImpact = potentialImpactFactor(input.criticality, input.cvss, policy.unknownCriticalityCountsAs);
  const impactControls = controlsFactor(input.impactTechniques, 'mean');

  // Reachability and threat both say whether an attempt lands, so they are averaged, not stacked.
  const reachabilityAndThreat = (reachability.value + threat.value) / 2;
  const exploitability = reachabilityAndThreat * exploitationControls.value;
  const impact = potentialImpact.value * impactControls.value;
  const composition = composeParts(exploitability, impact);

  return {
    score: composition.score,
    band: resolveSeverityBand(composition.score),
    factors: { reachability, threat, exploitationControls, potentialImpact, impactControls },
    reachabilityAndThreat,
    exploitability: composition.exploitability,
    impact: composition.impact,
    composition,
    limitingTerm: resolveLimitingTerm({
      reachabilityAndThreat,
      exploitationControls: exploitationControls.value,
      potentialImpact: potentialImpact.value,
      impactControls: impactControls.value,
    }, exploitability, impact),
  };
};
