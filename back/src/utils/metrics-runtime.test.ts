import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import type { MetricReader, ResourceMetrics, ViewOptions } from '@opentelemetry/sdk-metrics';
import { AggregationTemporality, MeterProvider, MetricReader as MetricReaderClass } from '@opentelemetry/sdk-metrics';
import { afterEach, describe, expect, it } from 'vitest';
import { droppedInstrumentViews } from './metrics-views';

class TestMetricReader extends MetricReaderClass {
  protected async onForceFlush() {}
  protected async onShutdown() {}
}

// The exact configuration tracing.ts passes. Resolved through `getNodeAutoInstrumentations`
// rather than constructed directly, which is the only way an env override is observable here.
const PRODUCTION_INSTRUMENTATION_CONFIG = {
  '@opentelemetry/instrumentation-host-metrics': { enabled: true, metricGroups: ['process.cpu', 'process.memory'] },
  '@opentelemetry/instrumentation-runtime-node': { enabled: true },
};

const METRIC_PRODUCING_INSTRUMENTATIONS = [
  '@opentelemetry/instrumentation-host-metrics',
  '@opentelemetry/instrumentation-runtime-node',
];

const findMetric = (resourceMetrics: ResourceMetrics, name: string) => resourceMetrics.scopeMetrics
  .flatMap((scope) => scope.metrics)
  .find((metric) => metric.descriptor.name === name);

const resolveInstrumentations = () => getNodeAutoInstrumentations(PRODUCTION_INSTRUMENTATION_CONFIG);

const setupInstrumentedProvider = (reader: MetricReader, views?: Array<ViewOptions>) => {
  const provider = new MeterProvider({
    readers: [reader],
    ...(views ? { views } : {}),
    resource: resourceFromAttributes({ 'process.name': 'worker' }),
  });

  const instrumentations = resolveInstrumentations();
  const metricProducers = instrumentations.filter((instrumentation) => METRIC_PRODUCING_INSTRUMENTATIONS.includes(instrumentation.instrumentationName));
  // The rest of the auto set patches modules for the whole worker if left enabled.
  for (const instrumentation of instrumentations) {
    if (!metricProducers.includes(instrumentation)) {
      instrumentation.disable();
    }
  }
  for (const instrumentation of metricProducers) {
    instrumentation.setMeterProvider(provider);
    instrumentation.enable();
  }

  return { provider, metricProducers };
};

// The eventloop-delay histogram (resolution 10ms) discards its data unless it already holds at
// least 5 samples, so poll instead of trusting a fixed delay to be enough; errors are accumulated
// across every attempt, not just the last, so a transient failure can't go unnoticed.
const collectUntilReady = async (reader: MetricReader) => {
  const allErrors: Array<unknown> = [];
  let result = await reader.collect();
  allErrors.push(...result.errors);
  for (let attempt = 0; attempt < 29 && !findMetric(result.resourceMetrics, 'nodejs.eventloop.delay.p99'); attempt += 1) {
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    result = await reader.collect();
    allErrors.push(...result.errors);
  }
  return { resourceMetrics: result.resourceMetrics, errors: allErrors };
};

describe('runtime + host-metrics instrumentation, against the real installed packages', () => {
  afterEach(() => {
    delete process.env.OTEL_NODE_DISABLED_INSTRUMENTATIONS;
    delete process.env.OTEL_NODE_ENABLED_INSTRUMENTATIONS;
  });

  it('exposes the nodejs.*/v8js.*/process.* runtime series under the production configuration, with no system.* leaking in', async () => {
    const reader = new TestMetricReader({
      aggregationTemporalitySelector: () => AggregationTemporality.CUMULATIVE,
    });
    const { provider, metricProducers } = setupInstrumentedProvider(reader, droppedInstrumentViews);

    try {
      const { resourceMetrics, errors } = await collectUntilReady(reader);

      expect(errors).toHaveLength(0);
      expect(findMetric(resourceMetrics, 'nodejs.eventloop.delay.p99')).toBeDefined();
      expect(findMetric(resourceMetrics, 'nodejs.eventloop.utilization')).toBeDefined();
      // ObservableGauge fed at collect time, one data point per V8 heap space — no forced GC needed.
      expect(findMetric(resourceMetrics, 'v8js.memory.heap.used')).toBeDefined();

      expect(findMetric(resourceMetrics, 'process.cpu.utilization')).toBeDefined();
      expect(findMetric(resourceMetrics, 'process.memory.usage')).toBeDefined();

      expect(resourceMetrics.scopeMetrics
        .flatMap((scope) => scope.metrics)
        .some((metric) => metric.descriptor.name.startsWith('system.'))).toBe(false);

      // process.name reaches the series as a resource attribute, with no product-name prefix
      // on any instrument name.
      expect(resourceMetrics.resource.attributes['process.name']).toBe('worker');
      expect(resourceMetrics.scopeMetrics.flatMap((scope) => scope.metrics)
        .every((metric) => !metric.descriptor.name.startsWith('opencrq'))).toBe(true);
    } finally {
      for (const instrumentation of metricProducers) {
        instrumentation.disable();
      }
      await provider.shutdown();
    }
  });

  it('keeps both metric producers resolved when the standard environment overrides omit them', () => {
    process.env.OTEL_NODE_DISABLED_INSTRUMENTATIONS = 'runtime-node,host-metrics';

    const resolved = resolveInstrumentations();
    for (const instrumentation of resolved) {
      instrumentation.disable();
    }

    const resolvedNames = resolved.map((instrumentation) => instrumentation.instrumentationName);
    for (const name of METRIC_PRODUCING_INSTRUMENTATIONS) {
      expect(resolvedNames).toContain(name);
    }
  });
});
