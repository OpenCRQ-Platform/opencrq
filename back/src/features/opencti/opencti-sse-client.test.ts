import { EventEmitter } from 'node:events';
import type { ClientRequest } from 'node:http';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:http', () => ({ request: vi.fn() }));
vi.mock('node:https', () => ({ request: vi.fn() }));

const { request: httpsRequest } = await import('node:https');
const { consumeOpenCtiStream, OpenCtiAuthError, OpenCtiStreamFatalError } = await import('./opencti-sse-client');

const collectEvents = async (stream: AsyncGenerator<unknown>) => {
  const events = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
};

/** Minimal fake `http.ClientRequest`: an `EventEmitter` with the `.end()`/`.destroy()` methods the client calls. */
class FakeRequest extends EventEmitter {
  end = vi.fn();

  destroy = vi.fn((err?: Error) => {
    if (err) {
      queueMicrotask(() => this.emit('error', err));
    }
  });
}

/** Fake `http.IncomingMessage`: a `Readable` body stream carrying a `statusCode`, pushed to manually. */
class FakeResponse extends Readable {
  statusCode: number;

  constructor(statusCode: number) {
    super();
    this.statusCode = statusCode;
  }

  override _read(): void {}
}

/** Test-only narrowing of a fake `ClientRequest`/`IncomingMessage` standing in for the real Node.js ones. */
const asClientRequest = (req: FakeRequest): ClientRequest => (
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test-only fake ClientRequest standing in for the real one
  req as unknown as ClientRequest
);

/** Stubs `https.request` (the only scheme exercised here) to emit a response with the given status/body. */
const mockHttpsResponse = (statusCode: number, body = ''): { req: FakeRequest, res: FakeResponse } => {
  const req = new FakeRequest();
  const res = new FakeResponse(statusCode);
  vi.mocked(httpsRequest).mockImplementationOnce(() => {
    queueMicrotask(() => {
      req.emit('response', res);
      if (body.length > 0) {
        res.push(Buffer.from(body));
      }
      res.push(null);
    });
    return asClientRequest(req);
  });
  return { req, res };
};

