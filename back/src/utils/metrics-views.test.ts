import type { ResourceMetrics } from '@opentelemetry/sdk-metrics';
import { AggregationTemporality, DataPointType, MeterProvider, MetricReader } from '@opentelemetry/sdk-metrics';
import { ATTR_DB_NAMESPACE, ATTR_DB_OPERATION_NAME, ATTR_DB_SYSTEM_NAME, ATTR_ERROR_TYPE, ATTR_SERVER_ADDRESS, ATTR_SERVER_PORT } from '@opentelemetry/semantic-conventions';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { describe, expect, it } from 'vitest';
import { allowlistErrorType, allowlistOperationName, DB_HISTOGRAM_BUCKET_BOUNDARIES, dbOperationDurationView, droppedInstrumentViews, GC_HISTOGRAM_BUCKET_BOUNDARIES, gcDurationView } from './metrics-views';

class TestMetricReader extends MetricReader {
  protected async onForceFlush() {}
  protected async onShutdown() {}
}

const findMetric = (resourceMetrics: ResourceMetrics, name: string) => resourceMetrics.scopeMetrics
  .flatMap((scope) => scope.metrics)
  .find((metric) => metric.descriptor.name === name);

const collectWithDroppedViews = async (record: (provider: MeterProvider) => void) => {
  const reader = new TestMetricReader({
    aggregationTemporalitySelector: () => AggregationTemporality.CUMULATIVE,
  });
  const provider = new MeterProvider({ readers: [reader], views: droppedInstrumentViews });
  record(provider);
  const { resourceMetrics } = await reader.collect();
  return resourceMetrics;
};

describe('droppedInstrumentViews', () => {
  it('drops every http.server.*, http.client.* and system.* instrument, but not an unrelated one', async () => {
    const resourceMetrics = await collectWithDroppedViews((provider) => {
      const meter = provider.getMeter('test-meter');
      meter.createCounter('http.server.request.count').add(1);
      meter.createCounter('http.client.request.count').add(1);
      meter.createUpDownCounter('system.cpu.utilization').add(1);
      meter.createCounter('opencrq.pm.processes.control').add(1);
    });

    expect(findMetric(resourceMetrics, 'http.server.request.count')).toBeUndefined();
    expect(findMetric(resourceMetrics, 'http.client.request.count')).toBeUndefined();
    expect(findMetric(resourceMetrics, 'system.cpu.utilization')).toBeUndefined();
    expect(findMetric(resourceMetrics, 'opencrq.pm.processes.control')).toBeDefined();
  });

  it('drops db.client.connection.count/pending_requests only when reported by the instrumentation-pg meter', async () => {
    const resourceMetrics = await collectWithDroppedViews((provider) => {
      const pgMeter = provider.getMeter('@opentelemetry/instrumentation-pg');
      pgMeter.createUpDownCounter('db.client.connection.count').add(1);
      pgMeter.createUpDownCounter('db.client.connection.pending_requests').add(1);

      const otherMeter = provider.getMeter('some.other.meter');
      otherMeter.createUpDownCounter('db.client.connection.count').add(1);
    });

    const scopeNames = resourceMetrics.scopeMetrics.map((scope) => scope.scope.name);
    expect(scopeNames).not.toContain('@opentelemetry/instrumentation-pg');

    const otherScope = resourceMetrics.scopeMetrics.find((scope) => scope.scope.name === 'some.other.meter');
    expect(otherScope?.metrics.find((metric) => metric.descriptor.name === 'db.client.connection.count')).toBeDefined();
  });

  it('drops every v8js.memory.heap.space.* family but leaves v8js.memory.heap.used alone', async () => {
    const resourceMetrics = await collectWithDroppedViews((provider) => {
      const meter = provider.getMeter('test-meter');
      meter.createUpDownCounter('v8js.memory.heap.space.size').add(1);
      meter.createUpDownCounter('v8js.memory.heap.space.available_size').add(1);
      meter.createUpDownCounter('v8js.memory.heap.space.physical_size').add(1);
      meter.createUpDownCounter('v8js.memory.heap.used').add(1);
    });

    expect(findMetric(resourceMetrics, 'v8js.memory.heap.space.size')).toBeUndefined();
    expect(findMetric(resourceMetrics, 'v8js.memory.heap.space.available_size')).toBeUndefined();
    expect(findMetric(resourceMetrics, 'v8js.memory.heap.space.physical_size')).toBeUndefined();
    expect(findMetric(resourceMetrics, 'v8js.memory.heap.used')).toBeDefined();
  });
});

