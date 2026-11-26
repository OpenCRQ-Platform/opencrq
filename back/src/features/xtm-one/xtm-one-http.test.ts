import { EventEmitter, once } from 'node:events';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createServer, request } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { buffer } from 'node:stream/consumers';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { fastify } from 'fastify';
import compress from '@fastify/compress';
import multipart from '@fastify/multipart';
import type { DrizzleDB } from '@app/module';
import { buildXtmOneHeaders } from './xtm-one-headers';
import { getXtmOneSettings } from './xtm-one-config';

const { logFromError, SETTINGS } = vi.hoisted(() => ({
  logFromError: vi.fn(),
  SETTINGS: { url: 'http://xtm-one', token: 'registration-token', platformUrl: 'http://opencrq' },
}));

vi.mock('../../utils/logger', () => ({
  createLogger: vi.fn().mockReturnValue({ logTrace: vi.fn(), logError: vi.fn(), logFromError }),
}));

vi.mock('../../trpc', () => ({
  resolveRequestAuth: () => () => Promise.resolve(),
}));

vi.mock('../edition', () => ({
  requireEnterpriseEdition: vi.fn().mockResolvedValue(true),
}));

vi.mock('./xtm-one-approvals', () => ({ parseApprovalRequest: vi.fn() }));
vi.mock('./xtm-one-auth', () => ({ XTM_ONE_SESSION_ID: 'xtm-one-session' }));
vi.mock('./xtm-one-headers', () => ({
  buildXtmOneHeaders: vi.fn().mockResolvedValue({ Authorization: 'Bearer user-jwt' }),
}));
vi.mock('./xtm-one-config', () => ({
  getXtmOneSettings: vi.fn().mockReturnValue(SETTINGS),
}));
vi.mock('./xtm-one-keys', () => ({ buildJwks: vi.fn(), ensureSigningKey: vi.fn() }));

const { registerXtmOneRoutes } = await import('./xtm-one-http');
const { ASSISTANT_INTENT } = await import('./xtm-one-registration');

type Handler = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const DECK_ID = '22222222-2222-4222-8222-222222222222';

const registerHandlers = (): Map<string, Handler> => {
  const handlers = new Map<string, Handler>();
  const record = (method: string) => vi.fn((path: string, handler: Handler) => {
    handlers.set(`${method} ${path}`, handler);
  });
  const server = { get: record('GET'), post: record('POST'), delete: record('DELETE') };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- minimal Fastify server stub for unit test
  registerXtmOneRoutes(server as unknown as FastifyInstance, {} as unknown as DrizzleDB);
  return handlers;
};

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- minimal Fastify request stub for unit test
const makeReq = (overrides: Record<string, unknown> = {}): FastifyRequest => ({
  authUser: { id: 'user-1', email: 'user@example.com', name: 'User' },
  authSession: { id: 'session-1' },
  params: {},
  body: undefined,
  ...overrides,
}) as unknown as FastifyRequest;

const makeReply = () => ({
  code: vi.fn().mockReturnThis(),
  send: vi.fn().mockReturnThis(),
  header: vi.fn().mockReturnThis(),
  raw: Object.assign(new EventEmitter(), { writableEnded: false }),
});

const callRoute = async (key: string, req: FastifyRequest, reply: ReturnType<typeof makeReply>) => {
  const handler = registerHandlers().get(key);
  expect(handler).toBeDefined();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- minimal Fastify reply stub for unit test
  await handler?.(req, reply as unknown as FastifyReply);
};

const READ = 'GET /api/xtm-one/chat/artifacts/:kind/:artifactId';
const DOWNLOAD = 'POST /api/xtm-one/chat/artifacts/:kind/:artifactId/download';

