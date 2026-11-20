import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { metrics } from '@opentelemetry/api';
import type { Pool, PoolClient } from 'pg';
import type { ResourceMetrics } from '@opentelemetry/sdk-metrics';
import { AggregationTemporality, DataPointType, MeterProvider, MetricReader } from '@opentelemetry/sdk-metrics';
import { ATTR_DB_CLIENT_CONNECTION_POOL_NAME } from '@opentelemetry/semantic-conventions/incubating';
import { describe, expect, it, vi } from 'vitest';
import { DB_CONNECTION_USE_TIME_HISTOGRAM_BUCKET_BOUNDARIES, DB_HISTOGRAM_BUCKET_BOUNDARIES, droppedInstrumentViews } from '../../utils/metrics-views';

class TestMetricReader extends MetricReader {
  protected async onForceFlush() {}
  protected async onShutdown() {}
}

const findMetric = (resourceMetrics: ResourceMetrics, name: string, scopeName?: string) => resourceMetrics.scopeMetrics
  .filter((scope) => !scopeName || scope.scope.name === scopeName)
  .flatMap((scope) => scope.metrics)
  .find((metric) => metric.descriptor.name === name);

// Narrows `metric.dataPoints[].value`, a `number | Histogram | ExponentialHistogram` union, to
// the histogram shape carrying `.count`/`.sum` before returning a specific data point's value.
const findHistogramValue = (resourceMetrics: ResourceMetrics, name: string, scopeName: string, poolName: string) => {
  const metric = findMetric(resourceMetrics, name, scopeName);
  if (metric?.dataPointType !== DataPointType.HISTOGRAM) {
    return undefined;
  }
  return metric.dataPoints.find((dp) => dp.attributes[ATTR_DB_CLIENT_CONNECTION_POOL_NAME] === poolName)?.value;
};

const findGaugeValue = (resourceMetrics: ResourceMetrics, name: string, poolName: string, state?: string) => findMetric(resourceMetrics, name, 'opencrq-db-engine')
  ?.dataPoints.find((dp) => dp.attributes[ATTR_DB_CLIENT_CONNECTION_POOL_NAME] === poolName && (!state || dp.attributes['db.client.connection.state'] === state))
  ?.value;

type FakeConnectCallback = (err?: Error, client?: PoolClient, done?: (release?: Error | boolean) => void) => void;
type FakeConnect = (callback?: FakeConnectCallback) => Promise<PoolClient> | void;

interface FakePoolState {
  totalCount: number,
  idleCount: number,
  waitingCount: number,
  options: { host?: string, port?: number, database?: string, max?: number, connectionTimeoutMillis?: number },
}

// Shaped like `pg.Pool` for the subset `db-metrics.ts` reads. The counters are getters over the
// caller's own state object, exactly as `pg.Pool` exposes them, so an implementation that read
// them once at registration time would surface here as a frozen series instead of passing.
const createFakePool = (poolState: FakePoolState, connectImpl: FakeConnect) => {
  const current = { connect: connectImpl };
  return {
    get totalCount() {
      return poolState.totalCount;
    },
    get idleCount() {
      return poolState.idleCount;
    },
    get waitingCount() {
      return poolState.waitingCount;
    },
    options: poolState.options,
    get connect() {
      return current.connect;
    },
    set connect(next: FakeConnect) {
      current.connect = next;
    },
    // `pg-pool`'s own `query` acquires through the instance's `connect` and releases with
    // `client.release(err)` — the contract that lets wrapping `connect` alone cover both
    // acquisition entry points.
    query: () => new Promise<void>((resolve, reject) => {
      current.connect((err, client) => {
        if (err || !client) {
          reject(err ?? new Error('acquisition failed'));
          return;
        }
        client.release();
        resolve();
      });
    }),
  };
};