describe('allowlistOperationName', () => {
  it('passes through an allowlisted operation name', () => {
    expect(allowlistOperationName('SELECT')).toBe('SELECT');
  });

  it('replaces anything outside the allowlist with the reserved sentinel', () => {
    expect(allowlistOperationName('VACUUM')).toBe('_OTHER');
    expect(allowlistOperationName('TRUNCATE')).toBe('_OTHER');
  });

  it('stays absent when the instrumentation could not derive an operation', () => {
    expect(allowlistOperationName(undefined)).toBeUndefined();
  });
});

describe('allowlistErrorType', () => {
  it('stays absent when no error occurred', () => {
    expect(allowlistErrorType(undefined)).toBeUndefined();
  });

  it('keeps a well-formed SQLSTATE whose class is admitted', () => {
    expect(allowlistErrorType('23505')).toBe('23505');
    expect(allowlistErrorType('08006')).toBe('08006');
    expect(allowlistErrorType('28P01')).toBe('28P01');
    expect(allowlistErrorType('3D000')).toBe('3D000');
    expect(allowlistErrorType('55P03')).toBe('55P03');
  });

  it('replaces a SQLSTATE outside the admitted classes, or a malformed value, with the reserved sentinel', () => {
    expect(allowlistErrorType('99999')).toBe('_OTHER');
    expect(allowlistErrorType('not-a-sqlstate')).toBe('_OTHER');
  });
});

