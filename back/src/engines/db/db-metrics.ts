import { metrics } from '@opentelemetry/api';
import type { Pool, PoolClient } from 'pg';
import {
  ATTR_DB_CLIENT_CONNECTION_POOL_NAME,
  ATTR_DB_CLIENT_CONNECTION_STATE,
  DB_CLIENT_CONNECTION_STATE_VALUE_IDLE,
  DB_CLIENT_CONNECTION_STATE_VALUE_USED,
  METRIC_DB_CLIENT_CONNECTION_COUNT,
  METRIC_DB_CLIENT_CONNECTION_LIMIT,
  METRIC_DB_CLIENT_CONNECTION_PENDING_REQUESTS,
  METRIC_DB_CLIENT_CONNECTION_TIMEOUTS,
  METRIC_DB_CLIENT_CONNECTION_USE_TIME,
  METRIC_DB_CLIENT_CONNECTION_WAIT_TIME,
} from '@opentelemetry/semantic-conventions/incubating';
import { DB_CONNECTION_USE_TIME_HISTOGRAM_BUCKET_BOUNDARIES, DB_HISTOGRAM_BUCKET_BOUNDARIES } from '../../utils/metrics-views';

const meter = metrics.getMeter('opencrq-db-engine');

const acquisitionWaitTime = meter.createHistogram(METRIC_DB_CLIENT_CONNECTION_WAIT_TIME, {
  description: 'The time it took to obtain an open connection from the pool, including waits that ended in a failure.',
  unit: 's',
  advice: { explicitBucketBoundaries: DB_HISTOGRAM_BUCKET_BOUNDARIES },
});
const acquisitionUseTime = meter.createHistogram(METRIC_DB_CLIENT_CONNECTION_USE_TIME, {
  description: 'The time between borrowing a connection and returning it to the pool.',
  unit: 's',
  advice: { explicitBucketBoundaries: DB_CONNECTION_USE_TIME_HISTOGRAM_BUCKET_BOUNDARIES },
});
const acquisitionTimeouts = meter.createCounter(METRIC_DB_CLIENT_CONNECTION_TIMEOUTS, {
  description: 'The number of connection requests that timed out before a connection could be obtained.',
  unit: '{timeout}',
});
// The only authored instrument carrying the `opencrq.` prefix — every other one reclaims an
// unprefixed semantic-convention name.
const reconnectionAttempts = meter.createCounter('opencrq.db.client.connection.reconnection_attempts', {
  description: 'The number of attempts made to re-establish the database connection after the pool reported an error.',
  unit: '{attempt}',
});

// `pg-pool` expires `connectionTimeoutMillis` on two paths — waiting in queue for a busy pool,
// and a new client failing to connect — and neither error carries a `.code`, so these exact
// messages are the primary discriminator. Exported so a test can assert they still appear
// verbatim in the installed `pg-pool` source, since a version bump could reword them silently.
export const ACQUISITION_TIMEOUT_MESSAGES = new Set([
  'timeout exceeded when trying to connect',
  'Connection terminated due to connection timeout',
]);

// A few milliseconds of slack: the pool's own timer can fire fractionally before this wrapper's
// `process.hrtime` sample is taken, which would otherwise put the elapsed wait just under
// `connectionTimeoutMillis`.
const TIMEOUT_DURATION_TOLERANCE_MS = 5;

const elapsedSeconds = (startedAt: bigint): number => Number(process.hrtime.bigint() - startedAt) / 1e9;

// Matches `instrumentation-pg`'s own `getPoolName` algorithm, so these metrics carry the same
// pool identifier the adopted instrumentation would have used. Two pools on the same database
// compute the same name, so a second one must be named explicitly or its series collide.
export const computePoolName = (pool: Pool): string => {
  const { host, port, database } = pool.options;
  return `${host ? `${host}` : 'unknown_host'}:${port ? `${port}` : 'unknown_port'}/${database ? `${database}` : 'unknown_database'}`;
};

// Reads the pool's own synchronous getters directly: `instrumentation-pg`'s gauges only update
// from pool events, which stop firing the instant the pool saturates — freezing at exactly the
// moment they matter.
export const registerDbPoolMetrics = (pool: Pool, poolName: string = computePoolName(pool)): void => {
  const poolAttributes = { [ATTR_DB_CLIENT_CONNECTION_POOL_NAME]: poolName };

  meter.createObservableGauge(METRIC_DB_CLIENT_CONNECTION_COUNT, {
    description: 'The number of connections currently in the state described by the state attribute.',
    unit: '{connection}',
  }).addCallback((observableResult) => {
    observableResult.observe(pool.totalCount - pool.idleCount, { ...poolAttributes, [ATTR_DB_CLIENT_CONNECTION_STATE]: DB_CLIENT_CONNECTION_STATE_VALUE_USED });
    observableResult.observe(pool.idleCount, { ...poolAttributes, [ATTR_DB_CLIENT_CONNECTION_STATE]: DB_CLIENT_CONNECTION_STATE_VALUE_IDLE });
  });

  meter.createObservableGauge(METRIC_DB_CLIENT_CONNECTION_PENDING_REQUESTS, {
    description: 'The number of callers currently waiting for a connection from the pool.',
    unit: '{request}',
  }).addCallback((observableResult) => {
    observableResult.observe(pool.waitingCount, poolAttributes);
  });

  meter.createObservableGauge(METRIC_DB_CLIENT_CONNECTION_LIMIT, {
    description: 'The maximum number of connections the pool is configured to open.',
    unit: '{connection}',
  }).addCallback((observableResult) => {
    // `Pool['options']` types `max` as optional even though `pg-pool`'s constructor always
    // resolves it.
    const { max } = pool.options;
    if (max !== undefined) {
      observableResult.observe(max, poolAttributes);
    }
  });
};

