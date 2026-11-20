export const REVENUE_BAND_VALUES = ['under_10m', '10m_100m', '100m_1b', '1b_10b', '10b_100b', 'over_100b'] as const;
export type RevenueBand = typeof REVENUE_BAND_VALUES[number];

/**
 * Which estate a risk scope is measured over: `open` the whole tenant estate, `closed` the assets
 * mapped into the scope.
 */
export const ESTATE_MODE_VALUES = ['open', 'closed'] as const;
export type EstateMode = typeof ESTATE_MODE_VALUES[number];

/** The identity a scope's journal follows, its three reaction times as one `reactionTime` field. */
export const ORGANIZATION_IDENTITY_FIELDS = [
  'name',
  'description',
  'legalEntityName',
  'domain',
  'sectorId',
  'countryId',
  'employeeCount',
  'reactionTime',
] as const;
export type OrganizationIdentityField = typeof ORGANIZATION_IDENTITY_FIELDS[number];

/** How many of its latest events each journal of a scope serves. */
export const SCOPE_EVENTS_LIMIT = 200;

export const ASSET_MAPPING_CHANGES = ['added', 'removed'] as const;
export type AssetMappingChange = typeof ASSET_MAPPING_CHANGES[number];

/**
 * How many assets one save may add to, or remove from, a scope's estate. A closed scope maps far
 * more than this; what is bounded is the delta a single request carries, which must fit the body
 * limit and the bind parameters the statements behind it hold.
 */
export const MAX_SCOPE_MAPPING_IDS = 5000;

/**
 * Maps a yearly revenue in USD to its band, lower bound included and upper bound excluded.
 */
export const deriveRevenueBand = (revenue: number): RevenueBand => {
  if (revenue < 10_000_000) {
    return 'under_10m';
  }
  if (revenue < 100_000_000) {
    return '10m_100m';
  }
  if (revenue < 1_000_000_000) {
    return '100m_1b';
  }
  if (revenue < 10_000_000_000) {
    return '1b_10b';
  }
  if (revenue < 100_000_000_000) {
    return '10b_100b';
  }
  return 'over_100b';
};

const REVENUE_BAND_MIDPOINT_USD: Record<RevenueBand, number> = {
  under_10m: 5_000_000,
  '10m_100m': 31_622_777,
  '100m_1b': 316_227_766,
  '1b_10b': 3_162_277_660,
  '10b_100b': 31_622_776_602,
  over_100b: 150_000_000_000,
};

/**
 * Geometric mean of each band's bounds, matching the driver-derivation kernel's
 * `MAGNITUDE_BAND_MIDPOINT` convention; the open-ended bottom and top bands use half the upper
 * bound and 1.5x the lower bound respectively.
 */
export const revenueBandMidpoint = (band: RevenueBand): number => REVENUE_BAND_MIDPOINT_USD[band];

/** The annual loss distribution keeps no level beyond 0.999, so no smaller maximum probability can be read against it. */
export const MIN_TOLERANCE_EXCEEDANCE_PROBABILITY = 0.001;

/** The highest probability of the year's loss exceeding `annualLoss` the organisation accepts. */
export interface RiskTolerance {
  annualLoss: number,
  maxExceedanceProbability: number,
}

export interface ScopeRiskTolerance {
  tolerance: RiskTolerance | null,
  scenarioCount: number,
  /** The scope's scenarios setting their own threshold, which the scope's never reaches. */
  ownThresholdCount: number,
}
