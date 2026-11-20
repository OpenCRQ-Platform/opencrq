import type { Attributes } from '@opentelemetry/api';
import { AggregationType } from '@opentelemetry/sdk-metrics';
import type { ViewOptions } from '@opentelemetry/sdk-metrics';
import { ATTR_DB_NAMESPACE, ATTR_DB_OPERATION_NAME, ATTR_DB_SYSTEM_NAME, ATTR_ERROR_TYPE, ATTR_SERVER_ADDRESS, ATTR_SERVER_PORT, ERROR_TYPE_VALUE_OTHER, METRIC_DB_CLIENT_OPERATION_DURATION } from '@opentelemetry/semantic-conventions';

// A top boundary is the most `histogram_quantile` can ever report, so none of these lists may be
// lowered below what a bad day produces; the low ones are what a good day needs. Defined here
// (a side-effect-free module) so importing one never triggers `db-metrics.ts`'s meter/instrument
// creation before the global meter provider is registered.

// Queries run 1-50ms, which is why this list keeps resolution below 100ms where OpenCTI's own
// boundaries have none. 60s, not 120s: a query or a pool wait past a minute is a dead deployment.
export const DB_HISTOGRAM_BUCKET_BOUNDARIES = [0.005, 0.025, 0.1, 0.5, 2, 10, 60];

// `db.client.connection.use_time` times the whole borrow, not a query, and most borrows release at
// the same low end as the list above — except a caller that holds the connection across many
// statements: the platform seed for its whole run, a Microsoft Graph sync for its whole run, both
// well past a minute on a healthy deployment. The extra buckets past 60s are for those.
export const DB_CONNECTION_USE_TIME_HISTOGRAM_BUCKET_BOUNDARIES = [0.005, 0.025, 0.1, 0.5, 2, 10, 60, 300, 1800];

// tRPC wants the opposite end: a 5ms call is not interesting, a 47s one is. 120s is the ceiling
// that made the 2026-09-04 incident measurable — 30s reported it flat, 10s would have hidden it.
export const TRPC_HISTOGRAM_BUCKET_BOUNDARIES = [0.05, 0.25, 1, 5, 30, 120];

// Upstream's own `advice` goes to 10: an 8s major GC under heap pressure is exactly the pause
// worth putting a number on, and one extra boundary is one extra line per process.
export const GC_HISTOGRAM_BUCKET_BOUNDARIES = [0.001, 0.01, 0.1, 1, 5, 10];

// Auto-instrumentation instruments we don't expose. `db.client.connection.*` is scoped by
// meterName so the drop only hits instrumentation-pg's own producer, not a same-named one
// registered later.
export const droppedInstrumentViews: Array<ViewOptions> = [
  { instrumentName: 'http.server.*', aggregation: { type: AggregationType.DROP } },
  { instrumentName: 'http.client.*', aggregation: { type: AggregationType.DROP } },
  { instrumentName: 'system.*', aggregation: { type: AggregationType.DROP } },
  { instrumentName: 'db.client.connection.count', meterName: '@opentelemetry/instrumentation-pg', aggregation: { type: AggregationType.DROP } },
  { instrumentName: 'db.client.connection.pending_requests', meterName: '@opentelemetry/instrumentation-pg', aggregation: { type: AggregationType.DROP } },
  // Deprecated upstream name for the pool ceiling, which `opencrq-db-engine` emits as `.limit`.
  { instrumentName: 'db.client.connection.max', meterName: '@opentelemetry/instrumentation-pg', aggregation: { type: AggregationType.DROP } },
  // The other four semantic-convention pool names this codebase reclaims. Inert against a
  // version of `instrumentation-pg` that implements none of them; they exist so a future one
  // that does cannot collide.
  { instrumentName: 'db.client.connection.limit', meterName: '@opentelemetry/instrumentation-pg', aggregation: { type: AggregationType.DROP } },
  { instrumentName: 'db.client.connection.wait_time', meterName: '@opentelemetry/instrumentation-pg', aggregation: { type: AggregationType.DROP } },
  { instrumentName: 'db.client.connection.use_time', meterName: '@opentelemetry/instrumentation-pg', aggregation: { type: AggregationType.DROP } },
  { instrumentName: 'db.client.connection.timeouts', meterName: '@opentelemetry/instrumentation-pg', aggregation: { type: AggregationType.DROP } },
  // Three families reporting the same heap spaces `v8js.memory.heap.used` already covers.
  { instrumentName: 'v8js.memory.heap.space.*', aggregation: { type: AggregationType.DROP } },
  // The one unbounded-cardinality attribute this endpoint would otherwise carry: whatever libuv
  // resource kinds the process currently holds, growing with what the application does.
  { instrumentName: 'v8js.resource.active', aggregation: { type: AggregationType.DROP } },
  // `max`, `mean` and `p99` are the three a human reads; these four are not.
  { instrumentName: 'nodejs.eventloop.delay.min', aggregation: { type: AggregationType.DROP } },
  { instrumentName: 'nodejs.eventloop.delay.stddev', aggregation: { type: AggregationType.DROP } },
  { instrumentName: 'nodejs.eventloop.delay.p50', aggregation: { type: AggregationType.DROP } },
  { instrumentName: 'nodejs.eventloop.delay.p90', aggregation: { type: AggregationType.DROP } },
];

