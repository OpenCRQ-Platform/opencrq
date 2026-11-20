import type { SeverityBand } from '@app/module/client';
import { formatNumber } from '../../utils/format-number';

export interface BandCounts {
  total: number,
  /** Findings sitting in the band today that were first seen inside the window. */
  newInWindow: number,
}

/**
 * The past the panel cannot fold out of the findings it already loaded, as the finding-score
 * router states it.
 */
export interface FindingBaselines {
  /**
   * The instant the server replayed these figures at. The live counts must fold against it and
   * never against a boundary taken locally, which would drift away from it on every render while
   * the cached baselines stayed put.
   */
  windowStart: string | Date,
  findingsStockBefore: number,
  impactedAssetsStockBefore: number,
  newInPreviousWindow: number,
}

export interface ServerBandCount {
  band: SeverityBand,
  total: number,
  newInWindow: number,
}

export interface FindingsPanelCounts {
  findings: number,
  impactedAssets: number,
  newInWindow: number,
  estateAssetCount: number,
  bands: ReadonlyArray<ServerBandCount>,
  pendingVector: number,
}

export interface UniqueFindingsPanelCounts {
  uniqueFindings: number,
  techniqueGroups: number,
  newInWindow: number,
  bands: ReadonlyArray<ServerBandCount>,
  baselines: {
    cveGroupsBefore: number,
    bandsBefore: ReadonlyArray<{ band: SeverityBand, total: number }>,
    newInPreviousWindow: number | null,
  } | null,
}

export interface UniqueFindingsTrends {
  cveGroups: number | null,
  newInWindow: number | null,
  bands: Record<SeverityBand, number | null>,
}

/** Technique groups never count: they carry no journal. */
export const resolveUniqueFindingsTrends = (counts: UniqueFindingsPanelCounts): UniqueFindingsTrends => {
  const { baselines } = counts;
  const byBand = toBandCounts(counts.bands);
  const bandDelta = (band: SeverityBand): number | null => (baselines === null
    ? null
    : byBand[band].total - (baselines.bandsBefore.find((row) => row.band === band)?.total ?? 0));
  return {
    cveGroups: baselines === null ? null : counts.uniqueFindings - counts.techniqueGroups - baselines.cveGroupsBefore,
    newInWindow: baselines === null || baselines.newInPreviousWindow === null ? null : counts.newInWindow - baselines.newInPreviousWindow,
    bands: { critical: bandDelta('critical'), high: bandDelta('high'), medium: bandDelta('medium'), low: bandDelta('low') },
  };
};

const emptyBandCounts = (): Record<SeverityBand, BandCounts> => ({
  critical: { total: 0, newInWindow: 0 },
  high: { total: 0, newInWindow: 0 },
  medium: { total: 0, newInWindow: 0 },
  low: { total: 0, newInWindow: 0 },
});

/** A band with no finding is absent from a `group by`, and a card drawn off a missing key reads as unknown. */
export const toBandCounts = (bands: ReadonlyArray<ServerBandCount>): Record<SeverityBand, BandCounts> => {
  const byBand = emptyBandCounts();
  for (const row of bands) {
    byBand[row.band] = { total: row.total, newInWindow: row.newInWindow };
  }
  return byBand;
};

export type TrendDirection = 'worse' | 'better' | 'flat';

/**
 * More findings is bad news, so the arithmetic sign and the feedback hue are inverted against a
 * growth dashboard: a rise is `worse`.
 */
export const resolveTrendDirection = (delta: number): TrendDirection => {
  if (delta > 0) {
    return 'worse';
  }
  return delta < 0 ? 'better' : 'flat';
};

/** Lowest count the face abbreviates, which is also where the tooltip starts carrying the exact figure. */
export const COUNT_ABBREVIATION_FLOOR = 10_000;

export const isCountAbbreviated = (value: number): boolean => value >= COUNT_ABBREVIATION_FLOOR;

export const formatPanelCount = (value: number, locale: string): string =>
  (isCountAbbreviated(value)
    ? new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
    : formatNumber(value, locale));

export const formatSignedDelta = (delta: number, locale: string): string =>
  new Intl.NumberFormat(locale, { signDisplay: 'exceptZero' }).format(delta);
