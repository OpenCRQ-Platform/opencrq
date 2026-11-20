import { metrics } from '@opentelemetry/api';
import type { ResourceMetrics } from '@opentelemetry/sdk-metrics';
import { AggregationTemporality, DataPointType, MeterProvider, MetricReader } from '@opentelemetry/sdk-metrics';
import { ATTR_ERROR_TYPE } from '@opentelemetry/semantic-conventions';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TRPC_HISTOGRAM_BUCKET_BOUNDARIES } from './metrics-views';

const { logTraceMock, logErrorMock } = vi.hoisted(() => ({ logTraceMock: vi.fn(), logErrorMock: vi.fn() }));
vi.mock('./logger', () => ({ createLogger: () => ({ logTrace: logTraceMock, logError: logErrorMock }) }));

class TestMetricReader extends MetricReader {
  protected async onForceFlush() {}
  protected async onShutdown() {}
}

// Set up before the very first `import('./trpc-telemetry')` in this file: its meter is bound to
// whatever global provider is registered at module-load time.
const reader = new TestMetricReader({ aggregationTemporalitySelector: () => AggregationTemporality.CUMULATIVE });
const provider = new MeterProvider({ readers: [reader] });
metrics.setGlobalMeterProvider(provider);
const collect = () => reader.collect().then(({ resourceMetrics }) => resourceMetrics);

const { instrumentTrpcCall, ATTR_TRPC_PROCEDURE, ATTR_TRPC_TYPE, SLOW_CALL_THRESHOLD_SECONDS } = await import('./trpc-telemetry');

// The duration histogram carries no procedure label: every call in a suite run lands on the
// single series matching its `trpc.type`/`error.type`, so a test isolates its own call by giving
// it a distinct type/error combination rather than by procedure.
const findDurationPoint = (resourceMetrics: ResourceMetrics, type: string, errorType?: string) => {
  const metric = resourceMetrics.scopeMetrics
    .filter((scope) => scope.scope.name === 'opencrq-trpc')
    .flatMap((scope) => scope.metrics)
    .find((entry) => entry.descriptor.name === 'opencrq.trpc.server.duration');
  if (metric?.dataPointType !== DataPointType.HISTOGRAM) {
    return undefined;
  }
  return metric.dataPoints.find((dp) => dp.attributes[ATTR_TRPC_TYPE] === type && dp.attributes[ATTR_ERROR_TYPE] === errorType);
};

const findCallPoints = (resourceMetrics: ResourceMetrics, procedure: string) => {
  const metric = resourceMetrics.scopeMetrics
    .filter((scope) => scope.scope.name === 'opencrq-trpc')
    .flatMap((scope) => scope.metrics)
    .find((entry) => entry.descriptor.name === 'opencrq.trpc.server.calls');
  if (metric?.dataPointType !== DataPointType.SUM) {
    return [];
  }
  return metric.dataPoints.filter((dp) => dp.attributes[ATTR_TRPC_PROCEDURE] === procedure);
};

// `elapsedSeconds` samples the clock once, after the caller sampled it once: two reads per call.
const withElapsedSeconds = (seconds: number) => {
  const spy = vi.spyOn(process.hrtime, 'bigint');
  spy.mockReturnValueOnce(0n).mockReturnValueOnce(BigInt(Math.round(seconds * 1e9)));
  return spy;
};

// A ceiling no case below can reach, so every test that is not about the ceiling ignores it.
const NO_CEILING = Number.MAX_SAFE_INTEGER;
const call = <R extends { ok: boolean, data?: unknown, error?: unknown }>(
  path: string,
  type: 'query' | 'mutation' | 'subscription',
  invoke: () => Promise<R>,
  options: { maxResponseItems: number } = { maxResponseItems: NO_CEILING },
) => instrumentTrpcCall(path, type, invoke, options);

afterEach(() => {
  logTraceMock.mockClear();
  logErrorMock.mockClear();
  vi.restoreAllMocks();
});

