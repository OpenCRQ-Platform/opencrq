import { sleep } from '../../utils';

export interface ActiveJobsTracker {
  size: () => number,
}

const DEFAULT_GRACE_MS = 60_000;
const DEFAULT_POLL_INTERVAL_MS = 100;

// Waits up to graceMs for in-flight jobs to settle; the engine's AbortSignal
// is aborted first so each executeJob takes the engine-shutdown release path.
// Jobs that don't settle in time fall through to the next worker's reaper.
// Resolves to false when graceMs ran out first.
export const createGracefulDrain = (
  activeJobs: ActiveJobsTracker,
  graceMs: number = DEFAULT_GRACE_MS,
  pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS,
): () => Promise<boolean> => async () => {
  const deadline = Date.now() + graceMs;
  while (activeJobs.size() > 0 && Date.now() < deadline) {
    await sleep(pollIntervalMs);
  }
  return activeJobs.size() === 0;
};
