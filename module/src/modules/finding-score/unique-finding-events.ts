import type { SeverityBand } from './bands';
import { truncateScore } from './bands';

export type UniqueFindingEventKind = 'first' | 'regained' | 'rise' | 'fall' | 'lost';

export interface UniqueFindingHistoryLine {
  id: string,
  changedAt: Date,
  /** Null on the line written when the group left the estate. */
  score: number | null,
  band: SeverityBand | null,
  worstScore: number | null,
  affectedAssetCount: number | null,
}

/** One journal line as the screen prints it: every score truncated, as a finding's is. */
export interface UniqueFindingReading {
  score: number | null,
  band: SeverityBand | null,
  worstScore: number | null,
  affectedAssetCount: number | null,
}

export interface UniqueFindingEvent extends UniqueFindingReading {
  id: string,
  at: Date,
  kind: UniqueFindingEventKind,
  /** The line before this one, null on the first line the journal kept. */
  previous: UniqueFindingReading | null,
}

const readingOf = (line: UniqueFindingHistoryLine): UniqueFindingReading => ({
  score: line.score === null ? null : truncateScore(line.score),
  band: line.band,
  worstScore: line.worstScore === null ? null : truncateScore(line.worstScore),
  affectedAssetCount: line.affectedAssetCount,
});

const kindOf = (current: UniqueFindingReading, previous: UniqueFindingReading | null): UniqueFindingEventKind => {
  if (current.score === null) {
    return 'lost';
  }
  if (previous === null) {
    return 'first';
  }
  if (previous.score === null) {
    return 'regained';
  }
  return current.score < previous.score ? 'fall' : 'rise';
};

/**
 * The events of a page of the journal, newest first. `lines` is that page in the same order, and
 * `lineBefore` the line just older than its last one, which is what that last event moved from.
 *
 * A line older than `since` is no event of its own, only the `previous` of the next one: the trim
 * keeps the line in force when the retained span opens, which would otherwise read as a first score.
 */
export const explainUniqueFindingEvents = (
  lines: ReadonlyArray<UniqueFindingHistoryLine>,
  lineBefore: UniqueFindingHistoryLine | null,
  since: Date,
): Array<UniqueFindingEvent> => lines.flatMap((line, index) => {
  if (line.changedAt.getTime() < since.getTime()) {
    return [];
  }
  const older = lines[index + 1] ?? lineBefore;
  const current = readingOf(line);
  const previous = older === null ? null : readingOf(older);
  return [{ ...current, id: line.id, at: line.changedAt, kind: kindOf(current, previous), previous }];
});
