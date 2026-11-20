import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export const MAPS_PREFIX = '/api/maps/';

// The server's response compression honours `no-transform`, which keeps the 15 MB tiles file from
// being compressed on the fly when a client asks for it whole.
const TILES_CACHE_CONTROL = 'private, max-age=86400, no-transform';
const COUNTRIES_CACHE_CONTROL = 'private, max-age=86400';

interface MapRoutesOptions {
  root: string,
  resolveAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>,
}

/**
 * Serves the bundled base map tiles and country polygons under `/api/maps/` to a signed-in user,
 * with Range requests and an ETag.
 */
export const registerMapRoutes = (server: FastifyInstance, { root, resolveAuth }: MapRoutesOptions): void => {
  server.register(async (scope) => {
    scope.addHook('onRequest', async (req, reply) => {
      await resolveAuth(req, reply);
      if (!req.authUser) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
      return undefined;
    });

    await scope.register(fastifyStatic, {
      root,
      prefix: MAPS_PREFIX,
      decorateReply: false,
      wildcard: false,
      index: false,
      list: false,
      cacheControl: false,
      setHeaders: (reply, path) => {
        reply.header('Cache-Control', path.endsWith('.pmtiles') ? TILES_CACHE_CONTROL : COUNTRIES_CACHE_CONTROL);
      },
    });
  });
};
