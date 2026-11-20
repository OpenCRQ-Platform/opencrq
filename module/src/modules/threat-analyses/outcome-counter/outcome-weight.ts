/** A percentage at or below this does not make a threat lead to the outcome. */
export const OUTCOME_WEIGHT_THRESHOLD = 0.5;

/**
 * Targeting is multiplicative and floorless: a country match multiplies by 2.5, a sector match by
 * 4, both by 10. Multiplying the factors keeps the documented {1, 2.5, 4, 10} exact instead of
 * landing a few ulp away through `exp`/`log`.
 */
export const TAU_COUNTRY_FACTOR = 2.5;
export const TAU_SECTOR_FACTOR = 4;

/** The tau of a group matching both country and sector: the divisor that brings a relevance into [0, 1]. */
export const MAX_TAU = TAU_COUNTRY_FACTOR * TAU_SECTOR_FACTOR;

export const computeTau = (group: { countryMatch: boolean, sectorMatch: boolean }): number =>
  (group.countryMatch ? TAU_COUNTRY_FACTOR : 1) * (group.sectorMatch ? TAU_SECTOR_FACTOR : 1);

/** ((p - t) / (1 - t))^2 above t, 0 at or below it. */
export const outcomeWeight = (probability: number): number => {
  if (probability <= OUTCOME_WEIGHT_THRESHOLD) {
    return 0;
  }
  return ((probability - OUTCOME_WEIGHT_THRESHOLD) / (1 - OUTCOME_WEIGHT_THRESHOLD)) ** 2;
};

/** The weight a threat carries on one outcome: 0 when its record lacks minimum evidence. */
export const effectiveOutcomeWeight = (params: { probability: number, evidenceSufficient: boolean }): number =>
  params.evidenceSufficient ? outcomeWeight(params.probability) : 0;

/** weight × tau / MAX_TAU, in [0, 1]. */
export const computeRelevance = (params: { weight: number, countryMatch: boolean, sectorMatch: boolean }): number =>
  (params.weight * computeTau(params)) / MAX_TAU;

/**
 * Floors of the bands a stored outcome score (the counter's probability, or a judged one) is read in
 * on the threat list's badge and its KPI band: a probability at or above `STRONG_OUTCOME_MATCH_SCORE`
 * reads strong.
 */
export const STRONG_OUTCOME_MATCH_SCORE = 0.6;
export const MODERATE_OUTCOME_MATCH_SCORE = 0.3;
