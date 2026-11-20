import { combineSignalWeights } from './signal-weights';

/**
 * Recency-based activity scoring for threat analyses.
 *
 * A dormant threat is of little defensive interest — this module turns the temporal
 * signals already in the database (relationship dates on the child collections + the threat's own
 * `last_seen ?? first_seen`) into a continuous [0, 1) activity score. The formula is pure and injected
 * with `now`; the recompute job feeds it and stores what it returns on the actor.
 *
 * Model: exponential decay with a 90-day half-life. Each distinct activity DAY (UTC) is a
 * signal weighted by `ACTIVITY_SIGNAL_BASE_WEIGHT * 2^(-ageDays / halfLife)`, combined via the
 * noisy-OR (`combineSignalWeights`): `1 - Π(1 - w_d)`.
 *
 * Intent: the score measures how operationally active the threat ITSELF is, not how
 * intensely CTI producers report on it, so only a date a producer stated as an observation window
 * feeds it. A knowledge-base authoring date is the day a record entered a platform, so admitting it
 * would rank actors by ingestion cadence. Any change must keep measuring group activity, never
 * reporting strength.
 */

/** `actor` is the threat's own `last_seen ?? first_seen` as one source stated it, not a claim about it. */
export type ActivityAnchorKind = 'location' | 'sector' | 'cve' | 'technique' | 'actor';

/**
 * Grade of the temporal anchor behind an activity date: `observed` when a relationship carried a
 * real activity window (stop/start time), `authored` when only the knowledge-base creation date
 * was available, `none` when there is no temporal signal at all.
 */
export type AnchorProvenance = 'observed' | 'authored' | 'none';

/**
 * Discriminated on `provenance` so the impossible states (a graded anchor with no date, a dated
 * anchor graded `none`) are unrepresentable rather than defended against downstream.
 */
export type ActivityAnchor =
  | { date: Date, provenance: 'observed' | 'authored' }
  | { date: null, provenance: 'none' };

export interface ActivityAssessment {
  /** `null` when no anchor is dated: an unknown activity is not a zero one. */
  activityScore: number | null,
  lastActivityAt: Date | null,
  anchorProvenance: AnchorProvenance,
}

const MS_PER_DAY = 86_400_000;

// Algorithm tuning constants (not tenant-configurable for now — a future `threat-relevance-settings`
// style tenant setting could promote these).
export const ACTIVITY_HALF_LIFE_DAYS = 90;
export const ACTIVITY_SIGNAL_BASE_WEIGHT = 0.35;

// UTC-day floor as an epoch millisecond value — a bundle upload stamps every relationship on the
// same day, so anchoring weights to the day (not the instant) keeps the score independent of the
// number of relationships in the bundle.
const startOfUtcDayMs = (date: Date): number => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

/**
 * A date read as of `now`: one a source places later, as a producer dating an actor "active this
 * year" by December 31st does, reads as `now`, since nothing is observed ahead of the clock.
 */
export const notAfter = <T extends Date | null>(date: T, now: Date): T | Date =>
  (date !== null && date > now ? now : date);

/**
 * Recency anchor for a single child relationship: prefer the observed stop time, then the start
 * time, then the relationship creation date, and report which of the two grades won.
 * `relModified` is intentionally ignored (analyst edit noise); a relationship carrying no
 * temporal signal at all resolves to a null date with the `none` grade.
 */
export const resolveActivityAnchor = (
  rel: { relCreated: Date | null, relStartTime: Date | null, relStopTime: Date | null },
): ActivityAnchor => {
  const observed = rel.relStopTime ?? rel.relStartTime ?? null;
  if (observed !== null) {
    return { date: observed, provenance: 'observed' };
  }
  return rel.relCreated !== null
    ? { date: rel.relCreated, provenance: 'authored' }
    : { date: null, provenance: 'none' };
};

/**
 * Rebuilds the graded anchor behind an assessment, which is what the attacker mixture consumes as
 * `rho`'s input. Reading it back off the assessment (rather than re-selecting the anchors) keeps
 * every surface that shows an activity badge and the CRQ weight on the very same date and grade.
 */
