import compress from '@fastify/compress';
import type { FastifyInstance } from 'fastify';
import { constants } from 'node:zlib';

/**
 * The plugin's default types leave `text/event-stream` out, which keeps the data change doorbell
 * unbuffered. A streamed query batch writes each call's result as it resolves, hence the flush
 * after every write, without which a fast call would wait for the slowest one of its batch. A tRPC
 * response is always a stream, so the size threshold never applies to it. A response marked
 * `Cache-Control: no-transform` is sent as it is: the map tiles are read by byte offsets.
 *
 * Await it before declaring any route: a route declared while the plugin is still queued is sent
 * uncompressed.
 */
export const registerResponseCompression = async (server: FastifyInstance): Promise<void> => {
  await server.register(compress, {
    encodings: ['br', 'gzip'],
    globalDecompression: false,
    respectNoTransform: true,
    zlibOptions: { flush: constants.Z_SYNC_FLUSH },
    brotliOptions: {
      flush: constants.BROTLI_OPERATION_FLUSH,
      // Any `brotliOptions` drops the plugin's default of 4, and zlib's 11 is far slower.
      params: { [constants.BROTLI_PARAM_QUALITY]: 4 },
    },
  });
};