// `Parameters<>` on an overloaded function resolves against the last signature — `connect`'s
// callback form, the one we need here.
type ConnectCallback = Parameters<Pool['connect']>[0];

interface PoolConnect {
  (): Promise<PoolClient>,
  (callback: ConnectCallback): void,
}

// Wraps the pool's own `connect`, the single entry point `pool.query()` also calls internally,
// so one wrap covers both acquisition entry points: the implicit one inside `pool.query()` and
// an explicit `pool.connect()`.
export const instrumentPoolAcquisition = (pool: Pool, poolName: string = computePoolName(pool)): void => {
  const poolAttributes = { [ATTR_DB_CLIENT_CONNECTION_POOL_NAME]: poolName };
  const originalConnect: PoolConnect = pool.connect.bind(pool);

  const wrapRelease = (client: PoolClient): PoolClient => {
    const holdStart = process.hrtime.bigint();
    const originalRelease = client.release.bind(client);
    client.release = (err?: Error | boolean) => {
      // Measured before delegating: `pg-pool`'s release hands the connection to the next waiter
      // and runs its callback inline. Recorded after, so a double release throws without adding a
      // sample.
      const held = elapsedSeconds(holdStart);
      originalRelease(err);
      acquisitionUseTime.record(held, poolAttributes);
    };
    return client;
  };

  // Message matching is the primary signal; a failed acquisition that took at least as long as
  // the pool's own configured `connectionTimeoutMillis` is counted too, so a future `pg-pool`
  // wording change doesn't silently stop these from being counted as timeouts.
  const isAcquisitionTimeout = (err: unknown, waitedSeconds: number): boolean => {
    if (err instanceof Error && ACQUISITION_TIMEOUT_MESSAGES.has(err.message)) {
      return true;
    }
    const { connectionTimeoutMillis } = pool.options;
    return Boolean(connectionTimeoutMillis) && waitedSeconds * 1000 >= connectionTimeoutMillis! - TIMEOUT_DURATION_TOLERANCE_MS;
  };

  const recordIfTimeout = (err: unknown, waitedSeconds: number): void => {
    if (err && isAcquisitionTimeout(err, waitedSeconds)) {
      acquisitionTimeouts.add(1, poolAttributes);
    }
  };

  const wrappedConnect = (callback?: ConnectCallback) => {
    const waitStart = process.hrtime.bigint();

    if (callback) {
      originalConnect((err, client, done) => {
        const waited = elapsedSeconds(waitStart);
        // Recorded on the failure path too: a wait that ends in a timeout is the longest wait the
        // pool ever produces, and excluding it would make the histogram improve under saturation.
        acquisitionWaitTime.record(waited, poolAttributes);
        if (err || !client) {
          recordIfTimeout(err, waited);
          callback(err, client, done);
          return;
        }
        // `pg-pool` hands the callback the raw `client.release` captured before this wrapper
        // replaced it, so the documented `done()` idiom would otherwise skip the hold timing.
        const instrumented = wrapRelease(client);
        callback(undefined, instrumented, instrumented.release);
      });
      return undefined;
    }

    // Two handlers rather than a chained `.catch`, so a throw from the success path cannot also
    // run the failure path and record a second sample for the same acquisition.
    return originalConnect().then((client) => {
      acquisitionWaitTime.record(elapsedSeconds(waitStart), poolAttributes);
      return wrapRelease(client);
    }, (err: unknown) => {
      const waited = elapsedSeconds(waitStart);
      acquisitionWaitTime.record(waited, poolAttributes);
      recordIfTimeout(err, waited);
      throw err;
    });
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- reassigning an overloaded method to a single implementation function; both call signatures above match `Pool['connect']` exactly
  pool.connect = wrappedConnect as Pool['connect'];
};

export const recordReconnectionAttempt = (pool: Pool, poolName: string = computePoolName(pool)): void => {
  reconnectionAttempts.add(1, { [ATTR_DB_CLIENT_CONNECTION_POOL_NAME]: poolName });
};
