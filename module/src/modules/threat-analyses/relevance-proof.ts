import { DEFAULT_RELATION_CONFIDENCE } from './constants';
import { computeRelevance, effectiveOutcomeWeight } from './outcome-counter/outcome-weight';

/** One stored claim, exactly as its producer stated it. Never summarized and never merged. */
export interface ClaimEvidence {
  stixRelationId: string,
  producerStixId: string | null,
  producerName: string | null,
  isInferred: boolean,
  relConfidence: number | null,
  relCreated: Date | null,
  relStartTime: Date | null,
  relStopTime: Date | null,
  relModified: Date | null,
  openctiStixRelationId: string | null,
}

/** A country or sector claim: the same evidence plus the value the producer named. */
export interface DimensionClaimEvidence extends ClaimEvidence {
  name: string,
}

export interface TargetingExplanation {
  matched: boolean,
  /**
   * The organization value this dimension matched on, named by the same predicate that decided the
   * match: a claim on a city carries the country it sits in, and matches while a name comparison
   * against the targeted city names does not.
   */
  matchedValue: string | null,
  /** The organization's own value for this dimension, matched or not: null when it states none. */
  organizationValue: string | null,
  claims: Array<DimensionClaimEvidence>,
}

export interface RelevanceExplanation {
  score: number,
  country: TargetingExplanation,
  sector: TargetingExplanation,
}

/**
 * Strength order of the claims behind one dimension, owned here so every surface reads them the
 * same way: stated confidence descending, a stated confidence ahead of an unstated one read at the
 * same value, then producer entry date descending. The relation identifier breaks a full tie so two
 * reads of unchanged data cannot order the same claims differently.
 */
export const compareClaimsByStrength = (first: ClaimEvidence, second: ClaimEvidence): number => {
  const firstConfidence = first.relConfidence ?? DEFAULT_RELATION_CONFIDENCE;
  const secondConfidence = second.relConfidence ?? DEFAULT_RELATION_CONFIDENCE;
  if (firstConfidence !== secondConfidence) {
    return secondConfidence - firstConfidence;
  }
  if ((first.relConfidence === null) !== (second.relConfidence === null)) {
    return first.relConfidence === null ? 1 : -1;
  }
  return ((second.relCreated?.getTime() ?? 0) - (first.relCreated?.getTime() ?? 0))
    || first.stixRelationId.localeCompare(second.stixRelationId);
};

const explainTargeting = (params: {
  matched: boolean,
  name?: string | null,
  claims: Array<DimensionClaimEvidence>,
}): TargetingExplanation => ({
  matched: params.matched,
  matchedValue: params.matched ? params.name ?? null : null,
  organizationValue: params.name ?? null,
  claims: [...params.claims].sort(compareClaimsByStrength),
});

/**
 * The proof's relevance: the same `computeRelevance` the lists use, with what each targeting
 * dimension matched on. A null `probability` is a threat nothing was stored for.
 */
export const explainRelevance = (params: {
  probability: number | null,
  evidenceSufficient: boolean,
  countryMatch: boolean,
  sectorMatch: boolean,
  countryClaims: Array<DimensionClaimEvidence>,
  sectorClaims: Array<DimensionClaimEvidence>,
  countryName?: string | null,
  sectorName?: string | null,
}): RelevanceExplanation => ({
  score: computeRelevance({
    weight: effectiveOutcomeWeight({ probability: params.probability ?? 0, evidenceSufficient: params.evidenceSufficient }),
    countryMatch: params.countryMatch,
    sectorMatch: params.sectorMatch,
  }),
  country: explainTargeting({ matched: params.countryMatch, name: params.countryName, claims: params.countryClaims }),
  sector: explainTargeting({ matched: params.sectorMatch, name: params.sectorName, claims: params.sectorClaims }),
});
