/**
 * What the "Observed activity" columns sort on: the instant of the last observation, the same date
 * the badge words, so the order reads like the ages shown. A threat nobody dated has nothing to
 * sort on, and the column puts it last whichever way it sorts.
 */
export const observedAtSortValue = (lastObservedAt: Date | string | null): number | undefined => {
  if (lastObservedAt === null) {
    return undefined;
  }
  const observedMs = new Date(lastObservedAt).getTime();
  return Number.isNaN(observedMs) ? undefined : observedMs;
};

export type ActivityWindowReading =
  | { kind: 'closed', opensAt: Date | null, closesAt: Date }
  | { kind: 'open', opensAt: Date | null }
  | { kind: 'unstated' };

/**
 * A relationship's activity window as it reads on `now`. The API carries the source's own dates, and
 * a producer dating a claim "active this year" ends it on December 31st: that window is still open,
 * not one to show closing ahead of the clock.
 */
export const readActivityWindow = (
  window: { relStartTime: Date | string | null, relStopTime: Date | string | null },
  now: Date,
): ActivityWindowReading => {
  const start = window.relStartTime === null ? null : new Date(window.relStartTime);
  const opensAt = start !== null && start > now ? now : start;
  if (window.relStopTime !== null) {
    const closesAt = new Date(window.relStopTime);
    return closesAt > now ? { kind: 'open', opensAt } : { kind: 'closed', opensAt, closesAt };
  }
  return opensAt === null ? { kind: 'unstated' } : { kind: 'open', opensAt };
};
