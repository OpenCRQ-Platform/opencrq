import { NonRetryableError, TimeoutError } from '@app/module';
import type { DrataControlOutput, DrataFrameworkOutput, DrataRequirementOutput } from './drata-types';
import { fromError, newError } from '@app/utils';
import { drataControlSchema, drataFrameworkSchema, drataPageSchema, drataRequirementSchema } from './drata-types';

const FETCH_TIMEOUT_MS = 120_000;
const MAX_PAGES = 1_000;
const PAGE_SIZE = 200;

const fetchJson = async (url: string, options: RequestInit, signal: AbortSignal): Promise<unknown> => {
  const fetchSignal = AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]);
  let res: Response;
  try {
    res = await fetch(url, { ...options, signal: fetchSignal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new TimeoutError(`Drata fetch timed out after ${FETCH_TIMEOUT_MS}ms`, { cause: err });
    }
    throw err;
  }

  if (res.status === 401 || res.status === 403) {
    const body = await res.text();
    throw new NonRetryableError(`Drata auth error (${res.status}): ${body.slice(0, 200)}`);
  }
  if (res.status >= 400 && res.status < 500 && res.status !== 429) {
    const body = await res.text();
    throw new NonRetryableError(`Drata request error (${res.status}): ${body.slice(0, 200)}`);
  }
  if (!res.ok) {
    const body = await res.text();
    throw newError(`Drata error (${res.status}): ${body.slice(0, 200)}`);
  }

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (err) {
    throw fromError(err, `Drata non-JSON response: ${text.slice(0, 200)}`);
  }
};

export const createDrataClient = (baseUrl: string, apiKey: string, workspaceId: number, signal: AbortSignal) => {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  const buildUrl = (path: string, params: Record<string, string | Array<string>>): string => {
    const url = new URL(`/public/v2/workspaces/${workspaceId}${path}`, baseUrl);
    for (const [key, value] of Object.entries(params)) {
      for (const entry of Array.isArray(value) ? value : [value]) {
        url.searchParams.append(key, entry);
      }
    }
    return url.toString();
  };

  const paginate = async <T>(
    path: string,
    params: Record<string, string | Array<string>>,
    itemSchema: Parameters<typeof drataPageSchema>[0],
  ): Promise<Array<T>> => {
    const items: Array<T> = [];
    let cursor: string | null = null;
    let pages = 0;
    while (!signal.aborted && pages < MAX_PAGES) {
      const pageParams: Record<string, string | Array<string>> = { ...params, size: String(PAGE_SIZE) };
      if (cursor) {
        pageParams.cursor = cursor;
      }
      const raw = await fetchJson(buildUrl(path, pageParams), { method: 'GET', headers }, signal);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- drataPageSchema(itemSchema) validates the rows; the generic parameter only restores the item type erased by the schema indirection
      const page = drataPageSchema(itemSchema).parse(raw) as { data: Array<T>, pagination?: { cursor?: string | null } | null };
      items.push(...page.data);
      cursor = page.pagination?.cursor ?? null;
      if (!cursor || page.data.length === 0) {
        break;
      }
      pages++;
    }
    if (!signal.aborted && pages >= MAX_PAGES) {
      throw newError(`Drata pagination exceeded ${MAX_PAGES} pages for ${path}`);
    }
    return items;
  };

  return {
    listFrameworks: (): Promise<Array<DrataFrameworkOutput>> =>
      paginate('/frameworks', {}, drataFrameworkSchema),

    listFrameworkRequirements: (
      frameworkDrataId: number,
      filters?: { isInScope?: boolean, isReady?: boolean },
    ): Promise<Array<DrataRequirementOutput>> => {
      const params: Record<string, string> = {};
      if (filters?.isInScope !== undefined) {
        params.isInScope = String(filters.isInScope);
      }
      if (filters?.isReady !== undefined) {
        params.isReady = String(filters.isReady);
      }
      return paginate(`/frameworks/${frameworkDrataId}/requirements`, params, drataRequirementSchema);
    },

    listControls: (): Promise<Array<DrataControlOutput>> =>
      paginate('/controls', { 'expand[]': ['flags', 'requirements'] }, drataControlSchema),
  };
};