describe('instrumentTrpcCall', () => {
  it('records a duration sample with no procedure label, and a call counted against its procedure, for a successful query', async () => {
    const result = await call('demo.ok', 'query', () => Promise.resolve({ ok: true, data: { value: 1 } }));
    expect(result).toEqual({ ok: true, data: { value: 1 } });

    const resourceMetrics = await collect();
    const durationPoint = findDurationPoint(resourceMetrics, 'query');
    expect(durationPoint).toBeDefined();
    expect(durationPoint?.value.buckets.boundaries).toEqual(TRPC_HISTOGRAM_BUCKET_BOUNDARIES);
    expect(TRPC_HISTOGRAM_BUCKET_BOUNDARIES).toEqual([0.05, 0.25, 1, 5, 30, 120]);

    const points = findCallPoints(resourceMetrics, 'demo.ok');
    expect(points).toHaveLength(1);
    expect(points[0].value).toBe(1);
    expect(points[0].attributes[ATTR_TRPC_TYPE]).toBe('query');
    expect(points[0].attributes[ATTR_ERROR_TYPE]).toBeUndefined();
  });

  it('tags a failed call with the tRPC error code, on the counter', async () => {
    const failure = { ok: false, error: { code: 'UNAUTHORIZED' } };
    const result = await call('demo.denied', 'mutation', () => Promise.resolve(failure));
    expect(result).toBe(failure);

    const resourceMetrics = await collect();
    expect(findDurationPoint(resourceMetrics, 'mutation', 'UNAUTHORIZED')).toBeDefined();

    const points = findCallPoints(resourceMetrics, 'demo.denied');
    expect(points).toHaveLength(1);
    expect(points[0].attributes[ATTR_ERROR_TYPE]).toBe('UNAUTHORIZED');
  });

  it('collapses a code outside tRPC own set into the _OTHER sentinel, on the counter', async () => {
    // A Postgres SQLSTATE reaching the throw path would otherwise become a label value of its own.
    const pgError = Object.assign(new Error('duplicate key'), { code: '23505' });
    await expect(call('demo.pgcode', 'query', () => Promise.reject(pgError))).rejects.toBe(pgError);

    const points = findCallPoints(await collect(), 'demo.pgcode');
    expect(points[0].attributes[ATTR_ERROR_TYPE]).toBe('_OTHER');
  });

  it('collapses a code-less failure into the _OTHER sentinel, on the counter', async () => {
    await call('demo.broken', 'query', () => Promise.resolve({ ok: false, error: new Error('boom') }));

    const points = findCallPoints(await collect(), 'demo.broken');
    expect(points[0].attributes[ATTR_ERROR_TYPE]).toBe('_OTHER');
  });

  it('counts a call whose chain throws, then rethrows', async () => {
    const boom = new Error('middleware exploded');
    await expect(call('demo.throws', 'query', () => Promise.reject(boom))).rejects.toBe(boom);

    const points = findCallPoints(await collect(), 'demo.throws');
    expect(points).toHaveLength(1);
    expect(points[0].value).toBe(1);
    expect(points[0].attributes[ATTR_ERROR_TYPE]).toBe('_OTHER');
  });

  it('logs a slow call that ends in a throw, like any other slow call', async () => {
    withElapsedSeconds(SLOW_CALL_THRESHOLD_SECONDS);
    const boom = new Error('slow then exploded');
    await expect(call('demo.slowThrow', 'query', () => Promise.reject(boom))).rejects.toBe(boom);

    expect(logTraceMock).toHaveBeenCalledWith('Slow tRPC call', {
      procedure: 'demo.slowThrow',
      type: 'query',
      durationMs: SLOW_CALL_THRESHOLD_SECONDS * 1000,
      items: undefined,
    });
  });

  it('passes a subscription through without recording anything', async () => {
    const result = await call('demo.stream', 'subscription', () => Promise.resolve({ ok: true, data: [1] }));
    expect(result).toEqual({ ok: true, data: [1] });

    const resourceMetrics = await collect();
    // No other call in this suite records `trpc.type: 'subscription'`, so this stays a valid
    // isolation key even though the histogram no longer carries a procedure label.
    expect(findDurationPoint(resourceMetrics, 'subscription')).toBeUndefined();
    expect(findCallPoints(resourceMetrics, 'demo.stream')).toHaveLength(0);
  });

  it('logs a call that reaches the slow threshold, with its duration and item count', async () => {
    withElapsedSeconds(SLOW_CALL_THRESHOLD_SECONDS);
    await call('demo.slow', 'query', () => Promise.resolve({ ok: true, data: [1, 2] }));

    expect(logTraceMock).toHaveBeenCalledTimes(1);
    expect(logTraceMock).toHaveBeenCalledWith('Slow tRPC call', {
      procedure: 'demo.slow',
      type: 'query',
      durationMs: SLOW_CALL_THRESHOLD_SECONDS * 1000,
      items: 2,
    });
  });

  it('stays silent for a call below the slow threshold', async () => {
    withElapsedSeconds(SLOW_CALL_THRESHOLD_SECONDS - 0.001);
    await call('demo.quick', 'query', () => Promise.resolve({ ok: true, data: [1] }));

    expect(logTraceMock).not.toHaveBeenCalled();
  });

  it('refuses an array response over the ceiling, naming the procedure and both counts', async () => {
    const rejection = call('demo.unbounded', 'query', () => Promise.resolve({ ok: true, data: [1, 2, 3, 4] }), { maxResponseItems: 3 });

    await expect(rejection).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    expect(logErrorMock).toHaveBeenCalledWith('tRPC response over the item ceiling, refusing to serialize it', {
      procedure: 'demo.unbounded',
      type: 'query',
      items: 4,
      maxResponseItems: 3,
    });
  });

  it('measures the refused call as an error, on the counter', async () => {
    await expect(call('demo.refused', 'query', () => Promise.resolve({ ok: true, data: [1, 2] }), { maxResponseItems: 1 }))
      .rejects.toThrow();

    const points = findCallPoints(await collect(), 'demo.refused');
    expect(points[0].attributes[ATTR_ERROR_TYPE]).toBe('PAYLOAD_TOO_LARGE');
  });

  it('lets an array response exactly at the ceiling through', async () => {
    const result = await call('demo.atceiling', 'query', () => Promise.resolve({ ok: true, data: [1, 2, 3] }), { maxResponseItems: 3 });

    expect(result).toEqual({ ok: true, data: [1, 2, 3] });
    expect(logErrorMock).not.toHaveBeenCalled();
  });
});
