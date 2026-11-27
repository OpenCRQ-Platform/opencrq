import type { CoverageBucket, StrengthRung } from './constants';

/** The catalogue capability recurring vulnerability scans evidence (opencrq #332). */
export const SCAN_EVIDENCED_CAPABILITY_EXTERNAL_ID = 'PATCH';

/** The source a scan reading is listed under on an assessment. */
export const OPENAEV_SCAN_SOURCE = 'openaev_scans';

/**
 * How far back a scan still counts as recent. OpenAEV does not serve the scenario's recurrence on
 * the attack stream, so the window is the longest usual cadence (monthly) with slack for a late run.
 */
export const SCAN_RECENCY_DAYS = 35;

/** What the scan measurements of the tenant say, as `countScanCoverage` reads them. */
export interface ScanCoverage {
  known: number,
  scanned: number,
  recent: number,
  recentClean: number,
}

export interface ScanCapabilityReading {
  capabilityId: string,
  strengthRung: StrengthRung,
  coverageBucket: CoverageBucket,
}

/** The share of the known assets a recent scan reached, onto the four buckets. */
const bucketOfShare = (share: number): CoverageBucket => {
  if (share >= 0.8) {
    return 'L3';
  }
  if (share >= 0.5) {
    return 'L2';
  }
  if (share > 0) {
    return 'L1';
  }
  return 'L0';
};

/**
 * The patch management reading the recurring scans give, or null while no recent scan exists: an
 * axis only the scans fed is then cleared by the derivation, like one only an assessment fed, so a
 * scanner that stopped leaves the capability unassessed rather than frozen at its last value.
 *
 * Coverage is the share of the assets OpenAEV knows that a scan reached within the recency window.
 * Strength is what the scans prove of the patching: L2 when at least four in five recently scanned
 * assets came back clean, L1 otherwise (a scan that found something still proves the process is
 * measured, not that it holds). L3 is never read from scans alone.
 */
export const readScanCapability = (capabilityId: string, coverage: ScanCoverage): ScanCapabilityReading | null => {
  if (coverage.recent === 0) {
    return null;
  }
  const denominator = Math.max(coverage.known, coverage.recent);
  return {
    capabilityId,
    strengthRung: coverage.recentClean / coverage.recent >= 0.8 ? 'L2' : 'L1',
    coverageBucket: bucketOfShare(coverage.recent / denominator),
  };
};