describe('the chat artifact routes', () => {
  const fetchMock = vi.fn<typeof fetch>();

  const upstreamCall = () => {
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    return {
      url: String(url),
      method: init?.method,
      authorization: new Headers(init?.headers).get('Authorization'),
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
  };

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refuses an unknown kind or a non-UUID id without calling XTM One', async () => {
    for (const params of [{ kind: 'spreadsheet', artifactId: DECK_ID }, { kind: 'report', artifactId: '../settings' }]) {
      const reply = makeReply();
      await callRoute(READ, makeReq({ params }), reply);
      expect(reply.code).toHaveBeenCalledWith(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards the descriptor XTM One answers, with the user token', async () => {
    fetchMock.mockResolvedValue(new Response('{"kind":"presentation"}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    const reply = makeReply();

    await callRoute(READ, makeReq({ params: { kind: 'presentation', artifactId: DECK_ID } }), reply);

    const call = upstreamCall();
    expect(call.url).toBe(`http://xtm-one/api/v1/platform/chat/artifacts/presentation/${DECK_ID}`);
    expect(call.method).toBe('GET');
    expect(call.authorization).toBe('Bearer user-jwt');
    expect(reply.code).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith('{"kind":"presentation"}');
  });

  it('refuses a download without a valid format', async () => {
    for (const body of [undefined, {}, { format: '../pdf' }]) {
      const reply = makeReply();
      await callRoute(DOWNLOAD, makeReq({ params: { kind: 'report', artifactId: DECK_ID }, body }), reply);
      expect(reply.code).toHaveBeenCalledWith(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('streams the file with its content headers only', async () => {
    fetchMock.mockResolvedValue(new Response('%PDF', {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': 'attachment; filename="Q3.pdf"',
        'content-length': '4',
        'x-not-forwarded': 'secret',
      },
    }));
    const reply = makeReply();

    await callRoute(
      DOWNLOAD,
      makeReq({ params: { kind: 'report', artifactId: DECK_ID }, body: { format: 'pdf' } }),
      reply,
    );

    const call = upstreamCall();
    expect(call.url).toBe(`http://xtm-one/api/v1/platform/chat/artifacts/report/${DECK_ID}/download`);
    expect(call.method).toBe('POST');
    expect(call.body).toBe('{"format":"pdf"}');
    expect(reply.header).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(reply.header).toHaveBeenCalledWith('content-disposition', 'attachment; filename="Q3.pdf"');
    expect(reply.header).toHaveBeenCalledWith('Content-Length', '4');
    expect(reply.header).not.toHaveBeenCalledWith('x-not-forwarded', 'secret');
    expect(reply.send).toHaveBeenCalledWith(expect.any(ReadableStream));
  });

  it('does not forward the length of an encoded body, which fetch decodes', async () => {
    fetchMock.mockResolvedValue(new Response('%PDF', {
      status: 200,
      headers: { 'content-type': 'application/pdf', 'content-encoding': 'gzip', 'content-length': '24' },
    }));
    const reply = makeReply();

    await callRoute(
      DOWNLOAD,
      makeReq({ params: { kind: 'report', artifactId: DECK_ID }, body: { format: 'pdf' } }),
      reply,
    );

    expect(reply.header).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(reply.header).not.toHaveBeenCalledWith('Content-Length', expect.anything());
  });

  it('keeps the status, the type and the body of an upstream refusal', async () => {
    fetchMock.mockResolvedValue(new Response('{"detail":"This video has no finished render yet."}', {
      status: 409,
      headers: { 'content-type': 'application/json' },
    }));
    const reply = makeReply();

    await callRoute(
      DOWNLOAD,
      makeReq({ params: { kind: 'video', artifactId: DECK_ID }, body: { format: 'mp4' } }),
      reply,
    );

    expect(reply.code).toHaveBeenCalledWith(409);
    expect(reply.header).toHaveBeenCalledWith('Content-Type', 'application/json');
    expect(reply.send).toHaveBeenCalledWith('{"detail":"This video has no finished render yet."}');
  });

  it('does not label a refusal that is not JSON as JSON', async () => {
    fetchMock.mockResolvedValue(new Response('<html>Bad gateway</html>', {
      status: 502,
      headers: { 'content-type': 'text/html' },
    }));
    const reply = makeReply();

    await callRoute(
      DOWNLOAD,
      makeReq({ params: { kind: 'report', artifactId: DECK_ID }, body: { format: 'pdf' } }),
      reply,
    );

    expect(reply.code).toHaveBeenCalledWith(502);
    expect(reply.header).toHaveBeenCalledWith('Content-Type', 'text/html');
  });

  it('answers 502 when XTM One cannot be reached', async () => {
    fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED'));
    const reply = makeReply();

    await callRoute(
      DOWNLOAD,
      makeReq({ params: { kind: 'presentation', artifactId: DECK_ID }, body: { format: 'pptx' } }),
      reply,
    );

    expect(reply.code).toHaveBeenCalledWith(502);
    expect(logFromError).toHaveBeenCalled();
  });

  it('answers 502 when XTM One does not answer within the export timeout', async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
      }));
      const reply = makeReply();

      const pending = callRoute(
        DOWNLOAD,
        makeReq({ params: { kind: 'presentation', artifactId: DECK_ID }, body: { format: 'pptx' } }),
        reply,
      );
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      await pending;

      expect(reply.code).toHaveBeenCalledWith(502);
      expect(logFromError).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the chat downloads over HTTP', () => {
  const DOWNLOAD_PATH = `/api/xtm-one/chat/artifacts/presentation/${DECK_ID}/download`;
  let xtmOne: Server;
  let app: FastifyInstance;
  let baseUrl: string;
  let xtmOneAnswers: (req: IncomingMessage, res: ServerResponse) => void;
  let browserSockets: Array<Socket>;

  const download = (format: string) => {
    const browser = request(`${baseUrl}${DOWNLOAD_PATH}`, { method: 'POST', headers: { 'content-type': 'application/json' } });
    const response = new Promise<IncomingMessage>((resolve) => browser.once('response', resolve));
    browser.on('error', () => undefined);
    browser.end(JSON.stringify({ format }));
    return { browser, response };
  };

  beforeEach(async () => {
    xtmOne = createServer((req, res) => xtmOneAnswers(req, res));
    xtmOne.listen(0, '127.0.0.1');
    await once(xtmOne, 'listening');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- a listening TCP server's address is an AddressInfo
    const { port } = xtmOne.address() as AddressInfo;
    vi.mocked(getXtmOneSettings).mockReturnValue({ ...SETTINGS, url: `http://127.0.0.1:${port}` });

    app = fastify();
    // As in production: a compressed body is a stream, which an async handler has to return.
    await app.register(compress, { encodings: ['gzip'] });
    app.addHook('onRequest', (req, _reply, done) => {
      Object.assign(req, { authUser: { id: 'user-1', email: 'user@example.com', name: 'User' }, authSession: { id: 'session-1' } });
      done();
    });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the routes under test never reach the database
    registerXtmOneRoutes(app, {} as unknown as DrizzleDB);
    browserSockets = [];
    app.server.on('connection', (socket: Socket) => browserSockets.push(socket));
    baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });
  });

  afterEach(async () => {
    await app.close();
    xtmOne.closeAllConnections();
    await new Promise((resolve) => xtmOne.close(resolve));
    vi.mocked(getXtmOneSettings).mockReturnValue(SETTINGS);
  });

  it('sends the whole of a JSON answer the browser takes compressed', async () => {
    const sessions = JSON.stringify(Array.from({ length: 200 }, (_, index) => ({ id: `${index}`, title: `Conversation ${index}` })));
    xtmOneAnswers = (req, res) => {
      req.resume();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(sessions);
    };

    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      request(`${baseUrl}/api/xtm-one/chat/sessions`, { headers: { 'accept-encoding': 'gzip' } }, resolve).on('error', reject).end();
    });

    expect(response.headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(await buffer(response)).toString()).toBe(sessions);
  });

  it('streams the whole of an agent-generated file to the browser', async () => {
    xtmOneAnswers = (req, res) => {
      req.resume();
      res.writeHead(200, { 'content-type': 'text/csv', 'content-length': '7' });
      res.end('a,b\n1,2');
    };

    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      request(`${baseUrl}/api/xtm-one/chat/files/${DECK_ID}/download`, resolve).on('error', reject).end();
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-length']).toBe('7');
    expect((await buffer(response)).toString()).toBe('a,b\n1,2');
  });

  it('streams the whole file to the browser', async () => {
    xtmOneAnswers = (req, res) => {
      req.resume();
      res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': '4' });
      res.end('%PDF');
    };

    const response = await download('pdf').response;

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-length']).toBe('4');
    expect((await buffer(response)).toString()).toBe('%PDF');
  });

  it('cancels the export when the browser leaves before XTM One answers', async () => {
    let exportStarted = false;
    let xtmOneReleased = false;
    xtmOneAnswers = (req, res) => {
      exportStarted = true;
      req.resume();
      res.on('close', () => {
        xtmOneReleased = true;
      });
    };

    const { browser } = download('pptx');
    await expect.poll(() => exportStarted).toBe(true);
    browser.destroy();

    await expect.poll(() => xtmOneReleased).toBe(true);
    expect(logFromError).not.toHaveBeenCalled();
  });

  it('does not start the export for a browser that left while it was being authenticated', async () => {
    let exportStarted = false;
    xtmOneAnswers = (req, res) => {
      exportStarted = true;
      req.resume();
      res.end();
    };
    let mintJwt = (): void => undefined;
    vi.mocked(buildXtmOneHeaders).mockImplementationOnce(() => new Promise((resolve) => {
      mintJwt = () => resolve({ Authorization: 'Bearer user-jwt' });
    }));

    const { browser } = download('pptx');
    await expect.poll(() => vi.mocked(buildXtmOneHeaders).mock.calls.length).toBe(1);
    browser.destroy();
    await expect.poll(() => browserSockets.every((socket) => socket.destroyed)).toBe(true);
    mintJwt();

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(exportStarted).toBe(false);
    expect(logFromError).not.toHaveBeenCalled();
  });

  it('stops reading XTM One when the browser leaves mid-download', async () => {
    let xtmOneReleased = false;
    xtmOneAnswers = (req, res) => {
      req.resume();
      res.writeHead(200, { 'content-type': 'video/mp4' });
      const frames = setInterval(() => res.write(Buffer.alloc(1024)), 10);
      res.on('close', () => {
        clearInterval(frames);
        xtmOneReleased = true;
      });
    };

    const response = await download('mp4').response;
    response.on('error', () => undefined);
    await once(response, 'data');
    response.destroy();

    await expect.poll(() => xtmOneReleased).toBe(true);
  });
});

