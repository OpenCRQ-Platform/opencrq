import type { SeverityBand } from './bands';
import { truncateScore } from './bands';

export interface ScoreBanding {
  score: number | null,
  band: SeverityBand | null,
}

const displayedScore = (score: number | null): number | null => (score === null ? null : truncateScore(score));

/**
 * Which of a run's scores owe a journal line, `stored` being keyed as `keyOf` keys them.
 *
 * The comparison is on the displayed integer rather than the stored float, so the journal records
 * every movement a reader can see and none they cannot. A score with nothing stored is journaled
 * too: its first computation is the starting point without which it has no past at all. A finding
 * that loses its score gets a null line, so a reader never carries the lost score forward, but one
 * pending from the start has no past to close.
 */
export const scoresOwingAJournalLine = <T extends ScoreBanding>(
  incoming: ReadonlyArray<T>,
  stored: ReadonlyMap<string, ScoreBanding>,
  keyOf: (row: T) => string,
): Array<T> => incoming.filter((row) => {
  const previous = stored.get(keyOf(row));
  if (previous === undefined) {
    return row.score !== null;
  }
  return displayedScore(previous.score) !== displayedScore(row.score)
    || previous.band !== row.band;
});

export interface UniqueFindingFigures {
  score: number | null,
  band: SeverityBand | null,
  affectedAssetCount: number,
}

/**
 * Which of a run's CVE groups owe a journal line: one with nothing stored, or whose displayed score,
 * band or affected asset count moved. An unscored group is journaled too: its asset count, null
 * only on a group that left the estate, is what says it is there.
 */
export const uniqueFindingsOwingAJournalLine = <T extends UniqueFindingFigures>(
  incoming: ReadonlyArray<T>,
  stored: ReadonlyMap<string, UniqueFindingFigures>,
  keyOf: (row: T) => string,
): Array<T> => incoming.filter((row) => {
  const previous = stored.get(keyOf(row));
  return previous === undefined
    || displayedScore(previous.score) !== displayedScore(row.score)
    || previous.band !== row.band
    || previous.affectedAssetCount !== row.affectedAssetCount;
});

export const rowsOwingAJournalLine =<T extends ScoreBanding & { assetEvidenceId: string }>(
  incoming: ReadonlyArray<T>,
  stored: ReadonlyMap<string, ScoreBanding>,
): Array<T> => scoresOwingAJournalLine(incoming, stored, (row) => row.assetEvidenceId);

export interface AssetPostureScore {
  supportingAssetId: string,
  score: number,
}

/**
 * Which of a run's postures owe a journal line: an asset whose integer posture moved, or that has
 * none stored. An asset losing its posture is not in `incoming`, so its null line is the caller's.
 */
export const posturesOwingAJournalLine = <T extends AssetPostureScore>(
  incoming: ReadonlyArray<T>,
  stored: ReadonlyMap<string, number>,
): Array<T> => incoming.filter((posture) => stored.get(posture.supportingAssetId) !== posture.score);

export interface FindingScoreHistoryLine extends ScoreBanding {
  at: Date,
}
