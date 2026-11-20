import { request as httpRequest } from 'node:http';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { newError, StructuredError } from '@app/utils';

export type StreamEventType = 'create' | 'update' | 'delete' | 'merge' | 'heartbeat' | 'connected' | 'error';

export interface StreamEvent {
  id: string,
  event: StreamEventType,
  data: unknown,
}

// Not `@app/module`'s `NonRetryableError`: this client isn't a job handler, so the job retry
// policy never sees these. `runConsumerLoop` checks `instanceof` this instead.
export class OpenCtiStreamFatalError extends StructuredError {
  override readonly name: string = 'OpenCtiStreamFatalError';

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, { data: {}, ...options });
  }
}

// Lets the connector manager react specifically to a dead/disabled token by disabling the
// connector instead of endlessly reconnecting.
export class OpenCtiAuthError extends OpenCtiStreamFatalError {
  override readonly name: string = 'OpenCtiAuthError';
}

const CONNECT_TIMEOUT_MS = 60_000;
// A receive-only socket gets no OS-level notice when the network disappears — the read simply
// hangs forever. A healthy stream always heartbeats well within this window.
const IDLE_READ_TIMEOUT_MS = 90_000;
// Guards against a frame with no `\n\n` terminator ever arriving and growing the buffer without
// bound.
const MAX_BUFFER_SIZE_BYTES = 20 * 1024 * 1024;

export interface ConsumeOpenCtiStreamOptions {
  url: string,
  token: string,
  streamId: string,
  // Null with `needsRecover` replays the stream's entire history, null without it opens the stream at
  // its live edge.
  lastEventId: string | null,
  // True until the live tail has ever been reached — an out-of-retention `lastEventId` alone
  // silently skips to the live retention window, so a still-in-progress backfill must also send
  // `recover` to resume precisely from `lastEventId`.
  needsRecover: boolean,
  signal: AbortSignal,
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object';

/** Splits a raw byte buffer into complete SSE frames and parses each one's `id:`/`event:`/`data:`
  * fields. `data:` lines are the only multi-line field OpenCTI sends; joined with `\n`. */
const STREAM_EVENT_TYPES = new Set(['create', 'update', 'delete', 'merge', 'heartbeat', 'connected', 'error']);
const isStreamEventType = (value: string): value is StreamEventType => STREAM_EVENT_TYPES.has(value);

const parseSseFrame = (rawFrame: string): StreamEvent | null => {
  let id: string | null = null;
  let event: string | null = null;
  const dataLines: Array<string> = [];

  for (const line of rawFrame.split('\n')) {
    if (line.startsWith('id:')) {
      id = line.slice(3).trim();
    } else if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      // Only a single leading space after the colon is stripped (SSE spec) — the rest survives as-is.
      dataLines.push(line.startsWith('data: ') ? line.slice(6) : line.slice(5));
    }
  }

  // `connected`/`error` frames have no `id:` line — don't drop them for that reason alone.
  if (event === null || !isStreamEventType(event) || (id === null && event !== 'connected' && event !== 'error')) {
    return null;
  }

  const rawData = dataLines.join('\n');
  let data: unknown = null;
  if (rawData.length > 0) {
    try {
      data = JSON.parse(rawData);
    } catch {
      data = rawData;
    }
  }

  return { id: id ?? '', event, data };
};

// `recover` must accompany `from`/`Last-Event-ID` whenever it isn't a normal live resume position,
// or OpenCTI rejects the request — its own date value doesn't matter, any date works.
const formatRecoverDate = (date: Date): string =>
  `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}`;

const buildStreamUrl = ({ url, streamId, lastEventId, needsRecover }: ConsumeOpenCtiStreamOptions): URL => {
  const streamUrl = new URL(`${url.replace(/\/$/, '')}/stream/${streamId}`);
  // Inferred relationships are omitted by default; they are claims like any other and the
  // confidence gate is what decides whether they count.
  streamUrl.searchParams.set('with-inferences', 'true');
  // Without this, OpenCTI publishes the whole dependency closure of every element it matches under
  // that element's own event id, so one well connected intrusion set is a block of tens of
  // thousands of discarded objects during which the position cannot advance. Referenced objects
  // are resolved outside the flag's guard, so an admitted relationship still arrives with both ends.
  streamUrl.searchParams.set('no-dependencies', 'true');
  if (!lastEventId && needsRecover) {
    streamUrl.searchParams.set('from', '0-0');
    streamUrl.searchParams.set('recover', formatRecoverDate(new Date()));
  } else if (needsRecover) {
    streamUrl.searchParams.set('recover', formatRecoverDate(new Date()));
  }
  return streamUrl;
};

