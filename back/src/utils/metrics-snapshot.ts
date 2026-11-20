import { PrometheusSerializer } from '@opentelemetry/exporter-prometheus';
import { AggregationTemporality, MetricReader } from '@opentelemetry/sdk-metrics';

// Anchored: a loose prefix match would also promote `service.instance.id`, which changes on
// every restart and would defeat the point of a stable, scrape-friendly identity.
const CONSTANT_LABEL_KEYS = /^(process\.name|service\.name|service\.version)$/;

class OnDemandMetricReader extends MetricReader {
  protected async onForceFlush() {}
  protected async onShutdown() {}
}

export const createSnapshotReader = () => {
  const reader = new OnDemandMetricReader({
    aggregationTemporalitySelector: () => AggregationTemporality.CUMULATIVE,
  });
  // withoutTargetInfo/withoutScopeInfo both true: suppresses the default resource detectors'
  // host/OS/process attributes (not cosmetic, an unauthenticated endpoint should not leak them)
  // and per-instrumentation-scope noise.
  const serializer = new PrometheusSerializer(undefined, false, CONSTANT_LABEL_KEYS, true, true);

  return {
    reader,
    collect: async (): Promise<string> => {
      const { resourceMetrics } = await reader.collect();
      return serializer.serialize(resourceMetrics);
    },
  };
};
