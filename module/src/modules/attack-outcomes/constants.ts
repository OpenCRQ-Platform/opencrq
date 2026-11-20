/**
 * Structural gate of the inferred set: a technique nobody curated on the outcome enters the CRQ
 * simulation only when it is corroborated by at least this many distinct deduplicated actors of the
 * mixture, carries at least this much repertoire share, and ranks in the top N by weight.
 *
 * The weight floor is not redundant with the group count: an ingested catalog rich enough to put ten
 * heavily played inferred techniques in the set lets them drive vulnerability on their own, while
 * the curated set is meant to stay the analyst-owned description of the outcome.
 */
export const INFERRED_MIN_GROUPS = 2;
export const INFERRED_MIN_WEIGHT = 0.3;
export const INFERRED_MAX_COUNT = 10;

/**
 * Fallback weights when no relevant threat is admitted for the outcome (`evidenceMode`
 * `no-relevant-threats`). There is no mixture to normalize, so these are flat editorial levels, not
 * shares: they exist so a tenant with no usable CTI still gets a CRQ run whose vulnerability moves
 * with control investment, instead of losing the run outright.
 */
export const NO_EVIDENCE_SIGNATURE_WEIGHT = 0.5;
export const NO_EVIDENCE_RELATED_WEIGHT = 0.2;
