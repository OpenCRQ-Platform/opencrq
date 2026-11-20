import { metrics } from '@opentelemetry/api';
import type { DoorbellTargets, QueryDependencyIndex } from './query-dependency-index';

const meter = metrics.getMeter('opencrq-events');

const doorbells = meter.createCounter('opencrq.events.doorbells', {
  description: 'Doorbells resolved against the query dependency index, by whether they name procedures or stand for every table.',
  unit: '{doorbell}',
});

const doorbellProcedures = meter.createHistogram('opencrq.events.doorbell.procedures', {
  description: 'Number of query procedures one doorbell names as stale.',
  unit: '{procedure}',
  advice: { explicitBucketBoundaries: [0, 1, 2, 5, 10, 20, 50, 100] },
});

export const recordDoorbellResolution = (targets: DoorbellTargets): void => {
  doorbells.add(1, { resolution: targets.all ? 'all' : 'named' });
  if (!targets.all) {
    doorbellProcedures.record(targets.procedures.length);
  }
};

export const registerQueryIndexMetrics = (index: QueryDependencyIndex): void => {
  meter.createObservableCounter('opencrq.events.query_index.explains', {
    description: 'EXPLAIN statements run to learn the tables a query procedure reads, by outcome.',
    unit: '{explain}',
  }).addCallback((observableResult) => {
    const snapshot = index.snapshot();
    observableResult.observe(snapshot.explainsOk, { outcome: 'ok' });
    observableResult.observe(snapshot.explainsRefused, { outcome: 'refused' });
  });

  meter.createObservableGauge('opencrq.events.query_index.procedures', {
    description: 'Query procedures the index knows, by state.',
    unit: '{procedure}',
  }).addCallback((observableResult) => {
    const snapshot = index.snapshot();
    observableResult.observe(snapshot.observed, { state: 'observed' });
    observableResult.observe(snapshot.declared, { state: 'declared' });
    observableResult.observe(snapshot.widened, { state: 'widened' });
    observableResult.observe(snapshot.withoutReads, { state: 'without_reads' });
  });
};
