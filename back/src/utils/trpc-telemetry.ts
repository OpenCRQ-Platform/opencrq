import type { Attributes } from '@opentelemetry/api';
import { metrics } from '@opentelemetry/api';
import { ATTR_ERROR_TYPE, ERROR_TYPE_VALUE_OTHER } from '@opentelemetry/semantic-conventions';
import { TRPCError } from '@trpc/server';
import { TRPC_ERROR_CODES_BY_KEY } from '@trpc/server/rpc';
import { createLogger } from './logger';
import { TRPC_HISTOGRAM_BUCKET_BOUNDARIES } from './metrics-views';

const meter = metrics.getMeter('opencrq-trpc');
const { logTrace, logError } = createLogger({ engine: 'http-server' });

export const ATTR_TRPC_PROCEDURE = 'trpc.procedure';
export const ATTR_TRPC_TYPE = 'trpc.type';

// The histograms say a procedure got slower; this says which call did, and how much data it was
// carrying. Kept well above a healthy call so the log stays an exception, not a per-request line.
export const SLOW_CALL_THRESHOLD_SECONDS = 0.5;

const callDuration = meter.createHistogram('opencrq.trpc.server.duration', {
  description: 'Duration of a single tRPC procedure call, output validation included, serialization excluded.',
  unit: 's',
  advice: { explicitBucketBoundaries: TRPC_HISTOGRAM_BUCKET_BOUNDARIES },
});

// The procedure name lives on this counter, never on the histogram: the router's ~250 procedures
// against a 6-boundary histogram would be nine exposed lines each instead of one.
const calls = meter.createCounter('opencrq.trpc.server.calls', {
  description: 'tRPC procedure calls, by procedure and outcome.',
  unit: '{call}',
});

const TRPC_ERROR_CODES = new Set<string>(Object.keys(TRPC_ERROR_CODES_BY_KEY));

// Checked against tRPC's own set rather than trusted: the throw path carries arbitrary errors, and
// a Postgres SQLSTATE or a Node errno lands in `code` too, which would open an unbounded label.
const trpcErrorType = (error: unknown): string => {
  if (error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && TRPC_ERROR_CODES.has(error.code)) {
    return error.code;
  }
  return ERROR_TYPE_VALUE_OTHER;
};

const elapsedSeconds = (startedAt: bigint): number => Number(process.hrtime.bigint() - startedAt) / 1e9;

type TrpcCallResult = { ok: boolean, data?: unknown, error?: unknown };

/**
 * Measures one tRPC procedure resolution: its duration, on a histogram carrying no procedure
 * label, and its call, on a per-procedure counter. Subscriptions pass through unmeasured: their
 * `next()` spans the stream's whole lifetime, which would poison a request-latency histogram.
 *
 * Over `maxResponseItems` the call is refused: serializing an array sized on a tenant's estate
 * exhausts the heap, and V8 kills the process rather than the request.
 */
export const instrumentTrpcCall = async <R extends TrpcCallResult>(
  path: string,
  type: 'query' | 'mutation' | 'subscription',
  invoke: () => Promise<R>,
  { maxResponseItems }: { maxResponseItems: number },
): Promise<R> => {
  if (type === 'subscription') {
    return invoke();
  }
  const attributes: Attributes = { [ATTR_TRPC_TYPE]: type };
  const startedAt = process.hrtime.bigint();
  let items: number | undefined;

  try {
    const result = await invoke();
    if (result.ok) {
      if (Array.isArray(result.data)) {
        items = result.data.length;
        if (items > maxResponseItems) {
          logError('tRPC response over the item ceiling, refusing to serialize it', {
            procedure: path,
            type,
            items,
            maxResponseItems,
          });
          throw new TRPCError({
            code: 'PAYLOAD_TOO_LARGE',
            message: `${path} returned ${items} items, over the ${maxResponseItems} ceiling. This procedure needs a paginated input.`,
          });
        }
      }
    } else {
      attributes[ATTR_ERROR_TYPE] = trpcErrorType(result.error);
    }
    return result;
  } catch (error) {
    // A procedure error resolves as `{ ok: false }`; reaching here means the chain itself threw.
    attributes[ATTR_ERROR_TYPE] = trpcErrorType(error);
    throw error;
  } finally {
    // In `finally` so every outcome, thrown ones included, is measured once and judged against
    // the threshold by the same code.
    const elapsed = elapsedSeconds(startedAt);
    callDuration.record(elapsed, attributes);
    calls.add(1, { ...attributes, [ATTR_TRPC_PROCEDURE]: path });
    if (elapsed >= SLOW_CALL_THRESHOLD_SECONDS) {
      logTrace('Slow tRPC call', {
        procedure: path,
        type,
        durationMs: Math.round(elapsed * 1000),
        items,
      });
    }
  }
};
