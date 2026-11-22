import type { AssetCategory, AssetSourceOrigin } from '../supporting-assets/constants';
import { identityFamilyOf } from '../supporting-assets/identity-families';

/**
 * Where the evidence behind one in-scope supporting asset stands, worst first. A gap never reads as
 * safe: an asset nobody measures, or nobody measured recently, is named, not left silent.
 *
 * - `no_source`: no source reports the asset at all.
 * - `attested_only`: only a person's hand entry stands behind it, no connector.
 * - `never_measured`: a connector reports it, but no source or test ever dated an observation.
 * - `expired`: the newest observation is older than the re-test delay.
 * - `version_unknown`: measured recently, but a machine whose operating system version no source reports.
 * - `current`: measured within the delay.
 */
export const EVIDENCE_HEALTH_STATES = ['no_source', 'attested_only', 'never_measured', 'expired', 'version_unknown', 'current'] as const;
export type EvidenceHealthState = (typeof EVIDENCE_HEALTH_STATES)[number];

/** One source standing behind an asset: who it is and when it last dated an observation. */
export interface EvidenceHealthSource {
  connectorId: string | null,
  origin: AssetSourceOrigin,
  lastSeenAt: Date | null,
}

export interface EvidenceHealthInput {
  categoryId: AssetCategory,
  sources: ReadonlyArray<EvidenceHealthSource>,
  /** The newest test verdict on any of the asset's findings, which is a measurement too. */
  lastVerdictAt: Date | null,
  /** Whether any source reports an operating system version; only read for a machine. */
  versionReported: boolean,
}

export interface EvidenceHealthReading {
  state: EvidenceHealthState,
  /** The newest dated observation, whichever source or test made it; null when none ever did. */
  lastEvidenceAt: Date | null,
}

const DAY_MS = 24 * 60 * 60 * 1000;

const newest = (dates: ReadonlyArray<Date | null>): Date | null => dates.reduce<Date | null>(
  (best, date) => (date !== null && (best === null || date.getTime() > best.getTime()) ? date : best),
  null,
);

/** The evidence health of one asset at `now`, against a re-test delay of `maxAgeDays`. */
export const readEvidenceHealth = (input: EvidenceHealthInput, maxAgeDays: number, now: Date): EvidenceHealthReading => {
  const connectorSources = input.sources.filter((source) => source.origin === 'connector');
  const lastEvidenceAt = newest([...connectorSources.map((source) => source.lastSeenAt), input.lastVerdictAt]);
  if (input.sources.length === 0) {
    return { state: 'no_source', lastEvidenceAt: input.lastVerdictAt };
  }
  if (connectorSources.length === 0) {
    return { state: 'attested_only', lastEvidenceAt: input.lastVerdictAt };
  }
  if (lastEvidenceAt === null) {
    return { state: 'never_measured', lastEvidenceAt };
  }
  if (now.getTime() - lastEvidenceAt.getTime() > maxAgeDays * DAY_MS) {
    return { state: 'expired', lastEvidenceAt };
  }
  if (identityFamilyOf(input.categoryId) === 'machine' && !input.versionReported) {
    return { state: 'version_unknown', lastEvidenceAt };
  }
  return { state: 'current', lastEvidenceAt };
};

/**
 * A connector sync whose latest successful run processed far fewer rows than the one before: a feed
 * that emptied must not read as "every finding is gone". Below `ratio` of the previous run, or zero
 * after a run that had rows, is emptied; a first run, or a previous run with nothing, never is.
 */
export const SOURCE_EMPTIED_RATIO = 0.1;

export const isSourceEmptied = (latest: number, previous: number | null, ratio = SOURCE_EMPTIED_RATIO): boolean => {
  if (previous === null || previous <= 0) {
    return false;
  }
  return latest === 0 || latest < previous * ratio;
};

/** The connector syncs that report assets and findings: the feeds whose emptying would read as "all clear". */
export const EVIDENCE_SYNC_KINDS = ['openaev-findings-sync', 'microsoft-graph-sync', 'drata-sync'] as const;

export interface SourceRunHealth {
  kind: string,
  lastRunAt: Date | null,
  latestTotal: number,
  previousTotal: number | null,
  emptied: boolean,
}

/** The source health of each sync from its two newest successful runs, newest first; a kind with none is left out. */
export const readSourceRunHealth = (runs: ReadonlyArray<{ kind: string, finishedAt: Date | null, processedTotal: number }>): Array<SourceRunHealth> =>
  [...Map.groupBy(runs, (run) => run.kind)].map(([kind, rows]) => {
    const [latest, previous] = rows;
    const previousTotal = previous?.processedTotal ?? null;
    return { kind, lastRunAt: latest.finishedAt, latestTotal: latest.processedTotal, previousTotal, emptied: isSourceEmptied(latest.processedTotal, previousTotal) };
  });
