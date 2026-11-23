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
 * enforce, so nothing is narrowed. A lookup is shared per tenant and user from the moment it starts,
 * and its answer kept a short while after, so a page's burst of reads asks OpenCTI once.
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

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/**
 * A value logged as a category: an error code or name is an identifier, while a message is free text
 * from another product that may name the reader.
 */
const category = (value: unknown): string | null =>
  (typeof value === 'string' && IDENTIFIER.test(value) ? value : null);

/** Why OpenCTI's answer holds no scope: GraphQL refuses with a 200 whose `errors` carry a code. */
const unreadableAnswer = (answer: unknown): string => {
  const errors = isRecord(answer) && Array.isArray(answer.errors) ? answer.errors : [];
  const first: unknown = errors[0];
  if (!isRecord(first)) {
    return 'the answer lacks the reader scope fields';
  }
  const code = isRecord(first.extensions) ? category(first.extensions.code) : null;
  return `OpenCTI refused the query: ${code ?? 'no error code'}`;
};

const requestFailure = (err: unknown): string => {
  const name = err instanceof Error ? category(err.name) : null;
  const cause = err instanceof Error && isRecord(err.cause) ? category(err.cause.code) : null;
  return `the request failed: ${[name ?? 'unknown error', cause].filter(Boolean).join(', ')}`;
};

type ScopeAnswer = { ok: true, scope: ReaderScope } | { ok: false, failure: string };

const fetchReaderScope = async (
  connection: ProductConnection,
  authorization: ReaderAuthorization,
  fetchImpl: FetchLike,
): Promise<ScopeAnswer> => {
  const base = connection.url.replace(/\/+$/, '');
  const bearer = await authorization(base);
  if (!bearer) {
    return { ok: false, failure: 'no token could be signed for the reader' };
  }
  const res = await fetchImpl(`${base}/graphql`, {
    method: 'POST',
    // Never logged: the header carries the reader's token.
    headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: READER_MARKINGS_QUERY }),
    signal: AbortSignal.timeout(READER_MARKINGS_TIMEOUT_MS),
  });
  if (!res.ok) {
    return { ok: false, failure: `OpenCTI answered HTTP ${res.status}` };
  }
  let answer: unknown;
  try {
    answer = await res.json();
  } catch (err) {
    // A page answering for OpenCTI (a proxy, a wrong URL) is an answer, not a failed request.
    if (err instanceof SyntaxError) {
      return { ok: false, failure: 'OpenCTI answered something other than JSON' };
    }
    throw err;
  }
  const scope = parseReaderScope(answer);
  return scope ? { ok: true, scope } : { ok: false, failure: unreadableAnswer(answer) };
};

const lookUpReaderScope = async (
  tenantId: string, userId: string, connection: ProductConnection, authorization: ReaderAuthorization, fetchImpl: FetchLike,
): Promise<ReaderScope | null> => {
  let answer: ScopeAnswer;
  try {
    answer = await fetchReaderScope(connection, authorization, fetchImpl);
  } catch (err) {
    answer = { ok: false, failure: requestFailure(err) };
  }
  if (!answer.ok) {
    logWarn('OpenCTI reader scope unresolved', { tenantId, userId, reason: answer.failure });
    return null;
  }
  return answer.scope;
};

interface CachedScope { scope: Promise<ReaderScope | null>, expiresAt: number }

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
      // The window restarts at the answer; it is set at the start too, so a lookup that never settles is retried.
      const entry: CachedScope = { scope: lookUpReaderScope(tenantId, userId, connection, authorization, fetchImpl), expiresAt: now() + ttlMs };
      const restartWindow = () => {
        entry.expiresAt = now() + ttlMs;
      };
      void entry.scope.then(restartWindow, restartWindow);
      if (cache.size >= MAX_CACHED_READERS) {
        cache.clear();
      }
      cache.set(key, entry);
      return entry.scope;
    },
    clear: () => cache.clear(),
  };
};

/** The process-wide resolver the tenant procedure reads through. */
export const readerMarkings = createReaderMarkingsResolver();