describe('dbOperationDurationView', () => {
  const collectWithDbOperationDurationView = async (record: (provider: MeterProvider) => void) => {
    const reader = new TestMetricReader({
      aggregationTemporalitySelector: () => AggregationTemporality.CUMULATIVE,
    });
    const provider = new MeterProvider({ readers: [reader], views: [dbOperationDurationView] });
    record(provider);
    const { resourceMetrics } = await reader.collect();
    return resourceMetrics;
  };

  it('collapses every disallowed operation name and error type into a single sentinel series', async () => {
    const resourceMetrics = await collectWithDbOperationDurationView((provider) => {
      const meter = provider.getMeter('@opentelemetry/instrumentation-pg');
      const duration = meter.createHistogram('db.client.operation.duration');
      duration.record(0.01, { [ATTR_DB_OPERATION_NAME]: 'SELECT', [ATTR_ERROR_TYPE]: '23505' });
      duration.record(0.02, { [ATTR_DB_OPERATION_NAME]: 'VACUUM' });
      duration.record(0.02, { [ATTR_DB_OPERATION_NAME]: 'LISTEN' });
      duration.record(0.03, { [ATTR_DB_OPERATION_NAME]: 'SELECT', [ATTR_ERROR_TYPE]: '99999' });
      duration.record(0.03, { [ATTR_DB_OPERATION_NAME]: 'SELECT', [ATTR_ERROR_TYPE]: 'ECONNRESET' });
    });

    const metric = findMetric(resourceMetrics, 'db.client.operation.duration');
    expect(metric?.dataPointType).toBe(DataPointType.HISTOGRAM);
    if (metric?.dataPointType !== DataPointType.HISTOGRAM) {
      return;
    }
    const points = metric.dataPoints;

    expect(points.find((dp) => dp.attributes[ATTR_DB_OPERATION_NAME] === 'SELECT' && dp.attributes[ATTR_ERROR_TYPE] === '23505')?.value.count).toBe(1);

    // Two distinct disallowed operations must land on one series, not two labelled `_OTHER`.
    const collapsedOperations = points.filter((dp) => dp.attributes[ATTR_DB_OPERATION_NAME] === '_OTHER');
    expect(collapsedOperations).toHaveLength(1);
    expect(collapsedOperations[0]?.value.count).toBe(2);
    expect(collapsedOperations[0]?.attributes[ATTR_ERROR_TYPE]).toBeUndefined();

    const collapsedErrors = points.filter((dp) => dp.attributes[ATTR_ERROR_TYPE] === '_OTHER');
    expect(collapsedErrors).toHaveLength(1);
    expect(collapsedErrors[0]?.value.count).toBe(2);
  });

  it('leaves the operation name absent when the instrumentation emitted none, rather than merging it with the disallowed ones', async () => {
    const resourceMetrics = await collectWithDbOperationDurationView((provider) => {
      const meter = provider.getMeter('@opentelemetry/instrumentation-pg');
      const duration = meter.createHistogram('db.client.operation.duration');
      duration.record(0.01, { [ATTR_SERVER_ADDRESS]: 'db' });
      duration.record(0.02, { [ATTR_SERVER_ADDRESS]: 'db', [ATTR_DB_OPERATION_NAME]: 'VACUUM' });
    });

    const points = findMetric(resourceMetrics, 'db.client.operation.duration')?.dataPoints ?? [];
    expect(points.find((dp) => dp.attributes[ATTR_DB_OPERATION_NAME] === undefined)).toBeDefined();
    expect(points.find((dp) => dp.attributes[ATTR_DB_OPERATION_NAME] === '_OTHER')).toBeDefined();
  });

  it('keeps the attributes that join this histogram to the authored pool families, and drops everything else', async () => {
    const resourceMetrics = await collectWithDbOperationDurationView((provider) => {
      const meter = provider.getMeter('@opentelemetry/instrumentation-pg');
      meter.createHistogram('db.client.operation.duration').record(0.01, {
        [ATTR_DB_OPERATION_NAME]: 'SELECT',
        [ATTR_SERVER_ADDRESS]: 'db',
        [ATTR_SERVER_PORT]: 5432,
        [ATTR_DB_NAMESPACE]: 'opencrq',
        [ATTR_DB_SYSTEM_NAME]: 'postgresql',
        'db.query.text': 'select * from users where email = $1',
      });
    });

    const point = findMetric(resourceMetrics, 'db.client.operation.duration')?.dataPoints[0];
    expect(point?.attributes).toEqual({
      [ATTR_DB_OPERATION_NAME]: 'SELECT',
      [ATTR_SERVER_ADDRESS]: 'db',
      [ATTR_SERVER_PORT]: 5432,
      [ATTR_DB_NAMESPACE]: 'opencrq',
      [ATTR_DB_SYSTEM_NAME]: 'postgresql',
    });
  });

  it('omits an attribute the instrumentation emitted with no value', async () => {
    const resourceMetrics = await collectWithDbOperationDurationView((provider) => {
      const meter = provider.getMeter('@opentelemetry/instrumentation-pg');
      meter.createHistogram('db.client.operation.duration').record(0.01, {
        [ATTR_DB_OPERATION_NAME]: 'SELECT',
        [ATTR_SERVER_ADDRESS]: undefined,
      });
    });

    const point = findMetric(resourceMetrics, 'db.client.operation.duration')?.dataPoints[0];
    expect(point?.attributes).toEqual({ [ATTR_DB_OPERATION_NAME]: 'SELECT' });
  });

  // The view's selector and the instrumentation's own meter name are otherwise two independent
  // literals: an upstream rename would disengage the attribute allowlist with every test green.
  it('selects the meter the instrumentation this app loads actually registers', () => {
    const pgInstrumentation = getNodeAutoInstrumentations().find((instrumentation) => instrumentation.instrumentationName.endsWith('instrumentation-pg'));
    expect(pgInstrumentation).toBeDefined();
    expect(dbOperationDurationView.meterName).toBe(pgInstrumentation?.instrumentationName);
  });

  it('applies Decision 1\'s bucket boundaries to this adopted histogram', async () => {
    const resourceMetrics = await collectWithDbOperationDurationView((provider) => {
      const meter = provider.getMeter('@opentelemetry/instrumentation-pg');
      meter.createHistogram('db.client.operation.duration').record(1, { [ATTR_DB_OPERATION_NAME]: 'SELECT' });
    });

    const metric = findMetric(resourceMetrics, 'db.client.operation.duration');
    expect(metric?.dataPointType).toBe(DataPointType.HISTOGRAM);
    if (metric?.dataPointType !== DataPointType.HISTOGRAM) {
      return;
    }
    const point = metric.dataPoints[0];
    expect(point?.value.buckets.boundaries).toEqual(DB_HISTOGRAM_BUCKET_BOUNDARIES);
    expect(DB_HISTOGRAM_BUCKET_BOUNDARIES).toEqual([0.005, 0.025, 0.1, 0.5, 2, 10, 60]);
  });

  it('leaves a same-named instrument from another meter untouched', async () => {
    const resourceMetrics = await collectWithDbOperationDurationView((provider) => {
      provider.getMeter('some.other.meter').createHistogram('db.client.operation.duration').record(0.01, { [ATTR_DB_OPERATION_NAME]: 'VACUUM' });
    });

    const otherScope = resourceMetrics.scopeMetrics.find((scope) => scope.scope.name === 'some.other.meter');
    const point = otherScope?.metrics.find((metric) => metric.descriptor.name === 'db.client.operation.duration')?.dataPoints[0];
    expect(point?.attributes[ATTR_DB_OPERATION_NAME]).toBe('VACUUM');
  });
});

