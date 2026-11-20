export interface FindingHistoryDateEntry {
  /** When the row put the finding in its state, as the server dates it (`historyRowEnteredAt`). */
  enteredAt: Date | string,
  state: string,
}

/**
 * Returns the first timestamp of the current uninterrupted applicable streak.
 * If the latest state is dismissed, the streak is considered closed and null is returned.
 */
export const getFindingFirstSeen = (history: Array<FindingHistoryDateEntry>): Date | null => {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].state !== 'applicable') {
      return null;
    }
    if (i === 0 || history[i - 1].state === 'dismissed') {
      return new Date(history[i].enteredAt);
    }
  }
  return null;
};

/**
 * When the finding entered the state it stands in today: the latest entry into it, so a finding
 * dismissed and brought back has stood applicable since it came back. Null on an empty history.
 */
export const getFindingStateSince = (history: Array<FindingHistoryDateEntry>): Date | null => {
  for (let i = history.length - 1; i >= 0; i--) {
    if (i === 0 || history[i - 1].state !== history[i].state) {
      return new Date(history[i].enteredAt);
    }
  }
  return null;
};
