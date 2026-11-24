import type { EventOrigin, OpenCtiReaderAccess, OpenctiThreatVisibility } from '@app/module';
import { READER_SCOPE_TTL_MS } from '@app/utils';
import type { ReaderAccessIssue } from './reader-access-issue';
import type { ProductConnection, ReaderAuthorization } from './xtm-providers';
import { errorCategory, logCategory } from '../../../utils/error-category';
import { createLogger } from '../../../utils/logger';
import { ReaderTokenUnavailable } from '../../xtm-one/xtm-one-token-exchange';
import { issueOfTokenFailure } from './reader-access-issue';
import { isRecord } from './xtm-counterpart-utils';

const { logWarn } = createLogger({ feature: 'reader-markings' });

/**
 * What one OpenCRQ user may read in the tenant's OpenCTI (opencrq #31, #35): the marking
 * definitions they hold and who they are there (their id, individual, organizations, groups, the
 * BYPASS capability and the platform organization), asked of OpenCTI as that user (the short-lived
 * JWT XTM One signs for them), so OpenCTI's own rules decide, or with the connector token once the
 * tenant chose to show every member what the connector reads. A mirrored object is then read only when OpenCTI would show it to them: all its
 * markings are among theirs, and its organization sharing and authorized members admit them.
 *
 * An `issue` instead of a scope when the answer is unknown (no identity to sign for, a refusal, a
 * timeout, a malformed answer): the reader then holds no clearance and no membership, and sees only
 * unmarked, unrestricted mirrored objects (fail closed means seeing less, never nothing, as OpenAEV
 * ADR-009), and the issue says which category of failure it was.
 * `undefined` when the tenant has no OpenCTI connection: there is no OpenCTI to ask and nothing to
 * enforce, so nothing is narrowed. A lookup is shared per tenant and user from the moment it starts,
 * and its answer kept a short while after, so a page's burst of reads asks OpenCTI once.
 */

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

/** Why OpenCTI's answer holds no scope: GraphQL refuses with a 200 whose `errors` carry a code. */
const unreadableAnswer = (answer: unknown): string => {
  const errors = isRecord(answer) && Array.isArray(answer.errors) ? answer.errors : [];
  const first: unknown = errors[0];
  if (!isRecord(first)) {
    return 'the answer lacks the reader scope fields';
  }
  const code = isRecord(first.extensions) ? logCategory(first.extensions.code) : null;
  return `OpenCTI refused the query: ${code ?? 'no error code'}`;
};

/** `failure` is for the log only; `issue` is what a reader may be told. */
type ScopeAnswer = { ok: true, scope: ReaderScope } | { ok: false, failure: string, issue: ReaderAccessIssue };

const unavailable = (failure: string): ScopeAnswer => ({ ok: false, failure, issue: 'unavailable' });

const fetchReaderScope = async (
  connection: ProductConnection,
  authorization: ReaderAuthorization,
  fetchImpl: FetchLike,
): Promise<ScopeAnswer> => {
  const base = connection.url.replace(/\/+$/, '');
  let bearer: string | null;
  try {
    bearer = await authorization('opencti', connection);
  } catch (err) {
    // Nothing has been sent to OpenCTI yet.
    return {
      ok: false,
      failure: err instanceof ReaderTokenUnavailable ? err.failure : `obtaining the reader's token failed: ${errorCategory(err)}`,
      issue: issueOfTokenFailure(err),
    };
  }
  if (!bearer) {
    return {
      ok: false,
      failure: `no token could be signed for the reader: ${authorization.unsigned ?? 'no reason given'}`,
      issue: 'unavailable',
    };
  }
  const res = await fetchImpl(`${base}/graphql`, {
    method: 'POST',
    // Never logged: the header carries the reader's token.
    headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: READER_MARKINGS_QUERY }),
    signal: AbortSignal.timeout(READER_MARKINGS_TIMEOUT_MS),
  });
  if (!res.ok) {
    return unavailable(`OpenCTI answered HTTP ${res.status}`);
  }
  let answer: unknown;
  try {
    answer = await res.json();
  } catch (err) {
    // A page answering for OpenCTI (a proxy, a wrong URL) is an answer, not a failed request.
    if (err instanceof SyntaxError) {
      return unavailable('OpenCTI answered something other than JSON');
    }
    throw err;
  }
  const scope = parseReaderScope(answer);
  return scope ? { ok: true, scope } : unavailable(unreadableAnswer(answer));
};

/** What OpenCTI lets a reader read, or why that is unknown. */
export type ReaderScopeAnswer = { scope: ReaderScope } | { issue: ReaderAccessIssue };

const lookUpReaderScope = async (
  tenantId: string, userId: string, connection: ProductConnection, authorization: ReaderAuthorization, fetchImpl: FetchLike,
): Promise<ReaderScopeAnswer> => {
  let answer: ScopeAnswer;
  try {
    answer = await fetchReaderScope(connection, authorization, fetchImpl);
  } catch (err) {
    answer = unavailable(`the request failed: ${errorCategory(err)}`);
  }
  if (!answer.ok) {
    logWarn('OpenCTI reader scope unresolved', { tenantId, userId, reason: answer.failure });
    return { issue: answer.issue };
  }
  return { scope: answer.scope };
};

interface CachedScope { scope: Promise<ReaderScopeAnswer>, expiresAt: number }

export interface ReaderMarkingsResolver {
  resolve: (
    tenantId: string,
    userId: string,
    connection: ProductConnection | undefined,
    threatVisibility: OpenctiThreatVisibility,
    authorization: ReaderAuthorization,
  ) => Promise<ReaderScopeAnswer | undefined>,
  clear: () => void,
}

export const createReaderMarkingsResolver = (
  fetchImpl: FetchLike = fetch,
  now: () => number = Date.now,
  ttlMs: number = READER_SCOPE_TTL_MS,
): ReaderMarkingsResolver => {
  const cache = new Map<string, CachedScope>();
  return {
    resolve: async (tenantId, userId, connection, threatVisibility, authorization) => {
      if (!connection?.url) {
        return undefined;
      }
      // A scope read under the other visibility was asked with another bearer.
      const key = `${tenantId}:${userId}:${threatVisibility}`;
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

/**
 * The person's origin narrowed by what OpenCTI answered for them, and what the screens may tell them
 * of it. A tenant that shows every member what the connector reads has nothing to tell them.
 */
export const withReaderScope = (
  origin: Extract<EventOrigin, { type: 'client' }>,
  answer: ReaderScopeAnswer | undefined,
  threatVisibility: OpenctiThreatVisibility,
): { origin: Extract<EventOrigin, { type: 'client' }>, readerAccessIssue: ReaderAccessIssue | null } => {
  if (answer === undefined) {
    return { origin, readerAccessIssue: null };
  }
  const read = 'scope' in answer ? answer.scope : null;
  return {
    origin: { ...origin, markings: read?.markings ?? null, openctiAccess: read?.access ?? null },
    readerAccessIssue: threatVisibility === 'per_member' && 'issue' in answer ? answer.issue : null,
  };
};

/** The process-wide resolver the tenant procedure reads through. */
export const readerMarkings = createReaderMarkingsResolver();
