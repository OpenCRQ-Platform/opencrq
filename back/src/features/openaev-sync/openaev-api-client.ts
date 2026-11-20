import { NonRetryableError, TimeoutError } from '@app/module';
import type { AiTargetAsset, AssetInventoryRow, AssetOverview, AttackObservation, EndpointEntity, OpenaevAssetGroup, OpenaevTag, OpenaevUser, SnapshotPage, TenantOutput, VulnerabilityObservation } from './openaev-types';
import { fromError, newError, StructuredError } from '@app/utils';
import { createLogger } from '../../utils/logger';
import {
  aiTargetAssetSchema,
  assetInventoryRowSchema,
  assetOverviewSchema,
  attackObservationSchema,
  endpointEntitySchema,
  esSeriesSchema,
  openaevAssetGroupSchema,
  openaevPageSchema,
  openaevTagSchema,
  openaevUserSchema,
  snapshotSearchOutputSchema,
  tenantOutputSchema,
  vulnerabilityObservationSchema,
} from './openaev-types';
import { parsePostureSeries } from './openaev-mapping-utils';

const { logFromError } = createLogger({ feature: 'openaev-sync' });

const FETCH_TIMEOUT_MS = 120_000;
const MAX_PAGES = 1_000;
/** Ids per `/dashboards/adhoc/series` call — the posture call is not a stable public API, so a batch is kept small and its own failure isolated (see `fetchPostureCounters`). */
const POSTURE_BATCH_SIZE = 100;
/** OpenAEV's maximum `page_size` for the snapshot streams. */
const SNAPSHOT_PAGE_SIZE = 1_000;

/** Replaces the generic message of a status that means something specific on one route. */
type StatusMessages = Partial<Record<number, string>>;

export const SNAPSHOT_STATUS_MESSAGES: StatusMessages = {
  403: 'OpenAEV refused the snapshot request: the account lacks the ACCESS_SNAPSHOT_OBSERVATION capability',
  404: 'OpenAEV snapshot route not found: the BULK_SNAPSHOT_EXPORT preview feature is off on this OpenAEV instance',
};

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
  if (res.status === 401 || res.status === 403) {
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

const postureFilter = (id: string, key: string, values: Array<string>) => ({
  id, key, mode: 'or' as const, values, operator: 'eq' as const,
});

/**
 * Replays the widget config OpenAEV's own `usePostureScores.ts` builds for the asset posture
 * gauge: one `structural-histogram`, two series (`SUCCESS`/`FAILED`) each scoped to
 * `base_entity = expectation-inject` and the batch's asset ids on `base_asset_side`, over
 * `ALL_TIME`. Not a stable public API — replicated rather than referenced.
 */
const buildPostureWidgetConfig = (assetIds: Array<string>) => ({
  title: '',
  field: 'base_asset_side',
  series: ['SUCCESS', 'FAILED'].map((status) => ({
    name: status,
    filter: {
      mode: 'and',
      filters: [
        postureFilter('1', 'base_entity', ['expectation-inject']),
        postureFilter('2', 'base_asset_side', assetIds),
        postureFilter('3', 'inject_expectation_status', [status]),
      ],
    },
  })),
  mode: 'structural',
  stacked: false,
  limit: Math.max(assetIds.length, 10),
  widget_configuration_type: 'structural-histogram',
  time_range: 'ALL_TIME',
  date_attribute: 'base_created_at',
});

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

    /** Every asset group of the tenant, with its static members and its dynamic members as resolved now. */
    listAssetGroups: async (tenantId: string): Promise<Array<OpenaevAssetGroup>> => {
      const raw = await get(tenantPath(tenantId, '/asset_groups'));
      return openaevAssetGroupSchema.array().parse(raw);
    },

    /**
     * Posture counters for a batch of assets, read from OpenAEV's dashboard engine — the one call
     * that is not a stable public API. Ids are chunked (`POSTURE_BATCH_SIZE`) and a chunk's failure
     * is logged and skipped rather than thrown: an OpenAEV instance without the dashboard engine
     * gives no entry for that chunk's ids in the returned map instead of an error.
     */
    fetchPostureCounters: async (
      tenantId: string,
      assetIds: Array<string>,
    ): Promise<Map<string, { success: number, failed: number }>> => {
      const counters = new Map<string, { success: number, failed: number }>();
      for (let i = 0; i < assetIds.length; i += POSTURE_BATCH_SIZE) {
        // The catch below is deliberately total, so an abort has to be read before it: otherwise a
        // cancelled run keeps firing — and logging — every remaining batch.
        if (signal.aborted) {
          return counters;
        }
        const batch = assetIds.slice(i, i + POSTURE_BATCH_SIZE);
        try {
          const raw = await post(tenantPath(tenantId, '/dashboards/adhoc/series'), {
            widget_config: buildPostureWidgetConfig(batch),
          });
          const series = esSeriesSchema.array().parse(raw);
          for (const [assetId, entry] of parsePostureSeries(series)) {
            counters.set(assetId, entry);
          }
        } catch (err) {
          logFromError(err, 'OpenAEV posture batch failed — no posture counters for these assets', { tenantId, batchSize: batch.length });
        }
      }
      return counters;
    },
  };
};