// The read/write split a panel reads; transaction control and DDL fold into the `_OTHER`
// sentinel below, since `db_client_connection_use_time` already covers their latency.
const ALLOWED_OPERATION_NAMES = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE']);

// Own sentinel, not `ERROR_TYPE_VALUE_OTHER`: same "outside the known set" convention, but
// `db.operation.name` is a different attribute than `error.type`.
const DB_OPERATION_NAME_VALUE_OTHER = '_OTHER';

// Absent stays absent: collapsing "undeterminable" into "outside the allowlist" would make the
// two indistinguishable.
export const allowlistOperationName = (value: Attributes[string]): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  return typeof value === 'string' && ALLOWED_OPERATION_NAMES.has(value) ? value : DB_OPERATION_NAME_VALUE_OTHER;
};

// SQLSTATE classes (first two chars of the 5-char code) a Postgres app actually produces:
// connection loss, constraint violations, auth/catalog misconfiguration, permission errors,
// resource exhaustion. Anything else, or a malformed code, becomes `_OTHER`. An admitted code is
// kept in full rather than collapsed to its class.
const ALLOWED_SQLSTATE_CLASSES = new Set(['08', '22', '23', '25', '28', '3D', '40', '42', '53', '55', '57', '58', 'XX']);
const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;

export const allowlistErrorType = (value: Attributes[string]): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'string' && SQLSTATE_PATTERN.test(value) && ALLOWED_SQLSTATE_CLASSES.has(value.slice(0, 2))) {
    return value;
  }
  return ERROR_TYPE_VALUE_OTHER;
};

// Attributes kept besides the two allowlisted values. The first three identify the DB server and
// join this histogram to the pool metrics, whose pool name is
// `server.address:server.port/db.namespace` — `instrumentation-pg` never sets a pool name on this
// histogram itself. `db.system.name` is required by the semantic convention on this instrument.
const PRESERVED_ATTRIBUTES = [ATTR_SERVER_ADDRESS, ATTR_SERVER_PORT, ATTR_DB_NAMESPACE, ATTR_DB_SYSTEM_NAME];

// `instrumentation-pg` copies `db.operation.name`/`error.type` straight from internal state into
// this histogram with no metrics hook (only spans have one) — a View's `attributesProcessors` is
// the only interception point without forking the instrumentation. `error.type` would otherwise
// be the raw 5-character SQLSTATE.
export const dbOperationDurationView: ViewOptions = {
  instrumentName: METRIC_DB_CLIENT_OPERATION_DURATION,
  meterName: '@opentelemetry/instrumentation-pg',
  attributesProcessors: [{
    process: (incoming: Attributes) => {
      // Explicit key list, not a spread, so a future instrumentation version can't leak a new
      // attribute through ungated.
      const result: Attributes = {};
      PRESERVED_ATTRIBUTES.forEach((key) => {
        if (incoming[key] !== undefined) {
          result[key] = incoming[key];
        }
      });
      const operationName = allowlistOperationName(incoming[ATTR_DB_OPERATION_NAME]);
      if (operationName !== undefined) {
        result[ATTR_DB_OPERATION_NAME] = operationName;
      }
      const errorType = allowlistErrorType(incoming[ATTR_ERROR_TYPE]);
      if (errorType !== undefined) {
        result[ATTR_ERROR_TYPE] = errorType;
      }
      return result;
    },
  }],
  // `advice` (the bucket-boundary hint) can only be set by the producer at instrument creation,
  // not through a View. `aggregation` can, since it replaces the aggregation outright — this is
  // how the same bucket boundaries apply to this adopted histogram, not just the authored ones.
  aggregation: { type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM, options: { boundaries: DB_HISTOGRAM_BUCKET_BOUNDARIES } },
};

// The four GC kinds' buckets sum correctly into one series.
export const gcDurationView: ViewOptions = {
  instrumentName: 'v8js.gc.duration',
  meterName: '@opentelemetry/instrumentation-runtime-node',
  description: 'Garbage collection duration, summed across every kind.',
  attributesProcessors: [{ process: () => ({}) }],
  aggregation: { type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM, options: { boundaries: GC_HISTOGRAM_BUCKET_BOUNDARIES } },
};
