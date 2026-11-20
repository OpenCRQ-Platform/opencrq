import { resourceFromAttributes } from '@opentelemetry/resources';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { describe, expect, it } from 'vitest';
import { createSnapshotReader } from './metrics-snapshot';

describe('createSnapshotReader', () => {
  it('promotes only process.name/service.name/service.version as constant labels, never an extra resource attribute', async () => {
    const { reader, collect } = createSnapshotReader();
    const provider = new MeterProvider({
      readers: [reader],
      resource: resourceFromAttributes({
        'process.name': 'worker',
        'service.name': 'opencrq-platform',
        'service.version': '1.2.3',
        'service.instance.id': 'worker-123',
      }),
    });
    provider.getMeter('test-meter').createCounter('opencrq_test_requests').add(1);

    const text = await collect();

    expect(text).toContain('process_name="worker"');
    expect(text).toContain('service_name="opencrq-platform"');
    expect(text).toContain('service_version="1.2.3"');
    expect(text).not.toContain('service_instance_id');
    expect(text).not.toContain('worker-123');
  });

  it('reports a counter recorded twice as cumulative, not delta', async () => {
    const { reader, collect } = createSnapshotReader();
    const provider = new MeterProvider({ readers: [reader] });
    const counter = provider.getMeter('test-meter').createCounter('opencrq_test_counter');

    counter.add(1);
    await collect();
    counter.add(1);
    const text = await collect();

    expect(text).toMatch(/opencrq_test_counter_total(\{[^}]*\})?\s+2\b/);
  });

  it('never emits target_info or scope-info lines', async () => {
    const { reader, collect } = createSnapshotReader();
    const provider = new MeterProvider({
      readers: [reader],
      resource: resourceFromAttributes({ 'process.name': 'worker' }),
    });
    provider.getMeter('test-meter').createCounter('opencrq_test_requests').add(1);

    const text = await collect();

    expect(text).not.toContain('target_info');
    expect(text).not.toContain('otel_scope_');
  });
});
