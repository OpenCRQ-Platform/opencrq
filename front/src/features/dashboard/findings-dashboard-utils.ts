const FINDINGS_FLOW_WINDOWS = [30, 90] as const;
export type FindingsFlowWindow = typeof FINDINGS_FLOW_WINDOWS[number];
export const DEFAULT_FINDINGS_FLOW_WINDOW: FindingsFlowWindow = 90;

/** Share of a population carrying at least one finding. Null when the population is empty. */
export const impactedShare = (impactedCount: number, totalCount: number): number | null =>
  totalCount === 0 ? null : impactedCount / totalCount;

export interface SeverityDistributionLike {
  critical: number,
  high: number,
  medium: number,
  low: number,
  none: number,
  unscored: number,
}

export type SeverityBucketKey = keyof SeverityDistributionLike;

const SEVERITY_BUCKET_ORDER: Array<SeverityBucketKey> = ['critical', 'high', 'medium', 'low', 'none', 'unscored'];

export interface SeveritySegment {
  bucket: SeverityBucketKey,
  count: number,
  /** Fraction of the whole, for a proportional bar. */
  share: number,
}

/**
 * The severity distribution as shares as well as counts, in fixed severity order.
 *
 * A count on its own is the vanity form of this metric: "312 critical" says nothing without the
 * total, and the ratio between the two is what says whether triage is on top of the queue.
 */
export const buildSeverityMix = (
  distribution: SeverityDistributionLike,
): { segments: Array<SeveritySegment>, total: number } => {
  const total = SEVERITY_BUCKET_ORDER.reduce((sum, bucket) => sum + distribution[bucket], 0);
  return {
    total,
    segments: SEVERITY_BUCKET_ORDER
      .map((bucket) => ({ bucket, count: distribution[bucket], share: total === 0 ? 0 : distribution[bucket] / total }))
      .filter((segment) => segment.count > 0),
  };
};
