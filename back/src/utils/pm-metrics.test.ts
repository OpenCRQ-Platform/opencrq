import { metrics } from '@opentelemetry/api';
import { AggregationTemporality, MeterProvider, MetricReader } from '@opentelemetry/sdk-metrics';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HealthStatus } from './health-check';

class TestMetricReader extends MetricReader {
  protected async onForceFlush() {}
  protected async onShutdown() {}
}

describe('registerProcessSupervisionMetrics', () => {
  let reader: TestMetricReader;

  beforeEach(() => {
    metrics.disable();
    reader = new TestMetricReader({ aggregationTemporalitySelector: () => AggregationTemporality.CUMULATIVE });
    const provider = new MeterProvider({ readers: [reader] });
    metrics.setGlobalMeterProvider(provider);
    // pm-metrics.ts binds its meter/instruments once at module load, against whichever provider
    // is global at that time — force a fresh module instance so it rebinds to this test's provider.
    vi.resetModules();
  });

  afterEach(() => {
    metrics.disable();
  });

  it('reports the correct count for every state, including states with zero members, with no process_name attribute', async () => {
    const { registerProcessSupervisionMetrics } = await import('./pm-metrics');
    const children = new Map<string, { status: HealthStatus }>([
      ['pm', { status: 'RUNNING' }],
      ['worker', { status: 'RUNNING' }],
      ['api', { status: 'ERROR' }],
    ]);

    registerProcessSupervisionMetrics(() => children);

    const { resourceMetrics } = await reader.collect();
    const gauge = resourceMetrics.scopeMetrics
      .flatMap((scope) => scope.metrics)
      .find((metric) => metric.descriptor.name === 'opencrq.pm.processes');

    expect(gauge).toBeDefined();
     
    const dataPoints = gauge!.dataPoints;

    const observedCounts = new Map(dataPoints.map((dp) => [dp.attributes.state, dp.value]));
    expect(observedCounts.get('RUNNING')).toBe(2);
    expect(observedCounts.get('ERROR')).toBe(1);
    expect(observedCounts.get('BOOTING')).toBe(0);
    expect(observedCounts.get('EXITED')).toBe(0);

    for (const dp of dataPoints) {
      expect(dp.attributes.process_name).toBeUndefined();
    }
  });
});

describe('recordCollectionOutcome', () => {
  let reader: TestMetricReader;

  beforeEach(() => {
    metrics.disable();
    reader = new TestMetricReader({ aggregationTemporalitySelector: () => AggregationTemporality.CUMULATIVE });
    const provider = new MeterProvider({ readers: [reader] });
    metrics.setGlobalMeterProvider(provider);
    // pm-metrics.ts binds its meter/instruments once at module load, against whichever provider
    // is global at that time — force a fresh module instance so it rebinds to this test's provider.
    vi.resetModules();
  });

  afterEach(() => {
    metrics.disable();
  });

  const findMetric = (resourceMetrics: Awaited<ReturnType<TestMetricReader['collect']>>['resourceMetrics'], name: string) =>
    resourceMetrics.scopeMetrics.flatMap((scope) => scope.metrics).find((metric) => metric.descriptor.name === name);

  it('records ok=1, no failure, and the duration for a successful collection', async () => {
    const { recordCollectionOutcome } = await import('./pm-metrics');

    recordCollectionOutcome('worker', 'ok', 0.25);

    const { resourceMetrics } = await reader.collect();

    const ok = findMetric(resourceMetrics, 'opencrq.pm.collection.ok');
    expect(ok?.dataPoints.find((dp) => dp.attributes.supervised_process === 'worker')?.value).toBe(1);

    const duration = findMetric(resourceMetrics, 'opencrq.pm.collection.duration');
    expect(duration).toBeDefined();

    const failures = findMetric(resourceMetrics, 'opencrq.pm.collection.failures');
    expect(failures?.dataPoints ?? []).toHaveLength(0);
  });

  it('records ok=0 and a failure count with the reason attribute for a timeout', async () => {
    const { recordCollectionOutcome } = await import('./pm-metrics');

    recordCollectionOutcome('worker', 'timeout', 2);

    const { resourceMetrics } = await reader.collect();

    const ok = findMetric(resourceMetrics, 'opencrq.pm.collection.ok');
    expect(ok?.dataPoints.find((dp) => dp.attributes.supervised_process === 'worker')?.value).toBe(0);

    const failures = findMetric(resourceMetrics, 'opencrq.pm.collection.failures');
    const failureDataPoint = failures?.dataPoints.find((dp) => dp.attributes.supervised_process === 'worker');
    expect(failureDataPoint?.attributes.reason).toBe('timeout');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- sum data point value
    expect(failureDataPoint?.value as number).toBe(1);
  });
});
