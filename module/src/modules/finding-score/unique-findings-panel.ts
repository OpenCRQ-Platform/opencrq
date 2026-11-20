import type { SeverityBand } from './bands';
import { SEVERITY_BANDS } from './bands';

export interface UniqueFindingsBandCount {
  band: SeverityBand,
  total: number,
  /** The CVE groups in the band now that were absent when the window opened. */
  newInWindow: number,
}

/** The estate's CVE groups when the window opened, read from the journal. */
export interface UniqueFindingsBaselines {
  cveGroupsBefore: number,
  bandsBefore: Array<{ band: SeverityBand, total: number }>,
  /**
   * The CVE groups present when the window opened that were absent when the previous one did.
   * Null while the journal does not reach back to the previous window: every group would read as new.
   */
  newInPreviousWindow: number | null,
}

/**
 * The findings panel recounted per unique finding. Technique groups count in `uniqueFindings` only:
 * they carry no score and no journal, so every band, "new" and trend figure is about CVE groups.
 */
export interface UniqueFindingsPanelCounts {
  windowStart: Date,
  uniqueFindings: number,
  techniqueGroups: number,
  newInWindow: number,
  bands: Array<UniqueFindingsBandCount>,
  /** Null while the estate's journal does not reach back to the window's start. */
  baselines: UniqueFindingsBaselines | null,
}

interface BandRow {
  band: SeverityBand | null,
  total: number,
  newInWindow: number,
}

export interface UniqueFindingsPanelRows {
  current: Array<BandRow & { techniqueGroups: number }>,
  atWindowStart: Array<BandRow>,
  journalStartsAt: Date | null,
}

const sum = (rows: ReadonlyArray<BandRow>, figure: (row: BandRow) => number): number =>
  rows.reduce((total, row) => total + figure(row), 0);

const isBanded = <Row extends BandRow>(row: Row): row is Row & { band: SeverityBand } => row.band !== null;

/** A band with no group is absent from the rows and comes back at zero, so every band compares. */
export const foldUniqueFindingsPanel = (
  rows: UniqueFindingsPanelRows,
  window: { windowStart: Date, previousWindowStart: Date },
): UniqueFindingsPanelCounts => {
  const journalReaches = (at: Date) => rows.journalStartsAt !== null && rows.journalStartsAt.getTime() < at.getTime();
  const current = rows.current.filter(isBanded);
  const before = rows.atWindowStart.filter(isBanded);
  return {
    windowStart: window.windowStart,
    uniqueFindings: sum(rows.current, (row) => row.total),
    techniqueGroups: rows.current.reduce((total, row) => total + row.techniqueGroups, 0),
    newInWindow: sum(rows.current, (row) => row.newInWindow),
    bands: SEVERITY_BANDS.map((band) => {
      const row = current.find((candidate) => candidate.band === band);
      return { band, total: row?.total ?? 0, newInWindow: row?.newInWindow ?? 0 };
    }),
    baselines: journalReaches(window.windowStart)
      ? {
        cveGroupsBefore: sum(rows.atWindowStart, (row) => row.total),
        bandsBefore: SEVERITY_BANDS.map((band) => ({ band, total: before.find((row) => row.band === band)?.total ?? 0 })),
        newInPreviousWindow: journalReaches(window.previousWindowStart) ? sum(rows.atWindowStart, (row) => row.newInWindow) : null,
      }
      : null,
  };
};
