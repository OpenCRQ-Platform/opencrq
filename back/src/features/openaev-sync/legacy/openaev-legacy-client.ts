import type { ExerciseOutput, InjectExpectationOutput, InjectResponse, OpenaevPage, ScenarioOutput } from './openaev-legacy-types';
import { createOpenaevTransport, OpenaevNotFoundError, SNAPSHOT_STATUS_MESSAGES } from '../openaev-api-client';
import { openaevPageSchema } from '../openaev-types';
import {
  exerciseOutputSchema,
  exerciseSimpleSchema,
  injectExpectationOutputSchema,
  injectSchema,
  relatedFindingOutputSchema,
  scenarioOutputSchema,
} from './openaev-legacy-types';

const MAX_PAGES = 1_000;

// `finding_type` is compared to the enum CONSTANT NAME stored in the column (`Finding.type` is
// `@Enumerated(EnumType.STRING)`), case-insensitively, and not to the lowercase JSON value the API
// serializes back. `'cve'` works only because it differs from `CVE` by case alone; `'portscan'`
// matches nothing where `'PortsScan'` matches. The constant name is the one form right for every type.
const FINDING_TYPE = { cve: 'CVE', vulnerability: 'Vulnerability' } as const;

/** Whether an OpenAEV instance serves the snapshot routes (`BULK_SNAPSHOT_EXPORT` on). */
export type SnapshotSupport = 'available' | 'unavailable';

/**
 * Hands each page's items newer than `watermark` to `onPage` and keeps none of them, stopping at the
 * first entry at or before it: the search is sorted DESC on the field `getUpdatedAt` reads, so
 * everything after that entry is older too. A `null` watermark walks every page. An entry with no
 * date is never older than the watermark.
 */
export const streamUntilWatermark = async <T>(
  fetchPage: (page: number) => Promise<{ content: Array<T>, last: boolean }>,
  getUpdatedAt: (item: T) => string | null | undefined,
  watermark: Date | null,
  signal: AbortSignal,
  onPage: (items: Array<T>) => void,
  onMaxPagesReached?: (pages: number) => void,
): Promise<void> => {
  let page = 0;
  while (!signal.aborted && page < MAX_PAGES) {
    const result = await fetchPage(page);
    if (result.content.length === 0) {
      break;
    }
    const items: Array<T> = [];
    let reachedWatermark = false;
    for (const item of result.content) {
      const updatedAt = getUpdatedAt(item);
      if (watermark && updatedAt && new Date(updatedAt) <= watermark) {
        reachedWatermark = true;
        break;
      }
      items.push(item);
    }
    onPage(items);
    if (result.last || reachedWatermark) {
      break;
    }
    page++;
  }
  if (!signal.aborted && page >= MAX_PAGES) {
    onMaxPagesReached?.(MAX_PAGES);
  }
};

/** `streamUntilWatermark` for a caller small enough to hold the whole result. */
export const paginateUntilWatermark = async <T>(
  fetchPage: (page: number) => Promise<{ content: Array<T>, last: boolean }>,
  getUpdatedAt: (item: T) => string | null | undefined,
  watermark: Date | null,
  signal: AbortSignal,
  onMaxPagesReached?: (pages: number) => void,
): Promise<Array<T>> => {
  const items: Array<T> = [];
  await streamUntilWatermark(fetchPage, getUpdatedAt, watermark, signal, (page) => items.push(...page), onMaxPagesReached);
  return items;
};

/** The calls of the exercise loop and the CVE findings search, for an OpenAEV that serves no snapshot route. */
export const createOpenaevLegacyClient = (baseUrl: string, token: string, signal: AbortSignal) => {
  const { get, post, tenantPath } = createOpenaevTransport(baseUrl, token, signal);

  return {
    /**
     * Asks the attack snapshot route of one OpenAEV tenant for a single observation, which costs one
     * read-only query. 404 is `unavailable`, any 2xx `available`; 403 throws a `NonRetryableError`
     * naming the missing `ACCESS_SNAPSHOT_OBSERVATION` capability, and any other failure is the
     * ordinary one of a call (retried when it is transient).
     */
    probeSnapshotExport: async (tenantId: string): Promise<SnapshotSupport> => {
      try {
        await post(tenantPath(tenantId, '/snapshot/attack-observations/search'), { page_size: 1 }, { 403: SNAPSHOT_STATUS_MESSAGES[403] });
        return 'available';
      } catch (err) {
        if (err instanceof OpenaevNotFoundError) {
          return 'unavailable';
        }
        throw err;
      }
    },

    // The OpenAEV API does not document a filterable exercise_updated_at field, so the watermark is
    // applied client-side: sorted DESC, the walk stops at the first entry older than it.
    // The filter engine requires each filter object to carry a unique string `id`.
    searchExercises: async (tenantId: string, page: number): Promise<OpenaevPage<typeof exerciseSimpleSchema>> => {
      const raw = await post(tenantPath(tenantId, '/exercises/search'), {
        page,
        size: 100,
        filterGroup: {
          mode: 'and',
          filters: [{ id: '1', key: 'exercise_status', operator: 'eq', mode: 'and', values: ['FINISHED'] }],
        },
        sorts: [{ property: 'exercise_updated_at', direction: 'desc' }],
      });
      return openaevPageSchema(exerciseSimpleSchema).parse(raw);
    },

    getExerciseExpectations: async (tenantId: string, exerciseId: string): Promise<Array<InjectExpectationOutput>> => {
      const raw = await get(tenantPath(tenantId, `/exercises/${exerciseId}/expectations`));
      return injectExpectationOutputSchema.array().parse(raw);
    },

    getExercise: async (tenantId: string, exerciseId: string): Promise<ExerciseOutput> => {
      const raw = await get(tenantPath(tenantId, `/exercises/${exerciseId}`));
      return exerciseOutputSchema.parse(raw);
    },

    getScenario: async (tenantId: string, scenarioId: string): Promise<ScenarioOutput> => {
      const raw = await get(tenantPath(tenantId, `/scenarios/${scenarioId}`));
      return scenarioOutputSchema.parse(raw);
    },

    getInject: async (tenantId: string, injectId: string): Promise<InjectResponse> => {
      const raw = await get(tenantPath(tenantId, `/injects/${injectId}`));
      return injectSchema.parse(raw);
    },

    // Tenant-wide, not per exercise: the exercise route can't see a finding whose inject has no
    // exercise (an atomic test) or whose exercise the exercise list doesn't surface. Coverage, not
    // a call-count optimization.
    searchFindings: async (tenantId: string, page: number): Promise<OpenaevPage<typeof relatedFindingOutputSchema>> => {
      const raw = await post(tenantPath(tenantId, '/findings/search'), {
        page,
        size: 100,
        filterGroup: {
          mode: 'and',
          filters: [{ id: '1', key: 'finding_type', operator: 'eq', mode: 'or', values: [FINDING_TYPE.cve, FINDING_TYPE.vulnerability] }],
        },
        sorts: [{ property: 'finding_updated_at', direction: 'desc' }],
      });
      return openaevPageSchema(relatedFindingOutputSchema).parse(raw);
    },
  };
};

export type OpenaevLegacyClient = ReturnType<typeof createOpenaevLegacyClient>;