describe('the chat upload over HTTP', () => {
  const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333';
  const BOUNDARY = 'browser-boundary';
  let xtmOne: Server;
  let app: FastifyInstance;
  let baseUrl: string;
  let xtmOneAnswers: (req: IncomingMessage, res: ServerResponse) => void;

  /** `filename` is the raw parameter: `filename="a.txt"`, or `filename*=utf-8''...` to carry a quote. */
  const filePart = (filename: string, type: string) => Buffer.from(
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; ${filename}\r\nContent-Type: ${type}\r\n\r\n`,
  );
  const closing = Buffer.from(`\r\n--${BOUNDARY}--\r\n`);

  /** The form field @filigran/chatbot sends before the file. */
  const conversationField = (value: string) => Buffer.from(
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="conversation_id"\r\n\r\n${value}\r\n`,
  );

  /** A browser posting one file, its bytes written when the test says so. */
  const upload = (query = `?conversation_id=${CONVERSATION_ID}`) => {
    const browser = request(`${baseUrl}/api/xtm-one/chat/upload${query}`, {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
    });
    const response = new Promise<IncomingMessage>((resolve) => browser.once('response', resolve));
    browser.on('error', () => undefined);
    return { browser, response };
  };

  beforeEach(async () => {
    xtmOne = createServer((req, res) => xtmOneAnswers(req, res));
    xtmOne.listen(0, '127.0.0.1');
    await once(xtmOne, 'listening');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- a listening TCP server's address is an AddressInfo
    const { port } = xtmOne.address() as AddressInfo;
    vi.mocked(getXtmOneSettings).mockReturnValue({ ...SETTINGS, url: `http://127.0.0.1:${port}` });

    // A failed assertion can leave the browser's request half read: close it with the app.
    app = fastify({ forceCloseConnections: true });
    await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024 } });
    app.addHook('onRequest', (req, _reply, done) => {
      Object.assign(req, { authUser: { id: 'user-1', email: 'user@example.com', name: 'User' }, authSession: { id: 'session-1' } });
      done();
    });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the routes under test never reach the database
    registerXtmOneRoutes(app, {} as unknown as DrizzleDB);
    baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });
  });

  afterEach(async () => {
    await app.close();
    xtmOne.closeAllConnections();
    await new Promise((resolve) => xtmOne.close(resolve));
    vi.mocked(getXtmOneSettings).mockReturnValue(SETTINGS);
  });

  it('passes the file through to XTM One before the browser has finished sending it', async () => {
    const received: Array<Buffer> = [];
    let xtmOneHeaders: IncomingMessage['headers'] = {};
    let firstChunkSeen = false;
    xtmOneAnswers = (req, res) => {
      xtmOneHeaders = req.headers;
      req.on('data', (chunk: Buffer) => {
        received.push(chunk);
        firstChunkSeen = Buffer.concat(received).includes('first-half');
      });
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ file_id: 'file-1' }));
      });
    };

    const { browser, response } = upload();
    browser.write(Buffer.concat([filePart("filename*=utf-8''notes%20%22q1%22.txt", 'text/plain'), Buffer.from('first-half|')]));
    // XTM One holds the first half while the browser has not sent the second: nothing buffers the file.
    await expect.poll(() => firstChunkSeen).toBe(true);
    browser.end(Buffer.concat([Buffer.from('second-half'), closing]));

    const answer = await response;
    expect(answer.statusCode).toBe(200);
    expect(JSON.parse((await buffer(answer)).toString())).toEqual({ file_ids: ['file-1'] });

    const contentType = String(xtmOneHeaders['content-type']);
    const boundary = /boundary=(.+)$/.exec(contentType)?.[1];
    expect(contentType.startsWith('multipart/form-data; boundary=')).toBe(true);
    expect(xtmOneHeaders.authorization).toBe('Bearer user-jwt');
    expect(Buffer.concat(received).toString()).toBe(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="notes %22q1%22.txt"\r\n`
      + 'Content-Type: text/plain\r\n\r\nfirst-half|second-half'
      + `\r\n--${boundary}--\r\n`,
    );
  });

  it('takes the conversation id from the form field sent before the file', async () => {
    let xtmOneUrl = '';
    let received = '';
    xtmOneAnswers = (req, res) => {
      xtmOneUrl = req.url ?? '';
      req.on('data', (chunk: Buffer) => {
        received += chunk.toString();
      });
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ file_id: 'file-1' }));
      });
    };

    const { browser, response } = upload('');
    browser.end(Buffer.concat([
      conversationField(CONVERSATION_ID), filePart('filename="notes.txt"', 'text/plain'), Buffer.from('hello'), closing,
    ]));

    const answer = await response;
    expect(answer.statusCode).toBe(200);
    expect(JSON.parse((await buffer(answer)).toString())).toEqual({ file_ids: ['file-1'] });
    expect(xtmOneUrl).toBe(`/api/v1/chat/conversations/${CONVERSATION_ID}/upload?create_message=false`);
    expect(received).toContain('hello');
    expect(received).not.toContain('name="conversation_id"');
  });

  it.each([
    ['no conversation id at all', '', Buffer.alloc(0)],
    ['a form field that is not a UUID', '', conversationField('not-a-uuid')],
    ['a query parameter that is not a UUID', '?conversation_id=not-a-uuid', conversationField(CONVERSATION_ID)],
  ])('answers 400 without calling XTM One for %s', async (_case, query, field) => {
    let xtmOneCalled = false;
    xtmOneAnswers = (req, res) => {
      xtmOneCalled = true;
      req.resume();
      res.end();
    };

    const { browser, response } = upload(query);
    browser.end(Buffer.concat([field, filePart('filename="notes.txt"', 'text/plain'), Buffer.from('hello'), closing]));

    const answer = await response;
    expect(answer.statusCode).toBe(400);
    expect(JSON.parse((await buffer(answer)).toString())).toEqual({ error: 'conversation_id is required' });
    expect(xtmOneCalled).toBe(false);
  });

  it('takes the query id over the form field', async () => {
    const FIELD_ID = '44444444-4444-4444-8444-444444444444';
    let xtmOneUrl = '';
    xtmOneAnswers = (req, res) => {
      xtmOneUrl = req.url ?? '';
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ file_id: 'file-1' }));
      });
    };

    const { browser, response } = upload();
    browser.end(Buffer.concat([
      conversationField(FIELD_ID), filePart('filename="notes.txt"', 'text/plain'), Buffer.from('hello'), closing,
    ]));

    const answer = await response;
    expect(answer.statusCode).toBe(200);
    expect(xtmOneUrl).toBe(`/api/v1/chat/conversations/${CONVERSATION_ID}/upload?create_message=false`);
  });

  it('answers 400 without calling XTM One for a form field sent after the file', async () => {
    let xtmOneCalled = false;
    xtmOneAnswers = (req, res) => {
      xtmOneCalled = true;
      req.resume();
      res.end();
    };

    const { browser, response } = upload('');
    // file, then the field, then a second file: the late field must not let the second file through.
    browser.end(Buffer.concat([
      filePart('filename="a.txt"', 'text/plain'), Buffer.from('first\r\n'),
      conversationField(CONVERSATION_ID),
      filePart('filename="b.txt"', 'text/plain'), Buffer.from('second'), closing,
    ]));

    const answer = await response;
    expect(answer.statusCode).toBe(400);
    expect(JSON.parse((await buffer(answer)).toString())).toEqual({ error: 'conversation_id is required' });
    expect(xtmOneCalled).toBe(false);
  });

  it('answers 400, not 502, for a file over the size limit sent without an id', async () => {
    let xtmOneCalled = false;
    xtmOneAnswers = (req, res) => {
      xtmOneCalled = true;
      req.resume();
      res.end();
    };

    const { browser, response } = upload('');
    browser.end(Buffer.concat([
      filePart('filename="big.bin"', 'application/octet-stream'), Buffer.alloc(9 * 1024 * 1024, 1), closing,
    ]));

    const answer = await response;
    expect(answer.statusCode).toBe(400);
    expect(JSON.parse((await buffer(answer)).toString())).toEqual({ error: 'conversation_id is required' });
    expect(xtmOneCalled).toBe(false);
  });

  it('answers 400 without calling XTM One when the request carries no file', async () => {
    let xtmOneCalled = false;
    xtmOneAnswers = (req, res) => {
      xtmOneCalled = true;
      req.resume();
      res.end();
    };

    const { browser, response } = upload();
    browser.end(Buffer.concat([conversationField(CONVERSATION_ID), Buffer.from(`--${BOUNDARY}--\r\n`)]));

    const answer = await response;
    expect(answer.statusCode).toBe(400);
    expect(JSON.parse((await buffer(answer)).toString())).toEqual({ error: 'No file in the request' });
    expect(xtmOneCalled).toBe(false);
  });

  it('answers the status XTM One refused the file with', async () => {
    xtmOneAnswers = (req, res) => {
      req.resume();
      req.on('end', () => {
        res.writeHead(413, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ detail: 'File too large' }));
      });
    };

    const { browser, response } = upload();
    browser.end(Buffer.concat([filePart('filename="big.bin"', 'application/octet-stream'), Buffer.from('payload'), closing]));

    const answer = await response;
    expect(answer.statusCode).toBe(413);
    expect(JSON.parse((await buffer(answer)).toString())).toEqual({ error: 'No file could be uploaded' });
  });

  it('reaches the next file when XTM One refuses one before reading all of it', async () => {
    const FILE_SIZE = 4 * 1024 * 1024;
    let requests = 0;
    let secondFileBytes = 0;
    xtmOneAnswers = (req, res) => {
      requests += 1;
      if (requests === 1) {
        // A body size limit: answered once the file has started, the rest left
        // to Node to discard. The connection stays open: closing it with bytes
        // unread resets the socket, and whether fetch sees the 413 or the reset
        // first is a race of the runner, not a behaviour of the route.
        req.once('data', () => {
          res.writeHead(413, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ detail: 'File too large' }));
        });
        return;
      }
      req.on('data', (chunk: Buffer) => {
        secondFileBytes += chunk.length;
      });
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ file_id: 'file-2' }));
      });
    };

    const { browser, response } = upload();
    browser.end(Buffer.concat([
      filePart('filename="first.bin"', 'application/octet-stream'), Buffer.alloc(FILE_SIZE, 1),
      Buffer.from('\r\n'), filePart('filename="second.bin"', 'application/octet-stream'), Buffer.alloc(FILE_SIZE, 2),
      closing,
    ]));

    const answer = await response;
    expect(answer.statusCode).toBe(200);
    expect(JSON.parse((await buffer(answer)).toString())).toEqual({ file_ids: ['file-2'] });
    expect(requests).toBe(2);
    expect(secondFileBytes).toBeGreaterThan(FILE_SIZE);
  });

  it('never hands XTM One a complete file cut at the upload size limit', async () => {
    let xtmOneSawClosingBoundary = false;
    xtmOneAnswers = (req, res) => {
      const received: Array<Buffer> = [];
      req.on('data', (chunk: Buffer) => received.push(chunk));
      const settle = () => {
        xtmOneSawClosingBoundary = /--opencrq-[0-9a-f-]+--\r\n$/.test(Buffer.concat(received).toString('latin1'));
        if (!res.headersSent) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ file_id: 'file-1' }));
        }
      };
      req.on('end', settle);
      req.on('aborted', settle);
      req.on('error', settle);
    };

    const { browser, response } = upload();
    browser.end(Buffer.concat([filePart('filename="huge.bin"', 'application/octet-stream'), Buffer.alloc(8 * 1024 * 1024 + 1, 1), closing]));

    const answer = await response;
    expect(answer.statusCode).toBe(502);
    expect(xtmOneSawClosingBoundary).toBe(false);
  });
});

describe('the composer routes', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ['GET /api/xtm-one/chat/prompts', '/api/v1/platform/chat/prompts', '{"prompts":[]}'],
    ['GET /api/xtm-one/chat/quota', '/api/v1/platform/chat/quota', '{"used":28,"limit":100,"period":"monthly","scope":"user"}'],
  ])('forwards %s to XTM One with the user token', async (route, upstreamPath, body) => {
    fetchMock.mockResolvedValue(new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }));
    const reply = makeReply();

    await callRoute(route, makeReq(), reply);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(`http://xtm-one${upstreamPath}`);
    expect(init?.method).toBe('GET');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer user-jwt');
    expect(reply.code).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith(body);
  });

  it('lists the agents bound to the intent OpenCRQ declares', async () => {
    fetchMock.mockResolvedValue(new Response(
      JSON.stringify([{ agents: [{ agent_id: 'agent-1', agent_name: 'OpenCRQ Assistant', priority: 5 }] }]),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    const reply = makeReply();

    await callRoute('GET /api/xtm-one/chat/agents', makeReq(), reply);

    const [url] = fetchMock.mock.calls[0] ?? [];
    expect(new URL(String(url)).searchParams.get('intent')).toBe(ASSISTANT_INTENT);
    expect(reply.send).toHaveBeenCalledWith([{ id: 'agent-1', name: 'OpenCRQ Assistant', slug: null, description: null }]);
  });

  it('refuses a request without a browser session', async () => {
    const reply = makeReply();

    await callRoute('GET /api/xtm-one/chat/quota', makeReq({ authSession: { id: 'xtm-one-session' } }), reply);

    expect(reply.code).toHaveBeenCalledWith(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('a chat message XTM One refuses', () => {
  const fetchMock = vi.fn<typeof fetch>();
  let app: FastifyInstance;

  const refuse = (status: number, body: string, contentType = 'application/json') => {
    fetchMock.mockResolvedValue(new Response(body, { status, headers: { 'content-type': contentType } }));
  };

  /** The `error` events the panel reads off the stream. */
  const send = async (): Promise<Array<unknown>> => {
    const response = await app.inject({ method: 'POST', url: '/api/xtm-one/chat/messages', payload: { content: 'hello' } });
    expect(response.statusCode).toBe(200);
    return response.body.split('\n\n').filter(Boolean).map((event) => JSON.parse(event.replace(/^data: /, '')));
  };

  beforeEach(async () => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    app = fastify();
    app.addHook('onRequest', (req, _reply, done) => {
      Object.assign(req, { authUser: { id: 'user-1', email: 'user@example.com', name: 'User' }, authSession: { id: 'session-1' } });
      done();
    });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the routes under test never reach the database
    registerXtmOneRoutes(app, {} as unknown as DrizzleDB);
    await app.ready();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await app.close();
    vi.unstubAllGlobals();
  });

  it('shows the reason XTM One gave', async () => {
    refuse(404, '{"detail":"Agent \'switched-off\' is not available for platform chat"}');

    expect(await send()).toEqual([{ type: 'error', content: 'Agent \'switched-off\' is not available for platform chat' }]);
  });

  it('shows the quota XTM One says was reached', async () => {
    refuse(429, '{"detail":"agentic quota exceeded: 0/0 (monthly)"}');

    expect(await send()).toEqual([{ type: 'error', content: 'Quota exceeded - agentic quota exceeded: 0/0 (monthly)' }]);
  });

  it('falls back to its own message when XTM One gave no readable reason', async () => {
    refuse(429, '');
    expect(await send()).toEqual([{ type: 'error', content: 'Quota exceeded - please try again later.' }]);

    refuse(422, '{"detail":[{"loc":["body","content"],"msg":"Field required"}]}');
    expect(await send()).toEqual([{ type: 'error', content: 'Unable to connect to the AI assistant. Please try again.' }]);

    refuse(400, '<html>Bad request</html>', 'text/html');
    expect(await send()).toEqual([{ type: 'error', content: 'Unable to connect to the AI assistant. Please try again.' }]);

    refuse(404, '{"detail":"   "}');
    expect(await send()).toEqual([{ type: 'error', content: 'Unable to connect to the AI assistant. Please try again.' }]);
  });

  it('falls back to its own message when XTM One stops partway through its reason', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fetchMock.mockImplementation((_url, init) => {
      const signal = init?.signal;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"detail":"Agent'));
          // As undici does: aborting the request errors the body still being read.
          signal?.addEventListener('abort', () => controller.error(signal.reason));
        },
      });
      return Promise.resolve(new Response(body, { status: 404, headers: { 'content-type': 'application/json' } }));
    });

    const events = send();
    await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));
    await vi.advanceTimersByTimeAsync(60_000);

    expect(await events).toEqual([{ type: 'error', content: 'Unable to connect to the AI assistant. Please try again.' }]);
  });

  it('does not show what a failing XTM One said', async () => {
    refuse(500, '{"detail":"Internal Server Error"}');

    expect(await send()).toEqual([{ type: 'error', content: 'Unable to connect to the AI assistant. Please try again.' }]);
  });
});
