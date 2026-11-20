export const FULL_WALK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
export const FULL_WALK_RETRY_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface FullWalkTimestamps {
  fullWalkStartedAt: Date | null,
  lastFullWalkCompletedAt: Date | null,
  lastFullWalkAttemptedAt: Date | null,
}

/**
 * Whether a stream's full walk must run now. A walk in progress is always due, so a run that died
 * halfway resumes it. Otherwise it is due once the last completed walk is older than
 * `FULL_WALK_INTERVAL_MS` (or there never was one), unless one was attempted within
 * `FULL_WALK_RETRY_INTERVAL_MS`, which is what spaces out the retries of a source that is not ready.
 * `null` is a stream with no state yet.
 */
export const isFullWalkDue = (state: FullWalkTimestamps | null, now: Date): boolean => {
  if (state === null) {
    return true;
  }
  if (state.fullWalkStartedAt !== null) {
    return true;
  }
  const completedStale = state.lastFullWalkCompletedAt === null
    || now.getTime() - state.lastFullWalkCompletedAt.getTime() > FULL_WALK_INTERVAL_MS;
  const attemptedStale = state.lastFullWalkAttemptedAt === null
    || now.getTime() - state.lastFullWalkAttemptedAt.getTime() > FULL_WALK_RETRY_INTERVAL_MS;
  return completedStale && attemptedStale;
};
