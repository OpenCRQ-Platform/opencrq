import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import compress from '@fastify/compress';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { fastify } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerMapRoutes } from './maps-routes';

const TILES = Buffer.concat([Buffer.from('PMTiles'), Buffer.alloc(4096, 7)]);
const COUNTRIES = JSON.stringify({ type: 'FeatureCollection', features: [] }).padEnd(4096, ' ');

const signedIn = { 'x-test-user': 'user-1' };

describe('the map file routes', () => {
  let root: string;
  let server: FastifyInstance;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'maps-'));
    writeFileSync(join(root, 'world.pmtiles'), TILES);
    writeFileSync(join(root, 'countries.json'), COUNTRIES);

    server = fastify();
    server.decorateRequest('authUser', null);
    // As the server compresses its responses, honouring `no-transform`.
    await server.register(compress, { encodings: ['br', 'gzip'], respectNoTransform: true });
    registerMapRoutes(server, {
      root,
      resolveAuth: (req: FastifyRequest) => {
        if (req.headers['x-test-user']) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the routes only check that a user is set
          req.authUser = { id: 'user-1' } as unknown as FastifyRequest['authUser'];
        }
        return Promise.resolve();
      },
    });
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('refuses a request without a signed-in user', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/maps/world.pmtiles' });

    expect(response.statusCode).toBe(401);
  });

  it('answers a byte range of the tiles with that range only, uncompressed', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/maps/world.pmtiles',
      headers: { ...signedIn, range: 'bytes=0-6', 'accept-encoding': 'gzip, br' },
    });

    expect(response.statusCode).toBe(206);
    expect(response.headers['content-range']).toBe(`bytes 0-6/${TILES.length}`);
    expect(response.headers['content-encoding']).toBeUndefined();
    expect(response.headers['cache-control']).toContain('no-transform');
    expect(response.headers['accept-ranges']).toBe('bytes');
    expect(response.body).toBe('PMTiles');
  });

  it('sends the whole tiles file uncompressed to a request without a range', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/maps/world.pmtiles',
      headers: { ...signedIn, 'accept-encoding': 'gzip, br' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-encoding']).toBeUndefined();
    expect(response.rawPayload.equals(TILES)).toBe(true);
  });

  it('answers an unsatisfiable range with 416', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/maps/world.pmtiles',
      headers: { ...signedIn, range: `bytes=${TILES.length + 10}-${TILES.length + 20}` },
    });

    expect(response.statusCode).toBe(416);
  });

  it('answers 304 to a browser that already holds the current file', async () => {
    const first = await server.inject({ method: 'GET', url: '/api/maps/countries.json', headers: signedIn });
    const etag = first.headers['etag'];

    const second = await server.inject({
      method: 'GET',
      url: '/api/maps/countries.json',
      headers: { ...signedIn, 'if-none-match': String(etag) },
    });

    expect(etag).toBeDefined();
    expect(second.statusCode).toBe(304);
  });

  it('serves the country polygons as JSON, compressed when the browser accepts it', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/maps/countries.json',
      headers: { ...signedIn, 'accept-encoding': 'gzip' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.headers['content-encoding']).toBe('gzip');
    expect(response.headers['cache-control']).toBe('private, max-age=86400');
  });

  it('serves no other file', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/maps/other.json', headers: signedIn });

    expect(response.statusCode).toBe(404);
  });
});