export const assessmentActivityAnchor = (assessment: ActivityAssessment): ActivityAnchor =>
  (assessment.lastActivityAt === null || assessment.anchorProvenance === 'none'
    ? { date: null, provenance: 'none' }
    : { date: assessment.lastActivityAt, provenance: assessment.anchorProvenance });

export interface ActivityColumns {
  lastObservedAt: Date | null,
  lastAuthoredAt: Date | null,
  activityScore: number | null,
}

/**
 * The date is the later of the two columns and its grade the column it came from, observed winning
 * a tie. That pair is the engine's anchor and stays blended on purpose.
 */
export const assessmentFromActivityColumns = (row: ActivityColumns): ActivityAssessment => {
  const activityScore = row.lastObservedAt === null ? null : row.activityScore;
  if (row.lastObservedAt === null && row.lastAuthoredAt === null) {
    return { activityScore, lastActivityAt: null, anchorProvenance: 'none' };
  }
  const observedWins = row.lastObservedAt !== null
    && (row.lastAuthoredAt === null || row.lastObservedAt.getTime() >= row.lastAuthoredAt.getTime());
  return observedWins
    ? { activityScore, lastActivityAt: row.lastObservedAt, anchorProvenance: 'observed' }
    : { activityScore, lastActivityAt: row.lastAuthoredAt, anchorProvenance: 'authored' };
};

/** The factor a threat's activity contributes to its score: never 0, and an unknown activity weighs the floor of an activity `unknownActivityAgeDays` old. */
export const activityWeightFor = (
  row: { lastObservedAt: Date | null, activityScore: number | null },
  unknownActivityAgeDays: number,
): number => (row.lastObservedAt !== null && row.activityScore !== null
  ? row.activityScore
  : ACTIVITY_SIGNAL_BASE_WEIGHT * 2 ** (-unknownActivityAgeDays / ACTIVITY_HALF_LIFE_DAYS));

/** Known activity before unknown, the most active first; two unknown activities tie. */
export const compareActivityUnknownLast = (a: number | null, b: number | null): number => {
  if (a === null || b === null) {
    return Number(a === null) - Number(b === null);
  }
  return b - a;
};

/**
 * Computes the activity assessment from a set of activity anchors (undated ones are ignored).
 * `now` is injected so the function stays pure and deterministic. `anchorProvenance` describes
 * the anchor behind `lastActivityAt`, with observed winning over authored on an exact tie.
 */
export const computeActivityAssessment = (
  anchors: Array<ActivityAnchor>,
  now: Date,
): ActivityAssessment => {
  const datedAnchors = anchors.filter((anchor) => anchor.provenance !== 'none');
  if (datedAnchors.length === 0) {
    return { activityScore: null, lastActivityAt: null, anchorProvenance: 'none' };
  }

  const nowMs = now.getTime();

  // One signal per distinct UTC day — deduplicates the bundle-upload burst so the score reflects
  // recency, not bundle size.
  const distinctDayStarts = new Set(datedAnchors.map((anchor) => startOfUtcDayMs(anchor.date)));
  const weights = [...distinctDayStarts].map((dayStartMs) => {
    const ageDays = Math.max(0, (nowMs - dayStartMs) / MS_PER_DAY);
    return ACTIVITY_SIGNAL_BASE_WEIGHT * 2 ** (-ageDays / ACTIVITY_HALF_LIFE_DAYS);
  });
  const activityScore = combineSignalWeights(weights);

  const lastActivityMs = Math.max(...datedAnchors.map((anchor) => anchor.date.getTime()));
  const latestAnchors = datedAnchors.filter((anchor) => anchor.date.getTime() === lastActivityMs);
  const anchorProvenance: AnchorProvenance = latestAnchors.some((anchor) => anchor.provenance === 'observed')
    ? 'observed'
    : 'authored';

  const lastActivityAt = new Date(lastActivityMs);

  return { activityScore, lastActivityAt, anchorProvenance };
};