const waitForResponse = (req: ClientRequest): Promise<IncomingMessage> => new Promise((resolve, reject) => {
  req.once('response', resolve);
  req.once('error', reject);
});

/**
 * Consumes an OpenCTI Live Stream (SSE) and yields one `StreamEvent` per frame, until the body
 * ends or `signal` aborts — callers own reconnection.
 *
 * Uses `node:http`/`node:https` directly instead of `fetch()`: undici's default `Agent` applies a
 * hidden 300s idle-body timeout with no reliable way to disable it, which would kill a
 * legitimately idle Live Stream.
 */
export const consumeOpenCtiStream = async function* (options: ConsumeOpenCtiStreamOptions): AsyncGenerator<StreamEvent> {
  const { token, lastEventId, signal } = options;

  const streamUrl = buildStreamUrl(options);
  const requestFn = streamUrl.protocol === 'https:' ? httpsRequest : httpRequest;

  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' };
  if (lastEventId) {
    headers['Last-Event-ID'] = lastEventId;
  }

  const req = requestFn(streamUrl, { headers, signal });
  req.end();

  // Bounds only the initial connect, not the long-lived body read below. Node reports a generic
  // `Error: aborted` for any socket close, so `didTimeOut` tells our timeout apart from a real reset.
  let didTimeOut = false;
  const connectTimeout = setTimeout(() => {
    didTimeOut = true;
    req.destroy(newError(`OpenCTI stream connection timed out after ${CONNECT_TIMEOUT_MS}ms`));
  }, CONNECT_TIMEOUT_MS);

  let res: IncomingMessage;
  try {
    res = await waitForResponse(req);
  } catch (err) {
    throw didTimeOut ? newError(`OpenCTI stream connection timed out after ${CONNECT_TIMEOUT_MS}ms waiting for response headers`) : err;
  } finally {
    clearTimeout(connectTimeout);
  }

  if (res.statusCode === 401 || res.statusCode === 403) {
    res.resume();
    throw new OpenCtiAuthError(`OpenCTI stream auth error (${res.statusCode})`);
  }
  if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
    res.resume();
    throw newError(`OpenCTI stream error: ${res.statusCode}`);
  }

  const decoder = new TextDecoder();
  let buffer = '';
  const iterator: AsyncIterator<unknown> = res[Symbol.asyncIterator]();

  try {
    while (!signal.aborted) {
      let idleTimedOut = false;
      const idleTimeout = setTimeout(() => {
        idleTimedOut = true;
        res.destroy(newError(`OpenCTI stream received no data for ${IDLE_READ_TIMEOUT_MS}ms, assuming the connection is dead`));
      }, IDLE_READ_TIMEOUT_MS);

      let result: IteratorResult<unknown>;
      try {
        result = await iterator.next();
      } catch (err) {
        throw idleTimedOut ? newError(`OpenCTI stream received no data for ${IDLE_READ_TIMEOUT_MS}ms, assuming the connection is dead`) : err;
      } finally {
        clearTimeout(idleTimeout);
      }

      if (result.done) {
        break;
      }

      // `IncomingMessage`'s default AsyncIterable element type is `any`, but every chunk is a `Buffer`.
      const chunk = result.value;
      const bufferChunk: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      buffer += decoder.decode(bufferChunk, { stream: true });
      if (buffer.includes('\r')) {
        buffer = buffer.replace(/\r\n/g, '\n');
      }

      let separatorIndex: number;
      while ((separatorIndex = buffer.indexOf('\n\n')) !== -1) {
        const rawFrame = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        const parsed = parseSseFrame(rawFrame);
        if (parsed?.event === 'error') {
          // Fail fast instead of hanging silently on a stream-reported config error.
          const message = isRecord(parsed.data) && typeof parsed.data['message'] === 'string' ? parsed.data['message'] : 'unknown error';
          throw new OpenCtiStreamFatalError(`OpenCTI stream reported an error: ${message}`);
        }
        if (parsed) {
          yield parsed;
        }
      }

      if (Buffer.byteLength(buffer) > MAX_BUFFER_SIZE_BYTES) {
        throw newError(`OpenCTI stream frame exceeded ${MAX_BUFFER_SIZE_BYTES} bytes without a terminator, aborting connection`);
      }
    }
  } finally {
    res.destroy();
  }
}
