/**
 * Each point's position from 0 to 1 on an axis running from the oldest point to `now`, so a scenario
 * first priced three weeks ago spreads those three weeks across the whole width. Undefined below two
 * points, which keeps the single-point rendering.
 */
export const placeLifelineByTime = (ats: ReadonlyArray<string>, now: Date): Array<number> | undefined => {
  if (ats.length < 2) {
    return undefined;
  }
  const times = ats.map((at) => new Date(at).getTime());
  const start = times[0];
  const span = Math.max(now.getTime(), times[times.length - 1]) - start;
  if (span <= 0) {
    return undefined;
  }
  return times.map((time) => (time - start) / span);
};
