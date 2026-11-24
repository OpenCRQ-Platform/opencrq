import { READER_SCOPE_TTL_MS } from '@app/utils';
import type { ReaderAccessIssue } from './reader-access-issue';
import type { ProductConnection, ReaderAuthorization, ReaderProduct } from './xtm-providers';
import { probeReaderIssue } from './reader-access-issue';

/**
 * Whether a member can read a sibling product as themselves, kept a short while per tenant, member
 * and product: a failed token exchange is never cached by the exchange itself, so without this an
 * XTM One outage would make every call wait for it.
 */

const MAX_CACHED_ACCESS = 5_000;

interface CachedAccess { issue: Promise<ReaderAccessIssue | null>, expiresAt: number }

export interface CounterpartAccess {
  resolve: (
    tenantId: string,
    userId: string,
    product: ReaderProduct,
    connection: ProductConnection,
    authorization: ReaderAuthorization,
  ) => Promise<ReaderAccessIssue | null>,
}

export const createCounterpartAccess = (
  now: () => number = Date.now,
  ttlMs: number = READER_SCOPE_TTL_MS,
): CounterpartAccess => {
  const cache = new Map<string, CachedAccess>();
  return {
    resolve: (tenantId, userId, product, connection, authorization) => {
      const key = `${tenantId}:${userId}:${product}`;
      const cached = cache.get(key);
      if (cached && cached.expiresAt > now()) {
        return cached.issue;
      }
      const entry: CachedAccess = { issue: probeReaderIssue(authorization, product, connection), expiresAt: now() + ttlMs };
      if (cache.size >= MAX_CACHED_ACCESS) {
        cache.clear();
      }
      cache.set(key, entry);
      return entry.issue;
    },
  };
};

/** The process-wide cache the `readerAccess` query reads through. */
export const counterpartAccess = createCounterpartAccess();

type TenantConnections = Partial<Record<ReaderProduct, Record<string, ProductConnection> | undefined>> | undefined;

/**
 * Why a person cannot be read as themselves in each sibling product the tenant connected, `null`
 * where nothing stops it. Only a person pivots, and only into a connected product.
 */
export const readCounterpartIssues = async (
  access: CounterpartAccess,
  reader: { tenantId: string, userId: string | undefined, connections: TenantConnections, authorization: ReaderAuthorization },
): Promise<Record<ReaderProduct, ReaderAccessIssue | null>> => {
  const { tenantId, userId, connections, authorization } = reader;
  const issueOf = (product: ReaderProduct) => {
    const connection = connections?.[product]?.[tenantId];
    return userId !== undefined && connection?.url && connection.token
      ? access.resolve(tenantId, userId, product, connection, authorization)
      : null;
  };
  const [opencti, openaev] = await Promise.all([issueOf('opencti'), issueOf('openaev')]);
  return { opencti, openaev };
};
