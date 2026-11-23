import { NonRetryableError, TimeoutError } from '@app/module';
import type { OpenaevMarkingVocabulary } from './openaev-marking-phase';
import type { AiTargetAsset, AssetInventoryRow, AssetOverview, AttackObservation, AttackPathGraph, AttackPathSimulation, EndpointEntity, OpenaevAssetGroup, OpenaevTag, OpenaevUser, SnapshotPage, TenantOutput, VulnerabilityObservation } from './openaev-types';
import { fromError, newError, StructuredError } from '@app/utils';
import {
  aiTargetAssetSchema,
  assetInventoryRowSchema,
  assetOverviewSchema,
  attackObservationSchema,
  attackPathGraphSchema,
  attackPathSimulationSchema,
  endpointEntitySchema,
  openaevAssetGroupSchema,
  openaevMarkingDefinitionSchema,
  openaevPageSchema,
  openaevTagSchema,
  openaevUserSchema,
  snapshotSearchOutputSchema,
  tenantOutputSchema,
  vulnerabilityObservationSchema,
} from './openaev-types';

const FETCH_TIMEOUT_MS = 120_000;
const MAX_PAGES = 1_000;
/** OpenAEV's maximum `page_size` for the snapshot streams. */
const SNAPSHOT_PAGE_SIZE = 1_000;

/** Replaces the generic message of a status that means something specific on one route. */
type StatusMessages = Partial<Record<number, string>>;

export const SNAPSHOT_STATUS_MESSAGES: StatusMessages = {
  403: 'OpenAEV refused the snapshot request: the account lacks the ACCESS_SNAPSHOT_OBSERVATION capability',
  404: 'OpenAEV snapshot route not found: the BULK_SNAPSHOT_EXPORT preview feature is off on this OpenAEV instance',
};

/**
 * Thrown for a 403: still non-retryable, so a route the sync cannot do without kills the job as
 * before, while a caller that can do without the route (an optional vocabulary) tells it apart.
 */
export class OpenaevForbiddenError extends NonRetryableError {
  override readonly name: string = 'OpenaevForbiddenError';
}

// Thrown for 404s so callers can skip a single missing resource (e.g. a deleted
// asset) instead of the whole sync job being killed as non-retryable.
export class OpenaevNotFoundError extends StructuredError {
  override readonly name: string = 'OpenaevNotFoundError';

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, { data: {}, ...options });
  }
}

interface OpenaevPageResponse<T> {
  content: Array<T>,
  totalElements: number,
  totalPages: number,
  number: number,
  size: number,
  last: boolean,
}

/**
 * Reads every page of an offset-paged search. `totalElements` is the count every page reported, or
 * `null` when two pages disagreed: the collection changed during the read, so an offset may have
 * shifted and skipped or repeated an item.
 */
export const paginateAll = async <T>(
  fetchPage: (page: number) => Promise<{ content: Array<T>, last: boolean, totalElements: number }>,
  signal: AbortSignal,
  onMaxPagesReached?: (pages: number) => void,
): Promise<{ items: Array<T>, totalElements: number | null }> => {
  const items: Array<T> = [];
  const totals = new Set<number>();
  let page = 0;
  while (!signal.aborted && page < MAX_PAGES) {
    const result = await fetchPage(page);
    totals.add(result.totalElements);
    if (result.content.length === 0) {
      break;
    }
    items.push(...result.content);
    if (result.last) {
      break;
    }
    page++;
  }
  if (!signal.aborted && page >= MAX_PAGES) {
    onMaxPagesReached?.(MAX_PAGES);
  }
  return { items, totalElements: totals.size === 1 ? [...totals][0] : null };
};

