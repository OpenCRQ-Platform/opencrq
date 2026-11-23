import type { ProductConnection } from './xtm-providers';
import { errorCategory, logCategory } from '../../../utils/error-category';
import { canonicalXtmOneUrl } from '../../xtm-one/xtm-one-identity';
import { ReaderTokenUnavailable } from '../../xtm-one/xtm-one-token-exchange';
import { isRecord } from './xtm-counterpart-utils';

/**
 * The URL OpenCTI registered with XTM One (its `settings.platform_url`), which XTM One knows it by
 * and so the only audience it addresses a reader's token to. The connector URL is often an address
 * inside the cluster, which XTM One refuses. Read with the connector token, as the sync reads.
 */

export const OPENCTI_PUBLIC_URL_QUERY = 'query OpenCrqPlatformUrl { settings { platform_url } }';
const PUBLIC_URL_TTL_MS = 60 * 60_000;
const PUBLIC_URL_TIMEOUT_MS = 5_000;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Why OpenCTI's public URL is unknown, worded to be logged: never a message from OpenCTI. */
const unreadable = (detail: string) => new ReaderTokenUnavailable(`reading OpenCTI's public URL failed: ${detail}`);

const readPublicUrl = async (connection: ProductConnection, fetchImpl: FetchLike): Promise<string> => {
  let res: Response;
  try {
    res = await fetchImpl(`${connection.url.replace(/\/+$/, '')}/graphql`, {
      method: 'POST',
      // Never logged: the header carries the connector token.
      headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: OPENCTI_PUBLIC_URL_QUERY }),
      redirect: 'manual',
      signal: AbortSignal.timeout(PUBLIC_URL_TIMEOUT_MS),
    });
  } catch (err) {
    throw unreadable(errorCategory(err));
  }
  if (!res.ok) {
    throw unreadable(`HTTP ${res.status}`);
  }
  let answer: unknown;
  try {
    answer = await res.json();
  } catch {
    throw unreadable('the answer is not JSON');
  }
  const data = isRecord(answer) && isRecord(answer.data) ? answer.data : undefined;
  const settings = data && isRecord(data.settings) ? data.settings : undefined;
  const url = typeof settings?.platform_url === 'string' ? canonicalXtmOneUrl(settings.platform_url) : undefined;
  if (url) {
    return url;
  }
  // GraphQL refuses with a 200 whose `errors` carry a code.
  const errors = isRecord(answer) && Array.isArray(answer.errors) ? answer.errors : [];
  const first: unknown = errors[0];
  if (isRecord(first)) {
    const code = isRecord(first.extensions) ? logCategory(first.extensions.code) : null;
    throw unreadable(`OpenCTI refused the query: ${code ?? 'no error code'}`);
  }
  throw unreadable('the settings name no usable platform_url');
};

interface CachedUrl { url: Promise<string>, expiresAt: number }

export interface OpenctiPublicUrl {
  /** OpenCTI's public URL, which throws `ReaderTokenUnavailable` when it cannot be read. */
  resolve: (connection: ProductConnection) => Promise<string>,
  clear: () => void,
}

export const createOpenctiPublicUrl = (fetchImpl: FetchLike = fetch, now: () => number = Date.now): OpenctiPublicUrl => {
  const cache = new Map<string, CachedUrl>();
  return {
    resolve: (connection) => {
      const key = connection.url;
      const cached = cache.get(key);
      if (cached && cached.expiresAt > now()) {
        return cached.url;
      }
      // Shared while it is read, kept an hour once read, dropped on a failure so the next read asks again.
      const entry: CachedUrl = {
        url: readPublicUrl(connection, fetchImpl).then(
          (url) => {
            entry.expiresAt = now() + PUBLIC_URL_TTL_MS;
            return url;
          },
          (err: unknown) => {
            if (cache.get(key) === entry) {
              cache.delete(key);
            }
            throw err;
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

/** The process-wide reader the readers' authorizations go through. */
export const openctiPublicUrl = createOpenctiPublicUrl();
