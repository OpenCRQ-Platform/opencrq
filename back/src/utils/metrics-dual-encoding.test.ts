import { resourceFromAttributes } from '@opentelemetry/resources';
import type { PushMetricExporter, ResourceMetrics } from '@opentelemetry/sdk-metrics';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { describe, expect, it } from 'vitest';
import { createSnapshotReader } from './metrics-snapshot';

describe('pull vs. push encoding of the same recorded state', () => {
  it('reports identical values, differing only in name/label/attribute encoding, on both readers', async () => {
    const { reader: pullReader, collect: collectPulled } = createSnapshotReader();

    let capturedPush: ResourceMetrics | undefined;
    const stubPushExporter: PushMetricExporter = {
      export: (metrics, resultCallback) => {
        capturedPush = metrics;
        resultCallback({ code: 0 });
      },
      forceFlush: async () => {},
      shutdown: async () => {},
    };
    const pushReader = new PeriodicExportingMetricReader({ exporter: stubPushExporter });

    const provider = new MeterProvider({
      readers: [pullReader, pushReader],
      resource: resourceFromAttributes({
        'process.name': 'worker',
        'service.name': 'opencrq-platform',
        'service.version': '1.2.3',
        'service.instance.id': 'worker-123',
      }),
    });
    try {
      const meter = provider.getMeter('test-meter');
      meter.createCounter('opencrq.test.requests').add(5);
      meter.createHistogram('opencrq.test.duration').record(120);

      const pulledText = await collectPulled();
      await pushReader.forceFlush();

      expect(capturedPush).toBeDefined();
      const pushedMetrics = capturedPush!.scopeMetrics.flatMap((scope) => scope.metrics);
      const pushedCounter = pushedMetrics.find((metric) => metric.descriptor.name === 'opencrq.test.requests');
      const pushedHistogram = pushedMetrics.find((metric) => metric.descriptor.name === 'opencrq.test.duration');

      // Same recorded value, either side.
      expect(pushedCounter?.dataPoints[0]?.value).toBe(5);
      expect(pulledText).toMatch(/opencrq_test_requests_total(\{[^}]*\})?\s+5\b/);
      expect(pushedHistogram?.dataPoints[0]?.value).toMatchObject({ sum: 120, count: 1 });
      expect(pulledText).toMatch(/opencrq_test_duration_sum(\{[^}]*\})?\s+120\b/);
      expect(pulledText).toMatch(/opencrq_test_duration_count(\{[^}]*\})?\s+1\b/);

      // Dotted instrument name on the push side, sanitised with a `_total` suffix on the pull side.
      expect(pulledText).not.toContain('opencrq.test.requests');
      expect(pulledText).not.toContain('opencrq.test.duration');

      // process.name/service.name/service.version: sample labels on the pull side, resource
      // attributes on the push side.
      expect(pulledText).toContain('process_name="worker"');
      expect(pulledText).toContain('service_name="opencrq-platform"');
      expect(pulledText).toContain('service_version="1.2.3"');
      expect(capturedPush!.resource.attributes['process.name']).toBe('worker');
      expect(capturedPush!.resource.attributes['service.name']).toBe('opencrq-platform');
      expect(capturedPush!.resource.attributes['service.version']).toBe('1.2.3');

      // service.instance.id: present only on the push path, never on the pull path.
      expect(pulledText).not.toContain('service_instance_id');
      expect(pulledText).not.toContain('worker-123');
      expect(capturedPush!.resource.attributes['service.instance.id']).toBe('worker-123');
    } finally {
      await provider.shutdown();
    }
  });
});
