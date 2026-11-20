import { computeTau, effectiveOutcomeWeight, TAU_COUNTRY_FACTOR, TAU_SECTOR_FACTOR } from '@app/module/client';

/**
 * Client-side paging for the proof panel's claim lists. `DataTable`'s own rows-per-page menu is
 * hardcoded to `[50, 100, 200, 300, 500]`, so a default of ten would render that radio group with
 * no item checked and no way back to a listed value.
 */
export const CLAIM_PAGE_SIZES = [10, 25, 50];

export const DEFAULT_CLAIM_PAGE_SIZE = 10;

const SMALLEST_CLAIM_PAGE_SIZE = Math.min(...CLAIM_PAGE_SIZES);

/** Its own id, so the claim lists never inherit a page size persisted by a data table. */
export const CLAIM_LIST_TABLE_ID = 'relevanceProofClaims';

export interface ClaimPageWindow {
  pageIndex: number,
  pageCount: number,
  /** 1-based, and zero when the list is empty, so the range reads as a sentence. */
  from: number,
  to: number,
  total: number,
  /** A list that fits on one page is read whole; a control over it would be furniture. */
  hasControl: boolean,
}

export const resolveClaimPage = (total: number, pageSize: number, requestedPageIndex: number): ClaimPageWindow => {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const pageIndex = Math.min(Math.max(requestedPageIndex, 0), pageCount - 1);
  return {
    pageIndex,
    pageCount,
    from: total === 0 ? 0 : pageIndex * pageSize + 1,
    to: Math.min(total, (pageIndex + 1) * pageSize),
    total,
    // A persisted page size larger than the default must stay reachable even on a list it no
    // longer outgrows, or lowering it back becomes impossible.
    hasControl: total > SMALLEST_CLAIM_PAGE_SIZE || pageSize !== DEFAULT_CLAIM_PAGE_SIZE,
  };
};

export type RelevanceBandKind = 'strong' | 'moderate' | 'weak';

/**
 * Band thresholds are ours, not the engine's: the engine only produces a continuous relevance, and
 * banding it at all is a reading decision. They live here so every surface that bands relevance
 * reads the same two numbers, and so the boundaries stay testable without React.
 *
 * A sure threat scores 10 untargeted, 25 on the country, 40 on the sector and 100 on both, so each
 * threshold sits between two of those ceilings: strong takes both targetings, moderate one, weak none.
 */
export const STRONG_RELEVANCE_THRESHOLD = 50;
export const MODERATE_RELEVANCE_THRESHOLD = 15;

export const toRelevancePercent = (combinedRelevance: number): number => Math.round(combinedRelevance * 100);

export const resolveRelevanceBand = (relevancePercent: number): RelevanceBandKind => {
  if (relevancePercent >= STRONG_RELEVANCE_THRESHOLD) {
    return 'strong';
  }
  return relevancePercent >= MODERATE_RELEVANCE_THRESHOLD ? 'moderate' : 'weak';
};

/**
 * The table's leading figure and the proof panel's gauge read this one function, so the number the
 * reader sorted on is the number the panel opens onto.
 */
export const composeThreatScore = (combinedRelevance: number, activityWeight: number): number => Math.round(combinedRelevance * activityWeight * 100);

/** The unrounded product, because two threats of different relevance can share the same displayed integer. */
export const threatScoreSortKey = (combinedRelevance: number, activityWeight: number): number => combinedRelevance * activityWeight;

export type ThreatScoreFactor = 'relevance' | 'activity';

/** The factor that caps a product of two: the lower one, relevance on a tie. */
export const resolveLimitingThreatScoreFactor = (combinedRelevance: number, activityWeight: number): ThreatScoreFactor => (
  combinedRelevance <= activityWeight ? 'relevance' : 'activity'
);

/** What was stored for a threat on one outcome: null when no percentage was. */
interface OutcomeAssessment {
  probability: number | null,
  evidenceSufficient: boolean,
}

/** Whether the threat counts toward the outcome: above the threshold, on a record with enough evidence. */
export const weighsOnOutcome = ({ probability, evidenceSufficient }: OutcomeAssessment): boolean =>
  effectiveOutcomeWeight({ probability: probability ?? 0, evidenceSufficient }) > 0;

/**
 * The terms the relevance multiplies, so the score explanation quotes the engine's own factors:
 * relevance = model weight × targeting factor ÷ the largest targeting factor.
 */
export const breakRelevanceDown = (params: OutcomeAssessment & { countryMatch: boolean, sectorMatch: boolean }) => ({
  modelWeight: effectiveOutcomeWeight({ probability: params.probability ?? 0, evidenceSufficient: params.evidenceSufficient }),
  countryFactor: params.countryMatch ? TAU_COUNTRY_FACTOR : 1,
  sectorFactor: params.sectorMatch ? TAU_SECTOR_FACTOR : 1,
  targetingFactor: computeTau(params),
});
