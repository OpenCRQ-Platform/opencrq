import type { SeverityBand } from './bands';

/**
 * The seven figures the findings header prints, as they are keyed in `finding_metric_daily`.
 *
 * The four band metrics are recorded by the recompute because they cannot be recovered afterwards:
 * `finding_scores` holds one row per finding and every run overwrites the previous banding. The
 * three volume metrics are reconstructed from the evidence history instead, so a row of one of
 * them is a cache of a replay and never the only trace of a past.
 */
export const FINDING_METRIC_KEYS = [
  'findings',
  'impacted_assets',
  'new_in_window',
  'band_critical',
  'band_high',
  'band_medium',
  'band_low',
] as const;

export type FindingMetricKey = (typeof FINDING_METRIC_KEYS)[number];

export const BAND_METRIC_KEYS: Record<SeverityBand, FindingMetricKey> = {
  critical: 'band_critical',
  high: 'band_high',
  medium: 'band_medium',
  low: 'band_low',
};

/** `finding_metric_daily.day` is a UTC calendar day, and Postgres renders a `date` as `YYYY-MM-DD`. */
export const utcDayOf = (instant: Date): string => instant.toISOString().slice(0, 10);
