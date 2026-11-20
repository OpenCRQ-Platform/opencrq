import type { SQLWrapper } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

export const CVSS_SEVERITY_LEVELS = ['critical', 'high', 'medium', 'low', 'none'] as const;

export type CvssSeverityLevel = (typeof CVSS_SEVERITY_LEVELS)[number];

/** A CVSS score outside 0..10, and a missing one, are both unrated rather than a severity. */
export type CvssSeverityBucket = CvssSeverityLevel | 'unscored';

export const getCvssSeverityLevel = (score: number | null): CvssSeverityLevel | null => {
  if (score === null || !Number.isFinite(score) || score < 0 || score > 10) {
    return null;
  }
  if (score >= 9.0) {
    return 'critical';
  }
  if (score >= 7.0) {
    return 'high';
  }
  if (score >= 4.0) {
    return 'medium';
  }
  if (score >= 0.1) {
    return 'low';
  }
  return 'none';
};

/**
 * The same thresholds as `getCvssSeverityLevel`, for a caller that buckets in the database.
 *
 * `> 10` also catches a stored NaN, which Postgres sorts above every number, matching the
 * `Number.isFinite` guard above.
 */
export const cvssSeverityBucketSql = (cvss: SQLWrapper) => sql<CvssSeverityBucket>`case
  when ${cvss} is null or ${cvss} < 0 or ${cvss} > 10 then 'unscored'
  when ${cvss} >= 9.0 then 'critical'
  when ${cvss} >= 7.0 then 'high'
  when ${cvss} >= 4.0 then 'medium'
  when ${cvss} >= 0.1 then 'low'
  else 'none'
end`;
