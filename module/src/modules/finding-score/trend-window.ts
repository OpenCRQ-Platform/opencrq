/** Length of both halves of the findings-panel comparison, in days. */
export const FINDING_TREND_WINDOW_DAYS = 7;

const DAY_MS = 86_400_000;

export interface FindingTrendWindow {
  /**
   * Start of the current window, and the instant the previous stock is replayed at. The panel's
   * stock deltas and its new-counts both hang off this single boundary, so they can never
   * describe two different weeks.
   */
  windowStart: Date,
  /** Start of the window before it, which the previous new-count is drawn from. */
  previousWindowStart: Date,
}

export const resolveFindingTrendWindow = (now: Date): FindingTrendWindow => {
  const windowMs = FINDING_TREND_WINDOW_DAYS * DAY_MS;
  return {
    windowStart: new Date(now.getTime() - windowMs),
    previousWindowStart: new Date(now.getTime() - 2 * windowMs),
  };
};