const createFakeClient = (): PoolClient => {
  const client = { release: vi.fn() };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock, partial object satisfies PoolClient interface in practice
  return client as unknown as PoolClient;
};

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock, partial object satisfies Pool interface in practice
const asPool = (pool: ReturnType<typeof createFakePool>) => pool as unknown as Pool;

// Set up before the very first `import('./db-metrics')` in this file: its meter is bound to
// whatever global provider is registered at module-load time, and ES module caching means every
// later dynamic import in this file returns the same already-initialised module.
const reader = new TestMetricReader({ aggregationTemporalitySelector: () => AggregationTemporality.CUMULATIVE });
const provider = new MeterProvider({ readers: [reader], views: droppedInstrumentViews });
metrics.setGlobalMeterProvider(provider);
const collect = () => reader.collect().then(({ resourceMetrics }) => resourceMetrics);

const dbMetrics = await import('./db-metrics');
const { computePoolName, registerDbPoolMetrics, instrumentPoolAcquisition, recordReconnectionAttempt, ACQUISITION_TIMEOUT_MESSAGES } = dbMetrics;

// A stub shaped like `instrumentation-pg`'s own producer, proving the drop view filters it out
// without touching `opencrq-db-engine`'s own producer of the same reclaimed semantic-convention
// pool names, whether or not the installed `instrumentation-pg` version implements a given one.
const pgMeter = provider.getMeter('@opentelemetry/instrumentation-pg');
pgMeter.createUpDownCounter('db.client.connection.count').add(1);
pgMeter.createUpDownCounter('db.client.connection.pending_requests').add(1);
// `instrumentation-pg` still emits the pool ceiling under its deprecated `.max` name.
pgMeter.createUpDownCounter('db.client.connection.max').add(1);
pgMeter.createUpDownCounter('db.client.connection.limit').add(1);
pgMeter.createHistogram('db.client.connection.wait_time').record(1);
pgMeter.createHistogram('db.client.connection.use_time').record(1);
pgMeter.createCounter('db.client.connection.timeouts').add(1);

describe('computePoolName', () => {
  it('joins host:port/database', () => {
    const pool = createFakePool({ totalCount: 0, idleCount: 0, waitingCount: 0, options: { host: 'db', port: 5432, database: 'opencrq' } }, () => Promise.resolve(createFakeClient()));
    expect(computePoolName(asPool(pool))).toBe('db:5432/opencrq');
  });

  it('falls back to unknown_* for missing fields', () => {
    const pool = createFakePool({ totalCount: 0, idleCount: 0, waitingCount: 0, options: {} }, () => Promise.resolve(createFakeClient()));
    expect(computePoolName(asPool(pool))).toBe('unknown_host:unknown_port/unknown_database');
  });
});

