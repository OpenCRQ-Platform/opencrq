import type { ProductConnection, ReaderProduct } from './xtm-providers';
import { createLogger } from '../../../utils/logger';
import { readOpenaevPublicUrl } from './openaev-public-url';
import { openctiPublicUrl } from './opencti-public-url';

const { logWarn } = createLogger({ feature: 'public-product-urls' });

const FOUND_TTL_MS = 60 * 60_000;
// A product that cannot be asked is not asked again for a minute, so that its connection URL is
// answered at once instead of after the lookup's timeout on every call.
const FAILED_TTL_MS = 60_000;

type PublicUrlReader = (connection: ProductConnection) => Promise<string>;

export interface PublicProductUrls {
  /**
   * The URL a browser reaches the product behind `connection` on: the one the product names itself,
   * else the connection's own URL, which is all there is when the product cannot be asked.
   */
  resolve: (product: ReaderProduct, connection: ProductConnection) => Promise<string>,
  clear: () => void,
}

interface Entry { url: Promise<string>, expiresAt: number }

const trimSlash = (url: string) => url.replace(/\/+$/, '');

export const createPublicProductUrls = (
  readers: Record<ReaderProduct, PublicUrlReader>,
  now: () => number = Date.now,
): PublicProductUrls => {
  const cache = new Map<string, Entry>();
  return {
    resolve: (product, connection) => {
      const key = `${product} ${connection.url}`;
      const cached = cache.get(key);
      if (cached && cached.expiresAt > now()) {
        return cached.url;
      }
      // Shared while it is read; both outcomes are kept, the failure for less time.
      const entry: Entry = {
        url: readers[product](connection).then(
          (url) => {
            entry.expiresAt = now() + FOUND_TTL_MS;
            return url;
          },
          (err: unknown) => {
            entry.expiresAt = now() + FAILED_TTL_MS;
            logWarn('Product public URL unknown, using the connection URL', { product, reason: err instanceof Error ? err.message : 'unknown' });
            return trimSlash(connection.url);
          },
        ),
        expiresAt: Number.POSITIVE_INFINITY,
      };
      cache.set(key, entry);
      return entry.url;
    },
    clear: () => cache.clear(),
  };
};

/** The process-wide resolver `integrations.getConnectorsStatus` goes through. */
export const publicProductUrls = createPublicProductUrls({
  opencti: (connection) => openctiPublicUrl.resolve(connection),
  openaev: (connection) => readOpenaevPublicUrl(connection),
});
