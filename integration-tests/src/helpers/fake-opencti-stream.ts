import type { AddressInfo } from 'node:net';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:http';

export type FakeStreamEventType = 'create' | 'update' | 'delete' | 'merge';

export interface FakeStreamEvent {
  id: string,
  event: FakeStreamEventType,
  /** The whole SSE payload, `{ data, context? }`, not just the STIX object. */
  payload: unknown,
  /** Sends this event's JSON over two `data:` lines, as OpenCTI does for a payload with newlines. */
  splitData?: boolean,
}

/** One connection, with what it asked for and what it was served, in order. */
export interface FakeStreamRequest {
  streamId: string,
  status: number,
  lastEventId: string | null,
  from: string | null,
  recover: string | null,
  authorization: string | null,
  servedEventIds: Array<string>,
}

export interface FakeOpenCtiStream {
  url: string,
  requests: Array<FakeStreamRequest>,
  /** Serves this many events on each connection, then ends the body. `null` serves everything. */
  closeAfter: (count: number | null) => void,
  /** Publishes more events on the open connection, the way the live edge of a stream moves. */
  append: (more: ReadonlyArray<FakeStreamEvent>) => void,
  close: () => Promise<void>,
}

const EVENT_PUMP_INTERVAL_MS = 25;
const HEARTBEAT_INTERVAL_MS = 500;

/** Cuts a JSON document at its first comma outside a string; the two halves rejoined by a newline
  * are the same document, newlines being whitespace between JSON tokens. */
const splitJsonAtComma = (json: string): Array<string> => {
  let inString = false;
  for (let i = 0; i < json.length; i += 1) {
    const char = json[i];
    if (inString) {
      if (char === '\\') {
        i += 1;
      } else if (char === '"') {
        inString = false;
      }
    } else if (char === '"') {
      inString = true;
    } else if (char === ',') {
      return [json.slice(0, i + 1), json.slice(i + 1)];
    }
  }
  return [json];
};

const frame = (id: string, event: string, payload: unknown, splitData = false): string => {
  const json = JSON.stringify(payload);
  const dataLines = (splitData ? splitJsonAtComma(json) : [json]).map((line) => `data: ${line}`);
  return `id: ${id}\nevent: ${event}\n${dataLines.join('\n')}\n\n`;
};

// OpenCTI's handshake frame carries no `id:` line, and the client relies on that to tell it apart.
const connectedFrame = (streamId: string): string => `event: connected\ndata: ${JSON.stringify({ streamId })}\n\n`;

/**
 * Serves a recorded OpenCTI Live Stream, in memory, on a free port. `streamId` is the only stream
 * it holds, any other id being a 404 as it is on a real instance. Any token is accepted; the resume
 * position is `Last-Event-ID` or `from`, and `recover` is only recorded. An id neither names
 * (`0-0`, an expired one) replays from the start, as a stream past its retention does.
 */
export const startFakeOpenCtiStream = (streamId: string, initialEvents: ReadonlyArray<FakeStreamEvent>): Promise<FakeOpenCtiStream> => {
  const events: Array<FakeStreamEvent> = [...initialEvents];
  const requests: Array<FakeStreamRequest> = [];
  let closeAfterCount: number | null = null;
  const openConnections = new Set<ServerResponse>();

  const resumeIndex = (position: string | null): number => {
    if (!position) {
      return 0;
    }
    const found = events.findIndex((event) => event.id === position);
    return found === -1 ? 0 : found + 1;
  };

  const handle = (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? '/', 'http://fake');
    const requestedStreamId = url.pathname.startsWith('/stream/') ? url.pathname.slice('/stream/'.length) : '';
    const header = req.headers['last-event-id'];
    const lastEventId = typeof header === 'string' ? header : null;
    const from = url.searchParams.get('from');
    const record: FakeStreamRequest = {
      streamId: requestedStreamId,
      status: requestedStreamId === streamId ? 200 : 404,
      lastEventId,
      from,
      recover: url.searchParams.get('recover'),
      authorization: req.headers.authorization ?? null,
      servedEventIds: [],
    };
    requests.push(record);

    if (record.status === 404) {
      res.writeHead(404).end();
      return;
    }

    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    openConnections.add(res);
    res.write(connectedFrame(streamId));

    let nextIndex = resumeIndex(lastEventId ?? from);
    let pump: ReturnType<typeof setInterval> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const stop = (): void => {
      clearInterval(pump);
      clearInterval(heartbeat);
      openConnections.delete(res);
    };

    const serveDue = (): void => {
      while (nextIndex < events.length) {
        if (closeAfterCount !== null && record.servedEventIds.length >= closeAfterCount) {
          stop();
          res.end();
          return;
        }
        const event = events[nextIndex];
        nextIndex += 1;
        record.servedEventIds.push(event.id);
        res.write(frame(event.id, event.event, event.payload, event.splitData));
      }
    };

    res.on('close', stop);
    serveDue();
    if (!res.writableEnded) {
      pump = setInterval(serveDue, EVENT_PUMP_INTERVAL_MS);
      heartbeat = setInterval(() => res.write(frame(`${Date.now()}-0`, 'heartbeat', {})), HEARTBEAT_INTERVAL_MS);
    }
  };

  const server = createServer(handle);

  return new Promise<FakeOpenCtiStream>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- a listening TCP server always reports an AddressInfo
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        requests,
        closeAfter: (count: number | null) => {
          closeAfterCount = count;
        },
        append: (more: ReadonlyArray<FakeStreamEvent>) => {
          events.push(...more);
        },
        close: async () => {
          for (const res of openConnections) {
            res.destroy();
          }
          openConnections.clear();
          await new Promise<void>((done) => server.close(() => done()));
        },
      });
    });
  });
};