describe('db-metrics, against a real MeterProvider', () => {

  it('exposes pool state and capacity per process, with exactly one producer per contracted name', async () => {
    const pool = createFakePool(
      { totalCount: 3, idleCount: 1, waitingCount: 0, options: { host: 'saturation-guard', port: 5432, database: 'opencrq', max: 20 } },
      () => Promise.resolve(createFakeClient()),
    );
    registerDbPoolMetrics(asPool(pool));

    const resourceMetrics = await collect();

    const pgScopeNames = resourceMetrics.scopeMetrics
      .filter((scope) => scope.scope.name === '@opentelemetry/instrumentation-pg')
      .flatMap((scope) => scope.metrics.map((metric) => metric.descriptor.name));
    expect(pgScopeNames).not.toContain('db.client.connection.count');
    expect(pgScopeNames).not.toContain('db.client.connection.pending_requests');
    expect(pgScopeNames).not.toContain('db.client.connection.max');
    expect(pgScopeNames).not.toContain('db.client.connection.limit');
    expect(pgScopeNames).not.toContain('db.client.connection.wait_time');
    expect(pgScopeNames).not.toContain('db.client.connection.use_time');
    expect(pgScopeNames).not.toContain('db.client.connection.timeouts');

    expect(findGaugeValue(resourceMetrics, 'db.client.connection.count', 'saturation-guard:5432/opencrq', 'used')).toBe(2);
    expect(findGaugeValue(resourceMetrics, 'db.client.connection.count', 'saturation-guard:5432/opencrq', 'idle')).toBe(1);
    expect(findGaugeValue(resourceMetrics, 'db.client.connection.pending_requests', 'saturation-guard:5432/opencrq')).toBe(0);
    expect(findGaugeValue(resourceMetrics, 'db.client.connection.limit', 'saturation-guard:5432/opencrq')).toBe(20);
  });

  it('reports the pool state current at collection, not the state captured at registration', async () => {
    const poolState = { totalCount: 3, idleCount: 3, waitingCount: 0, options: { host: 'live-read', port: 5432, database: 'opencrq', max: 20 } };
    registerDbPoolMetrics(asPool(createFakePool(poolState, () => Promise.resolve(createFakeClient()))));

    const before = await collect();
    expect(findGaugeValue(before, 'db.client.connection.count', 'live-read:5432/opencrq', 'used')).toBe(0);
    expect(findGaugeValue(before, 'db.client.connection.pending_requests', 'live-read:5432/opencrq')).toBe(0);

    Object.assign(poolState, { totalCount: 20, idleCount: 0, waitingCount: 4 });

    const saturated = await collect();
    expect(findGaugeValue(saturated, 'db.client.connection.count', 'live-read:5432/opencrq', 'used')).toBe(20);
    expect(findGaugeValue(saturated, 'db.client.connection.count', 'live-read:5432/opencrq', 'idle')).toBe(0);
    expect(findGaugeValue(saturated, 'db.client.connection.pending_requests', 'live-read:5432/opencrq')).toBe(4);
  });

  it('records acquisition wait time on both entry points, the implicit one inside pool.query() and an explicit pool.connect()', async () => {
    const client = createFakeClient();
    const pool = createFakePool(
      { totalCount: 1, idleCount: 0, waitingCount: 0, options: { host: 'both-paths', port: 5432, database: 'opencrq', max: 20 } },
      (callback) => {
        if (callback) {
          callback(undefined, client, client.release);
          return undefined;
        }
        return Promise.resolve(client);
      },
    );
    instrumentPoolAcquisition(asPool(pool));

    await asPool(pool).connect();
    await pool.query();

    const resourceMetrics = await collect();
    expect(findHistogramValue(resourceMetrics, 'db.client.connection.wait_time', 'opencrq-db-engine', 'both-paths:5432/opencrq')?.count).toBe(2);
  });

  it('records hold duration for a connection acquired through pool.query()', async () => {
    const client = createFakeClient();
    const pool = createFakePool(
      { totalCount: 1, idleCount: 0, waitingCount: 0, options: { host: 'query-hold', port: 5432, database: 'opencrq', max: 20 } },
      (callback) => {
        callback?.(undefined, client, client.release);
        return undefined;
      },
    );
    instrumentPoolAcquisition(asPool(pool));

    await pool.query();

    const resourceMetrics = await collect();
    expect(findHistogramValue(resourceMetrics, 'db.client.connection.use_time', 'opencrq-db-engine', 'query-hold:5432/opencrq')?.count).toBe(1);
  });

  it('records a wait sample for an acquisition that never obtains a connection', async () => {
    const pool = createFakePool(
      { totalCount: 20, idleCount: 0, waitingCount: 8, options: { host: 'failed-wait', port: 5432, database: 'opencrq', max: 20 } },
      () => Promise.reject(new Error('timeout exceeded when trying to connect')),
    );
    instrumentPoolAcquisition(asPool(pool));

    await expect(asPool(pool).connect()).rejects.toThrow('timeout exceeded when trying to connect');

    const resourceMetrics = await collect();
    const waited = findHistogramValue(resourceMetrics, 'db.client.connection.wait_time', 'opencrq-db-engine', 'failed-wait:5432/opencrq');
    expect(waited?.count).toBe(1);
    expect(waited?.buckets.boundaries).toEqual(DB_HISTOGRAM_BUCKET_BOUNDARIES);
  });

  it('records hold duration when the acquired client is released', async () => {
    const client = createFakeClient();
    // Captured before `instrumentPoolAcquisition` wraps `client.release` in place.
    const originalRelease = client.release;
    const pool = createFakePool(
      { totalCount: 1, idleCount: 0, waitingCount: 0, options: { host: 'hold-duration', port: 5432, database: 'opencrq', max: 20 } },
      () => Promise.resolve(client),
    );
    instrumentPoolAcquisition(asPool(pool));

    const acquired = await asPool(pool).connect();
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
    acquired.release();

    const resourceMetrics = await collect();
    const held = findHistogramValue(resourceMetrics, 'db.client.connection.use_time', 'opencrq-db-engine', 'hold-duration:5432/opencrq');
    expect(held?.count).toBe(1);
    // Bounded on both sides: a `> 0` assertion alone also passes for milliseconds and nanoseconds,
    // on an instrument declared `unit: 's'`.
    expect(held?.sum).toBeGreaterThan(0.001);
    expect(held?.sum).toBeLessThan(1);
    expect(held?.buckets.boundaries).toEqual(DB_CONNECTION_USE_TIME_HISTOGRAM_BUCKET_BOUNDARIES);
    expect(originalRelease).toHaveBeenCalledTimes(1);
  });

  it('records hold duration when the caller releases through the callback done argument', async () => {
    const client = createFakeClient();
    const pool = createFakePool(
      { totalCount: 1, idleCount: 0, waitingCount: 0, options: { host: 'done-release', port: 5432, database: 'opencrq', max: 20 } },
      // `pg-pool` hands the callback the raw `client.release` it captured before any wrapping.
      (callback) => {
        callback?.(undefined, client, client.release);
        return undefined;
      },
    );
    instrumentPoolAcquisition(asPool(pool));

    await new Promise<void>((resolve) => {
      asPool(pool).connect((_err, _client, done) => {
        done?.();
        resolve();
      });
    });

    const resourceMetrics = await collect();
    expect(findHistogramValue(resourceMetrics, 'db.client.connection.use_time', 'opencrq-db-engine', 'done-release:5432/opencrq')?.count).toBe(1);
  });

  it('counts both pg-pool connection-timeout expiries and discriminates them from any other acquisition failure', async () => {
    const queueTimeoutPool = createFakePool(
      { totalCount: 0, idleCount: 0, waitingCount: 0, options: { host: 'queue-timeout', port: 5432, database: 'opencrq', max: 20 } },
      () => Promise.reject(new Error('timeout exceeded when trying to connect')),
    );
    instrumentPoolAcquisition(asPool(queueTimeoutPool));
    await expect(asPool(queueTimeoutPool).connect()).rejects.toThrow('timeout exceeded when trying to connect');

    const connectTimeoutPool = createFakePool(
      { totalCount: 0, idleCount: 0, waitingCount: 0, options: { host: 'connect-timeout', port: 5432, database: 'opencrq', max: 20 } },
      () => Promise.reject(new Error('Connection terminated due to connection timeout')),
    );
    instrumentPoolAcquisition(asPool(connectTimeoutPool));
    await expect(asPool(connectTimeoutPool).connect()).rejects.toThrow('Connection terminated due to connection timeout');

    const otherFailurePool = createFakePool(
      { totalCount: 0, idleCount: 0, waitingCount: 0, options: { host: 'other-failure', port: 5432, database: 'opencrq', max: 20 } },
      () => Promise.reject(new Error('connection refused')),
    );
    instrumentPoolAcquisition(asPool(otherFailurePool));
    await expect(asPool(otherFailurePool).connect()).rejects.toThrow('connection refused');

    const resourceMetrics = await collect();
    const timeouts = findMetric(resourceMetrics, 'db.client.connection.timeouts', 'opencrq-db-engine');
    expect(timeouts?.dataPoints.find((dp) => dp.attributes[ATTR_DB_CLIENT_CONNECTION_POOL_NAME] === 'queue-timeout:5432/opencrq')?.value).toBe(1);
    expect(timeouts?.dataPoints.find((dp) => dp.attributes[ATTR_DB_CLIENT_CONNECTION_POOL_NAME] === 'connect-timeout:5432/opencrq')?.value).toBe(1);
    expect(timeouts?.dataPoints.find((dp) => dp.attributes[ATTR_DB_CLIENT_CONNECTION_POOL_NAME] === 'other-failure:5432/opencrq')).toBeUndefined();
  });

  it('increments the reconnection-attempt counter by exactly 1 per call, carrying poolName', async () => {
    const pool = createFakePool(
      { totalCount: 0, idleCount: 0, waitingCount: 0, options: { host: 'flapping', port: 5432, database: 'opencrq', max: 20 } },
      () => Promise.resolve(createFakeClient()),
    );
    recordReconnectionAttempt(asPool(pool));
    recordReconnectionAttempt(asPool(pool));

    const resourceMetrics = await collect();
    const reconnections = findMetric(resourceMetrics, 'opencrq.db.client.connection.reconnection_attempts', 'opencrq-db-engine');
    expect(reconnections?.dataPoints.find((dp) => dp.attributes[ATTR_DB_CLIENT_CONNECTION_POOL_NAME] === 'flapping:5432/opencrq')?.value).toBe(2);
  });

  it('still counts an acquisition failure as a timeout when it takes at least connectionTimeoutMillis, even under a message a future pg-pool version might use instead', async () => {
    const pool = createFakePool(
      { totalCount: 0, idleCount: 0, waitingCount: 0, options: { host: 'reworded-timeout', port: 5432, database: 'opencrq', max: 20, connectionTimeoutMillis: 10 } },
      () => new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error('some future pg-pool wording')), 20);
      }),
    );
    instrumentPoolAcquisition(asPool(pool));

    await expect(asPool(pool).connect()).rejects.toThrow('some future pg-pool wording');

    const resourceMetrics = await collect();
    const timeouts = findMetric(resourceMetrics, 'db.client.connection.timeouts', 'opencrq-db-engine');
    expect(timeouts?.dataPoints.find((dp) => dp.attributes[ATTR_DB_CLIENT_CONNECTION_POOL_NAME] === 'reworded-timeout:5432/opencrq')?.value).toBe(1);
  });

  it('does not count a fast, unrelated acquisition failure as a timeout even when connectionTimeoutMillis is configured', async () => {
    const pool = createFakePool(
      { totalCount: 0, idleCount: 0, waitingCount: 0, options: { host: 'fast-failure', port: 5432, database: 'opencrq', max: 20, connectionTimeoutMillis: 5_000 } },
      () => Promise.reject(new Error('connection refused')),
    );
    instrumentPoolAcquisition(asPool(pool));

    await expect(asPool(pool).connect()).rejects.toThrow('connection refused');

    const resourceMetrics = await collect();
    const timeouts = findMetric(resourceMetrics, 'db.client.connection.timeouts', 'opencrq-db-engine');
    expect(timeouts?.dataPoints.find((dp) => dp.attributes[ATTR_DB_CLIENT_CONNECTION_POOL_NAME] === 'fast-failure:5432/opencrq')).toBeUndefined();
  });
});

describe('ACQUISITION_TIMEOUT_MESSAGES, against the installed pg-pool package', () => {
  it('still appears verbatim in pg-pool\u2019s own source, catching a dependency bump that rewords it', () => {
    const require = createRequire(import.meta.url);
    const pgPoolSource = readFileSync(require.resolve('pg-pool'), 'utf8');

    for (const message of ACQUISITION_TIMEOUT_MESSAGES) {
      expect(pgPoolSource).toContain(message);
    }
  });
});