const fetchJson = async (url: string, options: RequestInit, signal: AbortSignal, statusMessages: StatusMessages = {}): Promise<unknown> => {
  const fetchSignal = AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]);
  let res: Response;
  try {
    res = await fetch(url, { ...options, signal: fetchSignal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new TimeoutError(`OpenAEV fetch timed out after ${FETCH_TIMEOUT_MS}ms`, { cause: err });
    }
    throw err;
  }

  const statusMessage = statusMessages[res.status];
  if (statusMessage) {
    const body = await res.text();
    throw new NonRetryableError(`${statusMessage} (${res.status}): ${body.slice(0, 200)}`);
  }
  if (res.status === 403) {
    const body = await res.text();
    throw new OpenaevForbiddenError(`OpenAEV auth error (${res.status}): ${body.slice(0, 200)}`);
  }
  if (res.status === 401) {
    const body = await res.text();
    throw new NonRetryableError(`OpenAEV auth error (${res.status}): ${body.slice(0, 200)}`);
  }
  if (res.status === 404) {
    const body = await res.text();
    throw new OpenaevNotFoundError(`OpenAEV resource not found (404): ${body.slice(0, 200)}`);
  }
  if (res.status >= 400 && res.status < 500 && res.status !== 429) {
    const body = await res.text();
    throw new NonRetryableError(`OpenAEV request error (${res.status}): ${body.slice(0, 200)}`);
  }
  if (!res.ok) {
    const body = await res.text();
    throw newError(`OpenAEV error (${res.status}): ${body.slice(0, 200)}`);
  }

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (err) {
    throw fromError(err, `OpenAEV non-JSON response: ${text.slice(0, 200)}`);
  }
};

/**
 * Authenticated calls to one OpenAEV instance with the status mapping of `fetchJson`; `post` takes
 * the messages that replace the generic one of a status that means something specific on its route.
 */
export const createOpenaevTransport = (baseUrl: string, token: string, signal: AbortSignal) => {
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const buildUrl = (path: string): string => new URL(path, baseUrl).toString();

  return {
    get: (path: string): Promise<unknown> =>
      fetchJson(buildUrl(path), { method: 'GET', headers }, signal),

    post: (path: string, body: unknown, statusMessages?: StatusMessages): Promise<unknown> =>
      fetchJson(buildUrl(path), { method: 'POST', headers, body: JSON.stringify(body) }, signal, statusMessages),

    tenantPath: (tenantId: string, path: string): string => `/api/tenants/${tenantId}${path}`,
  };
};

