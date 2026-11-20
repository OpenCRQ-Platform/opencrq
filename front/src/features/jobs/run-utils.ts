import { formatDateTime } from '../../utils';

/**
 * An announced total is an estimate: a run that overran it is complete, not in error, and the bar
 * neither stops short of the end nor runs past it. Rounding down keeps the last objects of a large
 * run visible: rounding to the nearest percent would let 1 680 of 1 685 read as finished while five
 * remain.
 */
export const runProgressPercent = (processedTotal: number, expectedTotal: number | null): number | null => {
  if (expectedTotal === null || expectedTotal <= 0) {
    return null;
  }
  return Math.min(100, Math.floor((processedTotal / expectedTotal) * 100));
};

export const runStartInstant = ({ startedAt, enqueuedAt }: { startedAt: string | null, enqueuedAt: string }): string =>
  startedAt ?? enqueuedAt;

export const runDisplayName = (kind: string, run: { startedAt: string | null, enqueuedAt: string }): string =>
  `${kind} @ ${formatDateTime(runStartInstant(run))}`;

/**
 * How far the browser clock runs ahead of the server's, measured when the answer arrived. Subtracted
 * from the browser's now before it is compared to a database instant: a lease has 20 s of slack, and
 * a workstation 25 s ahead would otherwise read every healthy run as lifeless.
 */
export const clockSkewMs = (serverNow: string, receivedAtMs: number): number => receivedAtMs - Date.parse(serverNow);

interface RunPulse {
  /** Stale once the lease lapsed: the worker has not renewed it for a whole lease. */
  state: 'alive' | 'stale',
  secondsSinceHeartbeat: number,
}

export const runPulse = (
  run: { status: string, heartbeatAt: string | null, leaseExpiresAt: string | null },
  nowMs: number,
): RunPulse | null => {
  if (run.status !== 'running' || run.heartbeatAt === null || run.leaseExpiresAt === null) {
    return null;
  }
  return {
    state: nowMs > Date.parse(run.leaseExpiresAt) ? 'stale' : 'alive',
    secondsSinceHeartbeat: Math.max(0, Math.floor((nowMs - Date.parse(run.heartbeatAt)) / 1000)),
  };
};

interface RunRetryWait {
  attempt: number,
  maxAttempts: number,
  at: string,
}

/** A queued run that already ran is waiting for its next attempt; a fresh one is only waiting its turn. */
export const runRetryWait = (
  run: { status: string, attempt: number, maxAttempts: number, runAfter: string },
): RunRetryWait | null => (run.status === 'queued' && run.attempt > 0
  ? { attempt: run.attempt + 1, maxAttempts: run.maxAttempts, at: run.runAfter }
  : null);