describe('consumeOpenCtiStream', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses id/event/data frames from the SSE body', async () => {
    const body = [
      'id: 1620249512318-0\n'
      + 'event: create\n'
      + 'data: {"data":{"id":"intrusion-set--a"}}\n\n',
      'id: 1620249512319-0\n'
      + 'event: heartbeat\n'
      + 'data: {}\n\n',
    ].join('');
    mockHttpsResponse(200, body);

    const events = await collectEvents(consumeOpenCtiStream({
      url: 'https://opencti.example.com',
      token: 'tok',
      streamId: 'live',
      lastEventId: null,
      needsRecover: false,
      signal: new AbortController().signal,
    }));

    expect(events).toEqual([
      { id: '1620249512318-0', event: 'create', data: { data: { id: 'intrusion-set--a' } } },
      { id: '1620249512319-0', event: 'heartbeat', data: {} },
    ]);
  });

  it('keeps the absorbed objects a merge frame carries beside its survivor, in context.sources', async () => {
    const body = 'id: 1620249512320-0\n'
      + 'event: merge\n'
      + 'data: {"version":"4","type":"merge","data":{"id":"intrusion-set--survivor","type":"intrusion-set"},'
      + '"context":{"patch":[],"reverse_patch":[],"sources":[{"id":"intrusion-set--absorbed","type":"intrusion-set"}]}}\n\n';
    mockHttpsResponse(200, body);

    const [event] = await collectEvents(consumeOpenCtiStream({
      url: 'https://opencti.example.com',
      token: 'tok',
      streamId: 'live',
      lastEventId: null,
      needsRecover: false,
      signal: new AbortController().signal,
    }));

    expect(event).toMatchObject({
      event: 'merge',
      data: {
        data: { id: 'intrusion-set--survivor' },
        context: { sources: [{ id: 'intrusion-set--absorbed' }] },
      },
    });
  });

  it('preserves leading whitespace within data beyond the single separator space (SSE spec)', async () => {
    const body = 'id: 1\nevent: create\ndata:   indented text\n\n';
    mockHttpsResponse(200, body);

    const [event] = await collectEvents(consumeOpenCtiStream({
      url: 'https://opencti.example.com',
      token: 'tok',
      streamId: 'live',
      lastEventId: null,
      needsRecover: false,
      signal: new AbortController().signal,
    }));

    expect(event).toMatchObject({ data: '  indented text' });
  });

  it('joins multi-line data fields with a newline', async () => {
    const body = 'id: 1\nevent: create\ndata: line one\ndata: line two\n\n';
    mockHttpsResponse(200, body);

    const [event] = await collectEvents(consumeOpenCtiStream({
      url: 'https://opencti.example.com',
      token: 'tok',
      streamId: 'live',
      lastEventId: null,
      needsRecover: false,
      signal: new AbortController().signal,
    }));

    expect(event).toMatchObject({ data: 'line one\nline two' });
  });

  it('sends from=0-0 and today\'s date as recover on a fresh connection (no persisted cursor)', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-07-30T10:00:00.000Z'));
      mockHttpsResponse(200);

      await collectEvents(consumeOpenCtiStream({
        url: 'https://opencti.example.com',
        token: 'tok',
        streamId: 'live',
        lastEventId: null,
        needsRecover: true,
        signal: new AbortController().signal,
      }));

      const [calledUrl] = vi.mocked(httpsRequest).mock.calls[0];
      expect(String(calledUrl)).toBe('https://opencti.example.com/stream/live?with-inferences=true&no-dependencies=true&from=0-0&recover=2026%2F07%2F30');
    } finally {
      vi.useRealTimers();
    }
  });

  it('takes no position at all when there is no cursor and the live tail was reached, opening the stream at its live edge', async () => {
    mockHttpsResponse(200);

    await collectEvents(consumeOpenCtiStream({
      url: 'https://opencti.example.com',
      token: 'tok',
      streamId: 'live',
      lastEventId: null,
      needsRecover: false,
      signal: new AbortController().signal,
    }));

    const [calledUrl, options] = vi.mocked(httpsRequest).mock.calls[0];
    expect(String(calledUrl)).toBe('https://opencti.example.com/stream/live?with-inferences=true&no-dependencies=true');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test-only narrowing of the mocked https.request call's headers
    const headers = (options as { headers: Record<string, string> }).headers;
    expect(headers['Last-Event-ID']).toBeUndefined();
  });

  it('sends Last-Event-ID and omits recover when resuming', async () => {
    mockHttpsResponse(200);

    await collectEvents(consumeOpenCtiStream({
      url: 'https://opencti.example.com',
      token: 'tok',
      streamId: 'live',
      lastEventId: '1620249512318-0',
      needsRecover: false,
      signal: new AbortController().signal,
    }));

    const [calledUrl, options] = vi.mocked(httpsRequest).mock.calls[0];
    expect(String(calledUrl)).toBe('https://opencti.example.com/stream/live?with-inferences=true&no-dependencies=true');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test-only narrowing of the mocked https.request call's headers
    const headers = (options as { headers: Record<string, string> }).headers;
    expect(headers['Last-Event-ID']).toBe('1620249512318-0');
    expect(headers['Authorization']).toBe('Bearer tok');
  });

  it('sends Last-Event-ID AND recover when resuming mid-backfill (needsRecover), to resume precisely instead of skipping to the live tail', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-07-30T10:00:00.000Z'));
      mockHttpsResponse(200);

      await collectEvents(consumeOpenCtiStream({
        url: 'https://opencti.example.com',
        token: 'tok',
        streamId: 'live',
        lastEventId: '1620249512318-0',
        needsRecover: true,
        signal: new AbortController().signal,
      }));

      const [calledUrl, options] = vi.mocked(httpsRequest).mock.calls[0];
      expect(String(calledUrl)).toBe('https://opencti.example.com/stream/live?with-inferences=true&no-dependencies=true&recover=2026%2F07%2F30');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test-only narrowing of the mocked https.request call's headers
      const headers = (options as { headers: Record<string, string> }).headers;
      expect(headers['Last-Event-ID']).toBe('1620249512318-0');
    } finally {
      vi.useRealTimers();
    }
  });

  it('throws OpenCtiAuthError (an OpenCtiStreamFatalError) on 401/403', async () => {
    mockHttpsResponse(401);

    const err = await collectEvents(consumeOpenCtiStream({
      url: 'https://opencti.example.com',
      token: 'tok',
      streamId: 'live',
      lastEventId: null,
      needsRecover: false,
      signal: new AbortController().signal,
    })).catch((e) => e);

    expect(err).toBeInstanceOf(OpenCtiAuthError);
    expect(err).toBeInstanceOf(OpenCtiStreamFatalError);
  });

  it('throws a plain Error on other non-ok statuses', async () => {
    mockHttpsResponse(500);

    const err = await collectEvents(consumeOpenCtiStream({
      url: 'https://opencti.example.com',
      token: 'tok',
      streamId: 'live',
      lastEventId: null,
      needsRecover: false,
      signal: new AbortController().signal,
    })).catch((e) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(OpenCtiStreamFatalError);
  });

  it('ignores frames missing an id or event field', async () => {
    const body = 'data: {"foo":"bar"}\n\nid: 1\nevent: create\ndata: {}\n\n';
    mockHttpsResponse(200, body);

    const events = await collectEvents(consumeOpenCtiStream({
      url: 'https://opencti.example.com',
      token: 'tok',
      streamId: 'live',
      lastEventId: null,
      needsRecover: false,
      signal: new AbortController().signal,
    }));

    expect(events).toEqual([{ id: '1', event: 'create', data: {} }]);
  });

  it('parses a connected frame despite it having no id field (unlike every other event type)', async () => {
    const body = 'event: connected\ndata: {"connectionId":"abc"}\n\n';
    mockHttpsResponse(200, body);

    const events = await collectEvents(consumeOpenCtiStream({
      url: 'https://opencti.example.com',
      token: 'tok',
      streamId: 'live',
      lastEventId: null,
      needsRecover: false,
      signal: new AbortController().signal,
    }));

    expect(events).toEqual([{ id: '', event: 'connected', data: { connectionId: 'abc' } }]);
  });

  it('throws immediately on an error frame instead of hanging until the connect timeout', async () => {
    const body = 'event: error\ndata: {"stream":"live","message":"Recovery mode is only possible with a start date."}\n\n';
    mockHttpsResponse(200, body);

    const err = await collectEvents(consumeOpenCtiStream({
      url: 'https://opencti.example.com',
      token: 'tok',
      streamId: 'live',
      lastEventId: null,
      needsRecover: false,
      signal: new AbortController().signal,
    })).catch((e) => e);

    expect(err).toBeInstanceOf(OpenCtiStreamFatalError);
    expect(err.message).toContain('Recovery mode is only possible with a start date.');
  });

  // Node's built-in `fetch()` (backed by undici) applies a default 300s idle-body timeout that
  // would kill the Live Stream connection every ~5 minutes. Using `node:https` directly removes
  // that hidden timeout entirely — proven here by feeding periodic heartbeat-style traffic (well
  // under the stream's own idle-read timeout) spanning past 300s and confirming the connection
  // survives and keeps yielding frames normally.
  it('does not disconnect from Node\'s own machinery, given periodic traffic well past undici\'s old 300s bodyTimeout', async () => {
    vi.useFakeTimers();
    try {
      const req = new FakeRequest();
      const res = new FakeResponse(200);
      vi.mocked(httpsRequest).mockImplementationOnce(() => {
        queueMicrotask(() => req.emit('response', res));
        return asClientRequest(req);
      });

      const generator = consumeOpenCtiStream({
        url: 'https://opencti.example.com',
        token: 'tok',
        streamId: 'live',
        lastEventId: null,
        needsRecover: false,
        signal: new AbortController().signal,
      });

      await vi.advanceTimersByTimeAsync(0);

      // 10 heartbeats 60s apart span 600s total — past undici's old 300s default and under this
      // stream's own 90s idle-read timeout on every single gap.
      for (let i = 0; i < 10; i += 1) {
        const heartbeatPromise = generator.next();
        await vi.advanceTimersByTimeAsync(60_000);
        res.push(Buffer.from(`id: ${i}\nevent: heartbeat\ndata: {}\n\n`));
        const { value, done } = await heartbeatPromise;
        expect(done).toBe(false);
        expect(value).toEqual({ id: String(i), event: 'heartbeat', data: {} });
      }

      const finalEventPromise = generator.next();
      res.push(Buffer.from('id: final\nevent: create\ndata: {}\n\n'));
      const { value, done } = await finalEventPromise;

      expect(done).toBe(false);
      expect(value).toEqual({ id: 'final', event: 'create', data: {} });

      res.push(null);
      await generator.return(undefined);
    } finally {
      vi.useRealTimers();
    }
  });

  // No OS-level signal reliably reports a stalled read on a receive-only connection (e.g. wifi
  // dropping mid-stream) — real bug found via manual E2E: cutting the network produced no error at
  // all, the connector just silently stopped receiving data.
  it('throws if no data arrives at all within the idle-read timeout', async () => {
    vi.useFakeTimers();
    try {
      const req = new FakeRequest();
      const res = new FakeResponse(200);
      vi.mocked(httpsRequest).mockImplementationOnce(() => {
        queueMicrotask(() => req.emit('response', res));
        return asClientRequest(req);
      });

      const generator = consumeOpenCtiStream({
        url: 'https://opencti.example.com',
        token: 'tok',
        streamId: 'live',
        lastEventId: null,
        needsRecover: false,
        signal: new AbortController().signal,
      });

      const firstEventPromise = generator.next();
      // Attach a catch handler immediately so vitest doesn't flag the eventual rejection as
      // "unhandled" during the gap between the promise settling and the assertion below.
      firstEventPromise.catch(() => {});
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(90_000);

      await expect(firstEventPromise).rejects.toThrow(/no data for 90000ms/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('throws instead of growing without bound if a single frame never terminates within the buffer size cap', async () => {
    const req = new FakeRequest();
    const res = new FakeResponse(200);
    vi.mocked(httpsRequest).mockImplementationOnce(() => {
      queueMicrotask(() => {
        req.emit('response', res);
        // No `\n\n` anywhere in this chunk, so it never resolves into a complete frame — the
        // buffer just keeps accumulating until the cap trips.
        res.push(Buffer.alloc(21 * 1024 * 1024, 'a'));
        res.push(null);
      });
      return asClientRequest(req);
    });

    const generator = consumeOpenCtiStream({
      url: 'https://opencti.example.com',
      token: 'tok',
      streamId: 'live',
      lastEventId: null,
      needsRecover: false,
      signal: new AbortController().signal,
    });

    await expect(generator.next()).rejects.toThrow(/exceeded .* bytes without a terminator/);
  });
});
