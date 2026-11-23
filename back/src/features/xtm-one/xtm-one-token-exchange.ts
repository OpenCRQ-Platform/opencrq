import { StructuredError } from '@app/utils';
import type { XtmOneSettings } from './xtm-one-config';
import { errorCategory } from '../../utils/error-category';
import { canonicalXtmOneUrl } from './xtm-one-identity';

/**
 * A reader's token for a sibling product (OpenCTI, OpenAEV), signed by XTM One: those products trust
 * XTM One as an issuer and never this platform, so the token this platform signs for XTM One is
 * exchanged there (`POST /xtm/auth/exchange`) for one addressed to the product. XTM One answers only
 * for a product registered with it, named by the URL it registered.
 */

const EXCHANGE_PATH = '/xtm/auth/exchange';
const EXCHANGE_TIMEOUT_MS = 5_000;
const DEFAULT_TTL_SECONDS = 10 * 60;
/** A token is used again until this long before it expires, so none reaches a product expired. */
const EXPIRY_MARGIN_MS = 60_000;
const MAX_CACHED_TOKENS = 5_000;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Which 403 XTM One answered, told by its `detail`: `audience`, the product is not a platform
 * registered with it under that URL; `user`, the reader has no active account there.
 */
export type ExchangeRefusal = 'audience' | 'user';

const REFUSALS: ReadonlyArray<{ detail: string, refusal: ExchangeRefusal, reason: string }> = [
  { detail: 'The audience is not another active registered platform', refusal: 'audience', reason: 'the product is not registered with it under that URL' },
  { detail: 'User not found', refusal: 'user', reason: 'the reader has no active account there' },
];

/** Why no token could be obtained, worded to be logged: it never carries a message from XTM One. */
export class ReaderTokenUnavailable extends StructuredError {
  override readonly name: string = 'ReaderTokenUnavailable';

  constructor(readonly failure: string, readonly refusal: ExchangeRefusal | null = null) {
    super(failure, { data: {} });
  }
}

/** A 403 named by its `detail`, matched against XTM One's own constants and never echoed. */
const refusedExchange = async (res: Response): Promise<ReaderTokenUnavailable> => {
  const answer: unknown = await res.json().catch(() => undefined);
  const detail = typeof answer === 'object' && answer !== null && 'detail' in answer ? answer.detail : undefined;
  const known = REFUSALS.find((candidate) => candidate.detail === detail);
  return known
    ? new ReaderTokenUnavailable(`XTM One refused the token exchange: HTTP 403, ${known.reason}`, known.refusal)
    : new ReaderTokenUnavailable('XTM One refused the token exchange: HTTP 403');
};

const readExchangeAnswer = async (res: Response): Promise<{ token: string, ttlSeconds: number }> => {
  let answer: unknown;
  try {
    answer = await res.json();
  } catch {
    throw new ReaderTokenUnavailable('XTM One answered the token exchange with something other than JSON');
  }
  const fields = typeof answer === 'object' && answer !== null ? answer : {};
  const token = 'access_token' in fields ? fields.access_token : undefined;
  const ttl = 'expires_in' in fields ? fields.expires_in : undefined;
  if (typeof token !== 'string' || token.length === 0) {
    throw new ReaderTokenUnavailable('XTM One answered the token exchange without a token');
  }
  return { token, ttlSeconds: typeof ttl === 'number' && ttl > 0 ? ttl : DEFAULT_TTL_SECONDS };
};

const requestToken = async (
  settings: XtmOneSettings,
  xtmOneHeaders: () => Promise<Record<string, string>>,
  audience: string,
  fetchImpl: FetchLike,
): Promise<{ token: string, ttlSeconds: number }> => {
  let headers: Record<string, string>;
  try {
    headers = await xtmOneHeaders();
  } catch (err) {
    // Signing reads the key from the database: nothing has been sent to XTM One yet.
    throw new ReaderTokenUnavailable(`signing the reader's token for XTM One failed: ${errorCategory(err)}`);
  }
  let res: Response;
  try {
    res = await fetchImpl(`${settings.url}${EXCHANGE_PATH}`, {
      method: 'POST',
      // Never logged: the header carries the reader's token.
      headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ audience }),
      redirect: 'manual',
      signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
    });
  } catch (err) {
    throw new ReaderTokenUnavailable(`the token exchange with XTM One failed: ${errorCategory(err)}`);
  }
  if (res.status === 403) {
    throw await refusedExchange(res);
  }
  if (!res.ok) {
    throw new ReaderTokenUnavailable(`XTM One refused the token exchange: HTTP ${res.status}`);
  }
  return readExchangeAnswer(res);
};

interface CachedToken { token: Promise<string>, expiresAt: number }

export interface ReaderTokenExchange {
  /** The reader's token for the product at `audience`, which throws `ReaderTokenUnavailable` when XTM One gives none. */
  exchange: (settings: XtmOneSettings, xtmOneHeaders: () => Promise<Record<string, string>>, userId: string, audience: string) => Promise<string>,
  clear: () => void,
}

export const createReaderTokenExchange = (fetchImpl: FetchLike = fetch, now: () => number = Date.now): ReaderTokenExchange => {
  const cache = new Map<string, CachedToken>();
  return {
    exchange: (settings, xtmOneHeaders, userId, audience) => {
      const target = canonicalXtmOneUrl(audience) ?? audience;
      const key = `${userId} ${target}`;
      const cached = cache.get(key);
      if (cached && cached.expiresAt > now()) {
        return cached.token;
      }
      // Shared while it is asked, so a page's burst of reads exchanges once; kept until shortly before
      // it expires, and dropped when the exchange fails, so the next read asks again.
      const entry: CachedToken = {
        token: requestToken(settings, xtmOneHeaders, target, fetchImpl).then(
          ({ token, ttlSeconds }) => {
            entry.expiresAt = now() + ttlSeconds * 1000 - EXPIRY_MARGIN_MS;
            return token;
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
      if (cache.size >= MAX_CACHED_TOKENS) {
        cache.clear();
      }
      cache.set(key, entry);
      return entry.token;
    },
    clear: () => cache.clear(),
  };
};

/** The process-wide exchange the readers' authorizations go through. */
export const readerTokenExchange = createReaderTokenExchange();