describe('gcDurationView', () => {
  const collectWithGcDurationView = async (record: (provider: MeterProvider) => void) => {
    const reader = new TestMetricReader({
      aggregationTemporalitySelector: () => AggregationTemporality.CUMULATIVE,
    });
    const provider = new MeterProvider({ readers: [reader], views: [gcDurationView] });
    record(provider);
    const { resourceMetrics } = await reader.collect();
    return resourceMetrics;
  };

  it('merges every GC kind into one data point, on its own bucket boundaries', async () => {
    const resourceMetrics = await collectWithGcDurationView((provider) => {
      const duration = provider.getMeter('@opentelemetry/instrumentation-runtime-node').createHistogram('v8js.gc.duration');
      duration.record(0.002, { 'v8js.gc.type': 'major' });
      duration.record(0.02, { 'v8js.gc.type': 'minor' });
      duration.record(0.2, { 'v8js.gc.type': 'incremental' });
      duration.record(2, { 'v8js.gc.type': 'weakcb' });
    });

    const metric = findMetric(resourceMetrics, 'v8js.gc.duration');
    expect(metric?.dataPointType).toBe(DataPointType.HISTOGRAM);
    if (metric?.dataPointType !== DataPointType.HISTOGRAM) {
      return;
    }

    expect(metric.dataPoints).toHaveLength(1);
    const point = metric.dataPoints[0];
    expect(point.attributes).toEqual({});
    expect(point.value.count).toBe(4);
    expect(point.value.buckets.boundaries).toEqual(GC_HISTOGRAM_BUCKET_BOUNDARIES);
    expect(GC_HISTOGRAM_BUCKET_BOUNDARIES).toEqual([0.001, 0.01, 0.1, 1, 5, 10]);
  });

  it('leaves a same-named instrument from another meter untouched', async () => {
    const resourceMetrics = await collectWithGcDurationView((provider) => {
      provider.getMeter('some.other.meter').createHistogram('v8js.gc.duration').record(0.002, { 'v8js.gc.type': 'major' });
    });

    const otherScope = resourceMetrics.scopeMetrics.find((scope) => scope.scope.name === 'some.other.meter');
    const point = otherScope?.metrics.find((metric) => metric.descriptor.name === 'v8js.gc.duration')?.dataPoints[0];
    expect(point?.attributes['v8js.gc.type']).toBe('major');
  });

  // The view's selector and the instrumentation's own meter name are otherwise two independent
  // literals: an upstream rename would disengage the kind-merging view with every test green.
  it('selects the meter the instrumentation this app loads actually registers', () => {
    const runtimeInstrumentation = getNodeAutoInstrumentations().find((instrumentation) => instrumentation.instrumentationName.endsWith('instrumentation-runtime-node'));
    expect(runtimeInstrumentation).toBeDefined();
    expect(gcDurationView.meterName).toBe(runtimeInstrumentation?.instrumentationName);
  });
});