export const createOpenaevClient = (baseUrl: string, token: string, signal: AbortSignal) => {
  const { get, post, tenantPath } = createOpenaevTransport(baseUrl, token, signal);

  const snapshotRequestBody = (cursor: string | null) => ({ ...(cursor === null ? {} : { cursor }), page_size: SNAPSHOT_PAGE_SIZE });

  return {
    listTenants: async (): Promise<Array<TenantOutput>> => {
      const raw = await get('/api/me/tenants');
      return tenantOutputSchema.array().parse(raw);
    },

    // Unified inventory: every asset category (endpoints, AI targets, identities, cloud/web/network/
    // generic assets), thin. OpenAEV's own /assets/search excludes security platforms server-side —
    // they never reach us here.
    searchAssets: async (
      tenantId: string,
      page: number,
    ): Promise<OpenaevPageResponse<AssetInventoryRow>> => {
      // Unsorted: OpenAEV sorts only on `@Queryable(sortable = true)` fields, none of which is
      // unique, and answers any other sort property with a 400.
      const raw = await post(tenantPath(tenantId, '/assets/search'), {
        page,
        size: 100,
      });
      return openaevPageSchema(assetInventoryRowSchema).parse(raw);
    },

    /** The ids among `ids` (at most 100) that OpenAEV still lists in the tenant's inventory. */
    findListedAssetIds: async (tenantId: string, ids: Array<string>): Promise<Set<string>> => {
      const raw = await post(tenantPath(tenantId, '/assets/search'), {
        page: 0,
        size: ids.length,
        filterGroup: { mode: 'and', filters: [{ id: '0', key: 'asset_id', mode: 'or', values: ids, operator: 'eq' }] },
      });
      return new Set(openaevPageSchema(assetInventoryRowSchema).parse(raw).content.map((row) => row.asset_id));
    },

    // Full Endpoint entities (hostname/IPs/MACs/seen-IP included) for the machine-family ids the
    // inventory pass found — unlike /assets/search and /endpoints/search, which never serve them.
    findEndpoints: async (tenantId: string, ids: Array<string>): Promise<Array<EndpointEntity>> => {
      const raw = await post(tenantPath(tenantId, '/endpoints/find'), ids);
      return endpointEntitySchema.array().parse(raw);
    },

    /**
     * The generic asset overview, one call per asset. Reserved for the assets neither
     * `/endpoints/find` nor `/ai_targets/search` answers for: OpenAEV serves no batch route
     * carrying a description for those, so this is the only way to get one.
     */
    getAssetOverview: async (tenantId: string, assetId: string): Promise<AssetOverview> => {
      const raw = await get(tenantPath(tenantId, `/assets/${assetId}`));
      return assetOverviewSchema.parse(raw);
    },

    searchAiTargets: async (
      tenantId: string,
      page: number,
    ): Promise<OpenaevPageResponse<AiTargetAsset>> => {
      const raw = await post(tenantPath(tenantId, '/ai_targets/search'), {
        page,
        size: 100,
      });
      return openaevPageSchema(aiTargetAssetSchema).parse(raw);
    },

    /**
     * Next page of the attack-observation snapshot stream, resuming after `cursor` (`null` starts a
     * full walk). Always `page_size: 1000`, never `since`. A 404 means `BULK_SNAPSHOT_EXPORT` is off
     * on the OpenAEV instance and a 403 that the account lacks `ACCESS_SNAPSHOT_OBSERVATION`; both
     * are `NonRetryableError`.
     */
    searchAttackObservations: async (
      tenantId: string,
      { cursor }: { cursor: string | null },
    ): Promise<SnapshotPage<AttackObservation>> => {
      const raw = await post(tenantPath(tenantId, '/snapshot/attack-observations/search'), snapshotRequestBody(cursor), SNAPSHOT_STATUS_MESSAGES);
      return snapshotSearchOutputSchema(attackObservationSchema).parse(raw);
    },

    /** `searchAttackObservations` for the vulnerability stream, with the same request and error contract. */
    searchVulnerabilityObservations: async (
      tenantId: string,
      { cursor }: { cursor: string | null },
    ): Promise<SnapshotPage<VulnerabilityObservation>> => {
      const raw = await post(tenantPath(tenantId, '/snapshot/vulnerability-observations/search'), snapshotRequestBody(cursor), SNAPSHOT_STATUS_MESSAGES);
      return snapshotSearchOutputSchema(vulnerabilityObservationSchema).parse(raw);
    },

    findUsers: async (tenantId: string, ids: Array<string>): Promise<Array<OpenaevUser>> => {
      const raw = await post(tenantPath(tenantId, '/users/find'), ids);
      return openaevUserSchema.array().parse(raw);
    },

    listTags: async (tenantId: string): Promise<Array<OpenaevTag>> => {
      const raw = await get(tenantPath(tenantId, '/tags'));
      return openaevTagSchema.array().parse(raw);
    },

    /**
     * The tenant's marking definitions the account is cleared for, each with the STIX id OpenCTI
     * gives it when OpenAEV holds one. `/assignable` needs no capability (OpenAEV narrows it to the
     * caller's clearance), unlike `/search`, which needs ACCESS_MARKING_DEFINITION that no connector
     * role holds. An OpenAEV without the route (404) or refusing it (403) serves no vocabulary: the
     * sync goes on without one rather than dying on an optional read.
     */
    listAssignableMarkingDefinitions: async (tenantId: string): Promise<OpenaevMarkingVocabulary> => {
      try {
        const raw = await get(tenantPath(tenantId, '/marking_definitions/assignable'));
        return { available: true, markings: openaevMarkingDefinitionSchema.array().parse(raw) };
      } catch (err) {
        if (err instanceof OpenaevNotFoundError || err instanceof OpenaevForbiddenError) {
          return { available: false, reason: err.message };
        }
        throw err;
      }
    },

    /** The simulations of the tenant that hold attack-path executions. */
    listAttackPathSimulations: async (tenantId: string): Promise<Array<AttackPathSimulation>> => {
      const raw = await get(tenantPath(tenantId, '/attack-path/simulations'));
      return attackPathSimulationSchema.array().parse(raw);
    },

    /** One simulation's attack path, collapsed: one edge per source and target, never one per execution. */
    getAttackPathGraph: async (tenantId: string, simulationId: string): Promise<AttackPathGraph> => {
      const raw = await get(tenantPath(tenantId, `/attack-path/simulations/${encodeURIComponent(simulationId)}/graph?mode=collapsed`));
      return attackPathGraphSchema.parse(raw);
    },

    /** Every asset group of the tenant, with its static members and its dynamic members as resolved now. */
    listAssetGroups: async (tenantId: string): Promise<Array<OpenaevAssetGroup>> => {
      const raw = await get(tenantPath(tenantId, '/asset_groups'));
      return openaevAssetGroupSchema.array().parse(raw);
    },
  };
};
