import { metrics } from '@opentelemetry/api';
import type { HealthStatus } from './health-check';
import { HEALTH_STATUSES } from './health-check';

const meter = metrics.getMeter('opencrq-process-manager');

export const COLLECTION_FAILURE_REASONS = ['timeout', 'error', 'not_connected', 'not_running', 'oversized', 'invalid', 'empty', 'send_error'] as const;
export type CollectionFailureReason = typeof COLLECTION_FAILURE_REASONS[number];

// `state` is the only attribute — `process_name` already lives on the process manager's own
// resource as a constant label, and would collide with it here. No restart counter: there is no
// respawn path in this process manager, a child exit stops every sibling.
export const registerProcessSupervisionMetrics = (getChildren: () => ReadonlyMap<string, { status: HealthStatus }>) => {
  meter.createObservableGauge('opencrq.pm.processes', {
    description: 'The number of supervised processes currently in each lifecycle state.',
    unit: '{process}',
  }).addCallback((observableResult) => {
    const counts = new Map<HealthStatus, number>(HEALTH_STATUSES.map((status) => [status, 0]));
    for (const { status } of getChildren().values()) {
      counts.set(status, (counts.get(status) ?? 0) + 1);
    }
    for (const [status, count] of counts) {
      observableResult.observe(count, { state: status });
    }
  });
};

// `supervised_process`, never `process_name` — the latter is already the parent's own constant
// label, and the two would collide on the same series.
const collectionOk = meter.createGauge('opencrq.pm.collection.ok', {
  description: 'Whether the most recent metrics collection from a supervised process succeeded (1) or failed (0).',
});
// Short list, bounded by the round deadline: a `timeout` failure already says the deadline was
// blown, but not by how much headroom, and this is the only place that shows whether a healthy
// round is comfortably under it or one slow child away from tipping. The SDK's millisecond-shaped
// default boundaries would put every observation of this seconds-valued histogram in the first two
// buckets instead.
const collectionDuration = meter.createHistogram('opencrq.pm.collection.duration', {
  description: 'The time taken to collect metrics from a supervised process, whether the collection succeeded or failed.',
  unit: 's',
  advice: { explicitBucketBoundaries: [0.05, 0.25, 1, 2.5, 4.5] },
});
const collectionFailures = meter.createCounter('opencrq.pm.collection.failures', {
  description: 'The number of metrics-collection attempts from a supervised process that failed, by reason.',
  unit: '{failure}',
});

export const recordCollectionOutcome = (processName: string, outcome: 'ok' | CollectionFailureReason, durationSeconds: number) => {
  collectionOk.record(outcome === 'ok' ? 1 : 0, { supervised_process: processName });
  collectionDuration.record(durationSeconds, { supervised_process: processName });
  if (outcome !== 'ok') {
    collectionFailures.add(1, { supervised_process: processName, reason: outcome });
  }
};
