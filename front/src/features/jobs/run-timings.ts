export interface RunTimings {
  waitedMs: number | null,
  ranForMs: number | null,
  totalMs: number | null,
}

/**
 * `startedAt` is the first claim, never rewritten on a retry; `claimedAt` is the last one. A run
 * replayed after a backoff wait has a `claimedAt` well past `startedAt`, so `ranForMs` — the actual
 * execution time — comes from `claimedAt`, while `totalMs` still spans the whole queue-to-finish
 * story, backoff included.
 */
export const runTimings = (
  run: {
    enqueuedAt: string,
    startedAt: string | null,
    claimedAt: string | null,
    finishedAt: string | null,
    status: string,
  },
  nowMs: number,
): RunTimings => {
  const enqueuedAt = Date.parse(run.enqueuedAt);
  const startedAt = run.startedAt === null ? null : Date.parse(run.startedAt);
  const claimedAt = run.claimedAt === null ? null : Date.parse(run.claimedAt);
  const finishedAt = run.finishedAt === null ? null : Date.parse(run.finishedAt);

  const waitedMs = startedAt === null ? null : Math.max(0, startedAt - enqueuedAt);

  let ranForMs: number | null = null;
  if (claimedAt !== null) {
    if (finishedAt !== null) {
      ranForMs = Math.max(0, finishedAt - claimedAt);
    } else if (run.status === 'running') {
      ranForMs = Math.max(0, nowMs - claimedAt);
    }
  }

  const totalMs = finishedAt === null ? null : Math.max(0, finishedAt - enqueuedAt);

  return { waitedMs, ranForMs, totalMs };
};
