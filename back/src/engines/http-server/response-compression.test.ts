import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { fastify } from 'fastify';
import type { IncomingMessage } from 'node:http';
import { request } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buffer } from 'node:stream/consumers';
import { brotliDecompressSync, createBrotliDecompress, createGunzip, gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerResponseCompression } from './response-compression';

const ROWS = Array.from({ length: 2000 }, (_, index) => ({ id: index, name: `finding ${index}`, severity: 'high' }));
const JSON_BODY = JSON.stringify(ROWS);
const SCRIPT_BODY = `export const rows = ${JSON_BODY};\n`;

const encoder = new TextEncoder();

// The shape the tRPC adapter sends: a fetch Response over a stream.
const controllableStream = (contentType: string) => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
    },
  });
  return {
    response: new Response(body, { headers: { 'content-type': contentType } }),
    push: (text: string) => controller.enqueue(encoder.encode(text)),
    close: () => controller.close(),
  };
};

let server: FastifyInstance;
let baseUrl: string;
let staticRoot: string;
const openStreams = new Map<string, ReturnType<typeof controllableStream>>();

const get = (url: string, headers: Record<string, string> = {}): Promise<IncomingMessage> =>
  new Promise((resolve, reject) => {
    request(`${baseUrl}${url}`, { headers }, resolve).on('error', reject).end();
  });

const firstText = (stream: NodeJS.ReadableStream): Promise<string> =>
  new Promise((resolve, reject) => {
    stream.once('data', (chunk: Buffer) => resolve(chunk.toString()));
    stream.once('error', reject);
  });

beforeAll(async () => {
  staticRoot = mkdtempSync(path.join(tmpdir(), 'response-compression-'));
  writeFileSync(path.join(staticRoot, 'app.js'), SCRIPT_BODY);

  server = fastify();
  await registerResponseCompression(server);
  server.register(fastifyStatic, { root: staticRoot });
  server.get('/json', (_req, reply) => reply.send(new Response(JSON_BODY, { headers: { 'content-type': 'application/json' } })));
  server.get('/small', (_req, reply) => reply.send({ ok: true }));
  server.get('/no-transform', (_req, reply) => reply.header('Cache-Control', 'no-transform').type('application/octet-stream').send(Buffer.from(JSON_BODY)));
  server.get<{ Params: { kind: string } }>('/stream/:kind', (req, reply) => {
    const stream = controllableStream(req.params.kind === 'events' ? 'text/event-stream' : 'application/json');
    openStreams.set(req.params.kind, stream);
    return reply.send(stream.response);
  });
  baseUrl = await server.listen({ host: '127.0.0.1', port: 0 });
});

afterAll(async () => {
  openStreams.forEach((stream) => stream.close());
  await server.close();
  rmSync(staticRoot, { recursive: true, force: true });
});

describe('registerResponseCompression', () => {
  it('compresses a tRPC response with the encoding the client prefers', async () => {
    const response = await get('/json', { 'accept-encoding': 'br, gzip' });
    const body = await buffer(response);

    expect(response.headers['content-encoding']).toBe('br');
    expect(body.length).toBeLessThan(JSON_BODY.length / 10);
    expect(brotliDecompressSync(body).toString()).toBe(JSON_BODY);
  });

  it('falls back to gzip for a client that does not accept brotli', async () => {
    const response = await get('/json', { 'accept-encoding': 'gzip' });

    expect(response.headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(await buffer(response)).toString()).toBe(JSON_BODY);
  });

  it('sends the body as it is to a client that accepts no encoding', async () => {
    const response = await get('/json');

    expect(response.headers['content-encoding']).toBeUndefined();
    expect((await buffer(response)).toString()).toBe(JSON_BODY);
  });

  it('sends a response under the threshold as it is', async () => {
    const response = await get('/small', { 'accept-encoding': 'br, gzip' });

    expect(response.headers['content-encoding']).toBeUndefined();
    expect((await buffer(response)).toString()).toBe('{"ok":true}');
  });

  it('compresses a static script', async () => {
    const response = await get('/app.js', { 'accept-encoding': 'br, gzip' });

    expect(response.headers['content-encoding']).toBe('br');
    expect(brotliDecompressSync(await buffer(response)).toString()).toBe(SCRIPT_BODY);
  });

  it('sends a response marked no-transform as it is', async () => {
    const response = await get('/no-transform', { 'accept-encoding': 'br, gzip' });

    expect(response.headers['content-encoding']).toBeUndefined();
    expect((await buffer(response)).toString()).toBe(JSON_BODY);
  });

  it('leaves an event stream uncompressed and delivers each event while the stream stays open', async () => {
    const responsePromise = get('/stream/events', { 'accept-encoding': 'br, gzip' });
    await expect.poll(() => openStreams.has('events')).toBe(true);
    openStreams.get('events')!.push('data: {"tables":["findings"]}\n\n');
    const response = await responsePromise;

    expect(response.headers['content-encoding']).toBeUndefined();
    expect(response.headers['content-type']).toBe('text/event-stream');
    expect(await firstText(response)).toBe('data: {"tables":["findings"]}\n\n');
  });

  it.each([
    ['br', createBrotliDecompress],
    ['gzip', createGunzip],
  ] as const)('flushes each chunk of a streamed %s response before the stream ends', async (encoding, decompress) => {
    const kind = `batch-${encoding}`;
    const responsePromise = get(`/stream/${kind}`, { 'accept-encoding': encoding });
    await expect.poll(() => openStreams.has(kind)).toBe(true);
    openStreams.get(kind)!.push('{"0":{"result":{"data":"fast"}}}\n');
    const response = await responsePromise;

    expect(response.headers['content-encoding']).toBe(encoding);
    expect(await firstText(response.pipe(decompress()))).toBe('{"0":{"result":{"data":"fast"}}}\n');
  });
});
