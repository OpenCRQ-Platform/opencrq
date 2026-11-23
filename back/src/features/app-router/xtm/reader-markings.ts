import type { OpenCtiReaderAccess } from '@app/module';
import type { ProductConnection, ReaderAuthorization } from './xtm-providers';
import { createLogger } from '../../../utils/logger';
import { isRecord } from './xtm-counterpart-utils';

const { logWarn } = createLogger({ feature: 'reader-markings' });

/**
 * What one OpenCRQ user may read in the tenant's OpenCTI (opencrq #31, #35): the marking
 * definitions they hold and who they are there (their id, individual, organizations, groups, the
 * BYPASS capability and the platform organization), asked of OpenCTI as that user (the short-lived
 * JWT this platform signs for them, opencrq #24), never with the connector token, so OpenCTI's own
 * rules decide. A mirrored object is then read only when OpenCTI would show it to them: all its
 * markings are among theirs, and its organization sharing and authorized members admit them.
 *
 * `null` when the answer is unknown (no identity to sign for, a refusal, a timeout, a malformed
 * answer): the reader then holds no clearance and no membership, and sees only unmarked,
 * unrestricted mirrored objects (fail closed means seeing less, never nothing, as OpenAEV ADR-009).
 * `undefined` when the tenant has no OpenCTI connection: there is no OpenCTI to ask and nothing to
 * enforce, so nothing is narrowed. Answers are kept a short while per tenant and user so a page's
 * burst of reads asks OpenCTI once.
 */

export const READER_MARKINGS_TTL_MS = 60_000;
const READER_MARKINGS_TIMEOUT_MS = 5_000;
const MAX_CACHED_READERS = 5_000;
const BYPASS_CAPABILITY = 'BYPASS';

export const READER_MARKINGS_QUERY = 'query OpenCrqReaderScope { me { id individual_id allowed_marking { standard_id } objectOrganization { edges { node { id } } } groups { edges { node { id } } } capabilities { name } } settings { platform_organization { id } } }';

export interface ReaderScope {
  readonly markings: ReadonlyArray<string>,
  readonly access: OpenCtiReaderAccess,
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const uniqueSorted = (values: Array<string>): Array<string> => [...new Set(values)].sort();

/** The `standard_id`s of `me.allowed_marking`, or `null` when the answer is not that shape. */
export const parseAllowedMarkings = (answer: unknown): Array<string> | null => {
  const data = isRecord(answer) && isRecord(answer.data) ? answer.data : undefined;
  const me = data && isRecord(data.me) ? data.me : undefined;
  if (!me || !Array.isArray(me.allowed_marking)) {
    return null;
  }
  return uniqueSorted(me.allowed_marking.flatMap((marking: unknown) =>
    (isRecord(marking) && typeof marking.standard_id === 'string' ? [marking.standard_id] : [])));
};

/** The node ids of a connection (`{ edges: [{ node: { id } }] }`); a missing connection holds none. */
const connectionIds = (connection: unknown): Array<string> => {
  if (!isRecord(connection) || !Array.isArray(connection.edges)) {
    return [];
  }
  return uniqueSorted(connection.edges.flatMap((edge: unknown) =>
    (isRecord(edge) && isRecord(edge.node) && typeof edge.node.id === 'string' ? [edge.node.id] : [])));
};

/**
 * The reader's markings and OpenCTI identity, or `null` when the answer lacks `me`, its id, its
 * markings or the settings: an identity read in part could admit a reader to an organization's
 * objects on a guess, so it is no identity at all.
 */
export const parseReaderScope = (answer: unknown): ReaderScope | null => {
  const markings = parseAllowedMarkings(answer);
  const data = isRecord(answer) && isRecord(answer.data) ? answer.data : undefined;
  const me = data && isRecord(data.me) ? data.me : undefined;
  if (markings === null || !me || typeof me.id !== 'string' || !data || !isRecord(data.settings)) {
    return null;
  }
  const platformOrganization = data.settings.platform_organization;
  const capabilities = Array.isArray(me.capabilities) ? me.capabilities : [];
  return {
    markings,
    access: {
      userId: me.id,
      individualId: typeof me.individual_id === 'string' ? me.individual_id : null,
      organizationIds: connectionIds(me.objectOrganization),
      groupIds: connectionIds(me.groups),
      bypass: capabilities.some((capability: unknown) => isRecord(capability) && capability.name === BYPASS_CAPABILITY),
      platformOrganizationId: isRecord(platformOrganization) && typeof platformOrganization.id === 'string' ? platformOrganization.id : null,
    },
  };
};

/** Why OpenCTI's answer holds no scope: GraphQL reports its refusals as a 200 with `errors`. */
const unreadableAnswer = (answer: unknown): string => {
  const errors = isRecord(answer) && Array.isArray(answer.errors) ? answer.errors : [];
  const first: unknown = errors[0];
  return isRecord(first) && typeof first.message === 'string'
    ? `OpenCTI refused the query: ${first.message.slice(0, 200)}`
    : 'the answer lacks the reader scope fields';
};

type ScopeAnswer = { scope: ReaderScope } | { failure: string };

const fetchReaderScope = async (
  connection: ProductConnection,
  authorization: ReaderAuthorization,
  fetchImpl: FetchLike,
): Promise<ScopeAnswer> => {
  const base = connection.url.replace(/\/+$/, '');
  const bearer = await authorization(base);
  if (!bearer) {
    return { failure: 'no token could be signed for the reader' };
  }
  const res = await fetchImpl(`${base}/graphql`, {
    method: 'POST',
    // Never logged: the header carries the reader's token.
    headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: READER_MARKINGS_QUERY }),
    signal: AbortSignal.timeout(READER_MARKINGS_TIMEOUT_MS),
  });
  if (!res.ok) {
    return { failure: `OpenCTI answered HTTP ${res.status}` };
  }
  const answer: unknown = await res.json();
  const scope = parseReaderScope(answer);
  return scope ? { scope } : { failure: unreadableAnswer(answer) };
};

interface CachedScope { scope: ReaderScope | null, expiresAt: number }

export interface ReaderMarkingsResolver {
  resolve: (tenantId: string, userId: string, connection: ProductConnection | undefined, authorization: ReaderAuthorization) => Promise<ReaderScope | null | undefined>,
  clear: () => void,
}

export const createReaderMarkingsResolver = (
  fetchImpl: FetchLike = fetch,
  now: () => number = Date.now,
  ttlMs: number = READER_MARKINGS_TTL_MS,
): ReaderMarkingsResolver => {
  const cache = new Map<string, CachedScope>();
  return {
    resolve: async (tenantId, userId, connection, authorization) => {
      if (!connection?.url) {
        return undefined;
      }
      const key = `${tenantId}:${userId}`;
      const cached = cache.get(key);
      if (cached && cached.expiresAt > now()) {
        return cached.scope;
      }
      let answer: ScopeAnswer;
      try {
        answer = await fetchReaderScope(connection, authorization, fetchImpl);
      } catch (err) {
        answer = { failure: `the request failed: ${err instanceof Error ? err.message : 'unknown error'}` };
      }
      const scope = 'scope' in answer ? answer.scope : null;
      if ('failure' in answer) {
        logWarn('OpenCTI reader scope unresolved', { tenantId, userId, reason: answer.failure });
      }
      if (cache.size >= MAX_CACHED_READERS) {
        cache.clear();
      }
      cache.set(key, { scope, expiresAt: now() + ttlMs });
      return scope;
    },
    clear: () => cache.clear(),
  };
};

/** The process-wide resolver the tenant procedure reads through. */
export const readerMarkings = createReaderMarkingsResolver();
