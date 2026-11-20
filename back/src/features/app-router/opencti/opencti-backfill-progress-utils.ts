export interface TimelineProgressInput {
  historyStartAt: Date | null,
  backfillTargetAt: Date | null,
  currentEventAt: Date | null,
}

/**
 * Percentage between `historyStartAt` and `backfillTargetAt` (both fixed once set, see
 * `updateCursor`), at `currentEventAt`: a monotonic high-water mark, so this can only ever grow,
 * reaching 100 exactly when the backfill has replayed everything that existed when it started.
 * Null when any endpoint isn't known yet (nothing persisted so far).
 */
export const computeTimelineProgressPercent = ({ historyStartAt, backfillTargetAt, currentEventAt }: TimelineProgressInput): number | null => {
  if (!historyStartAt || !backfillTargetAt || !currentEventAt) {
    return null;
  }
  const totalMs = backfillTargetAt.getTime() - historyStartAt.getTime();
  if (totalMs <= 0) {
    return 100;
  }
  const doneMs = currentEventAt.getTime() - historyStartAt.getTime();
  return Math.min(100, Math.max(0, Math.round((doneMs / totalMs) * 100)));
};
