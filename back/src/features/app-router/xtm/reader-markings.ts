import type { ProductConnection, ReaderAuthorization } from './xtm-providers';
import { isRecord } from './xtm-counterpart-utils';

/**
 * The OpenCTI marking definitions one OpenCRQ user may read there (opencrq #31): asked of the
 * tenant's OpenCTI as that user (the short-lived JWT this platform signs for them, opencrq #24),
 * never with the connector token, so OpenCTI's own marking rules decide. A threat mirrored from
 * OpenCTI is then read only when all its markings are among them.
 *
 * `null` when the answer is unknown (no OpenCTI connection, no identity to sign for, a refusal, a
 * timeout, a malformed answer): the reader then sees no mirrored threat (fail closed). Answers are
 * kept a short while per tenant and user so a page's burst of reads asks OpenCTI once.
 */

export const READER_MARKINGS_TTL_MS = 60_000;
const READER_MARKINGS_TIMEOUT_MS = 5_000;
const MAX_CACHED_READERS = 5_000;

export const READER_MARKINGS_QUERY = 'query OpenCrqReaderMarkings { me { allowed_marking { standard_id } } }';

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** The `standard_id`s of `me.allowed_marking`, or `null` when the answer is not that shape. */
export const parseAllowedMarkings = (answer: unknown): Array<string> | null => {
  const data = isRecord(answer) && isRecord(answer.data) ? answer.data : undefined;
  const me = data && isRecord(data.me) ? data.me : undefined;
  if (!me || !Array.isArray(me.allowed_marking)) {
    return null;
  }
  const ids = me.allowed_marking.flatMap((marking: unknown) =>
    (isRecord(marking) && typeof marking.standard_id === 'string' ? [marking.standard_id] : []));
  return [...new Set(ids)].sort();
};

const fetchAllowedMarkings = async (
  connection: ProductConnection,
  authorization: ReaderAuthorization,
  fetchImpl: FetchLike,
): Promise<Array<string> | null> => {
  const base = connection.url.replace(/\/+$/, '');
  const bearer = await authorization(base);
  if (!bearer) {
    return null;
  }
  const res = await fetchImpl(`${base}/graphql`, {
    method: 'POST',
    // Never logged: the header carries the reader's token.
    headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: READER_MARKINGS_QUERY }),
    signal: AbortSignal.timeout(READER_MARKINGS_TIMEOUT_MS),
  });
  if (!res.ok) {
    return null;
  }
  return parseAllowedMarkings(await res.json());
};

interface CachedMarkings { markings: ReadonlyArray<string> | null, expiresAt: number }

export interface ReaderMarkingsResolver {
  resolve: (tenantId: string, userId: string, connection: ProductConnection | undefined, authorization: ReaderAuthorization) => Promise<ReadonlyArray<string> | null>,
  clear: () => void,
}

export const createReaderMarkingsResolver = (
  fetchImpl: FetchLike = fetch,
  now: () => number = Date.now,
  ttlMs: number = READER_MARKINGS_TTL_MS,
): ReaderMarkingsResolver => {
  const cache = new Map<string, CachedMarkings>();
  return {
    resolve: async (tenantId, userId, connection, authorization) => {
      if (!connection?.url) {
        return null;
      }
      const key = `${tenantId}:${userId}`;
      const cached = cache.get(key);
      if (cached && cached.expiresAt > now()) {
        return cached.markings;
      }
      let markings: ReadonlyArray<string> | null;
      try {
        markings = await fetchAllowedMarkings(connection, authorization, fetchImpl);
      } catch {
        markings = null;
      }
      if (cache.size >= MAX_CACHED_READERS) {
        cache.clear();
      }
      cache.set(key, { markings, expiresAt: now() + ttlMs });
      return markings;
    },
    clear: () => cache.clear(),
  };
};

/** The process-wide resolver the tenant procedure reads through. */
export const readerMarkings = createReaderMarkingsResolver();
