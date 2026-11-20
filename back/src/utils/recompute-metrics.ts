import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('opencrq-recompute');

const asks = meter.createCounter('opencrq.recompute.asks', {
  description: 'Recompute enqueue requests, by path (dispatcher vs manual vs sweep) and dedup outcome',
});

const unattributedRuns = meter.createCounter('opencrq.recompute.unattributed_reads', {
  description: 'Observed runs whose subscription widened to every table',
});

const feedingCycles = meter.createCounter('opencrq.recompute.feeding_cycles', {
  description: 'Job kinds whose observed reads and writes feed each other, which still route',
});

/**
 * Who asked. `followup` is the platform asking on the back of its own work — a simulation a
 * recompute booked because the amounts moved — and is kept apart from `manual` so the fan-out one
 * questionnaire save sets off can be read without the analyst's own clicks in the same bucket.
 */
export type RecomputeAskPath = 'dispatcher' | 'followup' | 'manual' | 'sweep';
export type DispatcherAskReason = 'change' | 'reconnect' | 'daily' | 'followup';

export const recordRecomputeAsk = (
  path: RecomputeAskPath,
  jobKind: string,
  alreadyExisted: boolean,
  reason?: DispatcherAskReason,
): void => {
  asks.add(1, {
    path,
    job_kind: jobKind,
    already_existed: String(alreadyExisted),
    ...(reason ? { reason } : {}),
  });
};

export const recordFeedingCycle = (cycle: Array<string>): void => {
  const joined = cycle.join(' -> ');
  for (const jobKind of new Set(cycle)) {
    feedingCycles.add(1, { job_kind: jobKind, cycle: joined });
  }
};

export const recordUnattributedRun = (jobKind: string): void => {
  // Counted by kind alone: the read that widened is a statement text, which as a metric dimension
  // has no bound.
  unattributedRuns.add(1, { job_kind: jobKind });
};
