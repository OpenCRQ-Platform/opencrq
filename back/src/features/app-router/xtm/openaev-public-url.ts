import type { ProductConnection } from './xtm-providers';
import { errorCategory } from '../../../utils/error-category';
import { canonicalXtmOneUrl } from '../../xtm-one/xtm-one-identity';
import { ReaderTokenUnavailable } from '../../xtm-one/xtm-one-token-exchange';
import { isRecord } from './xtm-counterpart-utils';

const PUBLIC_URL_TIMEOUT_MS = 5_000;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Why OpenAEV's public URL is unknown, worded to be logged: never a message from OpenAEV. */
const unreadable = (detail: string) => new ReaderTokenUnavailable(`reading OpenAEV's public URL failed: ${detail}`);

/**
 * The URL OpenAEV is reached on from a browser (its `openaev.base-url`, served as `platform_base_url`
 * on `GET /api/settings`), read with the connector token. The connection URL is often an address
 * inside the cluster.
 */
export const readOpenaevPublicUrl = async (connection: ProductConnection, fetchImpl: FetchLike = fetch): Promise<string> => {
  let res: Response;
  try {
    res = await fetchImpl(`${connection.url.replace(/\/+$/, '')}/api/settings`, {
      // Never logged: the header carries the connector token.
      headers: { Authorization: `Bearer ${connection.token}`, Accept: 'application/json' },
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
  const url = isRecord(answer) && typeof answer.platform_base_url === 'string' ? canonicalXtmOneUrl(answer.platform_base_url) : undefined;
  if (!url) {
    throw unreadable('the settings name no usable platform_base_url');
  }
  return url;
};
