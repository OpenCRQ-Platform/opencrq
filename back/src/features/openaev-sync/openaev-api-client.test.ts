import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NonRetryableError } from '@app/module';
import { createOpenaevClient, OpenaevNotFoundError, paginateAll } from './openaev-api-client';

vi.mock('../../utils/logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    logFromError: vi.fn(),
    logTrace: vi.fn(),
    logError: vi.fn(),
    logTraceFromError: vi.fn(),
    logFatalError: vi.fn(),
    logFromFatalError: vi.fn(),
    enrich: vi.fn(),
  }),
}));

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const emptyPage = { content: [], totalElements: 0, totalPages: 0, number: 0, size: 100, last: true };

/** Every call this client makes sends a JSON string body — the one place that assertion is made, for every test below. */
const requestBodyOf = (init: RequestInit | undefined): unknown =>
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- this suite only ever sends a JSON string body
  JSON.parse(init?.body as string);

describe('createOpenaevClient — inventory calls', () => {
  const client = () => createOpenaevClient('https://openaev.example.com', 'token', new AbortController().signal);

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('searchAssets posts to /assets/search and parses the page', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      ...emptyPage,
      content: [{ asset_id: 'asset-1', asset_category: 'ai_target' }],
    }));

    const page = await client().searchAssets('tenant-1', 0);

    expect(page.content).toEqual([{ asset_id: 'asset-1', asset_category: 'ai_target' }]);
    const call = vi.mocked(fetch).mock.calls[0];
    expect(call[0]).toBe('https://openaev.example.com/api/tenants/tenant-1/assets/search');
    expect(requestBodyOf(call[1])).toEqual({ page: 0, size: 100 });
  });

  it('findListedAssetIds filters /assets/search on the asset ids and returns those it lists', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      ...emptyPage,
      content: [{ asset_id: 'asset-1' }],
    }));

    const listed = await client().findListedAssetIds('tenant-1', ['asset-1', 'asset-2']);

    expect(listed).toEqual(new Set(['asset-1']));
    const call = vi.mocked(fetch).mock.calls[0];
    expect(call[0]).toBe('https://openaev.example.com/api/tenants/tenant-1/assets/search');
    expect(requestBodyOf(call[1])).toEqual({
      page: 0,
      size: 2,
      filterGroup: { mode: 'and', filters: [{ id: '0', key: 'asset_id', mode: 'or', values: ['asset-1', 'asset-2'], operator: 'eq' }] },
    });
  });

  it('findEndpoints posts a bare id array to /endpoints/find and parses the raw entities', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse([
      { asset_id: 'asset-1', asset_hostname: 'srv01', asset_ips: ['10.0.0.5'] },
    ]));

    const endpoints = await client().findEndpoints('tenant-1', ['asset-1']);

    expect(endpoints).toEqual([{ asset_id: 'asset-1', asset_hostname: 'srv01', asset_ips: ['10.0.0.5'] }]);
    const call = vi.mocked(fetch).mock.calls[0];
    expect(call[0]).toBe('https://openaev.example.com/api/tenants/tenant-1/endpoints/find');
    expect(requestBodyOf(call[1])).toEqual(['asset-1']);
  });

  it('searchAiTargets posts to /ai_targets/search and parses the page', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      ...emptyPage,
      content: [{ asset_id: 'ai-1', ai_target_provider: 'ANTHROPIC' }],
    }));

    const page = await client().searchAiTargets('tenant-1', 0);

    expect(page.content).toEqual([{ asset_id: 'ai-1', ai_target_provider: 'ANTHROPIC' }]);
    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('https://openaev.example.com/api/tenants/tenant-1/ai_targets/search');
  });

  it('listTags gets the unpaginated /tags list', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse([{ tag_id: 'tag-1', tag_name: 'critical', tag_color: '#ff0000' }]));

    const tags = await client().listTags('tenant-1');

    expect(tags).toEqual([{ tag_id: 'tag-1', tag_name: 'critical', tag_color: '#ff0000' }]);
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('https://openaev.example.com/api/tenants/tenant-1/tags');
    expect(options?.method).toBe('GET');
  });

  describe('fetchPostureCounters', () => {
    it('maps the SUCCESS/FAILED series to per-asset counts', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse([
        { label: 'SUCCESS', data: [{ key: 'asset-1', value: 3 }] },
        { label: 'FAILED', data: [{ key: 'asset-1', value: 1 }] },
      ]));

      const counters = await client().fetchPostureCounters('tenant-1', ['asset-1']);

      expect(counters.get('asset-1')).toEqual({ success: 3, failed: 1 });
      const call = vi.mocked(fetch).mock.calls[0];
      expect(call[0]).toBe('https://openaev.example.com/api/tenants/tenant-1/dashboards/adhoc/series');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- shape asserted by the expectations below
      const body = requestBodyOf(call[1]) as { widget_config: { field: string, series: Array<{ name: string }> } };
      expect(body.widget_config.field).toBe('base_asset_side');
      expect(body.widget_config.series.map((s) => s.name)).toEqual(['SUCCESS', 'FAILED']);
    });

    it('splits more than 100 ids into separate batched calls', async () => {
      const ids = Array.from({ length: 150 }, (_, i) => `asset-${i}`);
      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse([{ label: 'SUCCESS', data: [] }, { label: 'FAILED', data: [] }]))
        .mockResolvedValueOnce(jsonResponse([{ label: 'SUCCESS', data: [] }, { label: 'FAILED', data: [] }]));

      await client().fetchPostureCounters('tenant-1', ids);

      expect(fetch).toHaveBeenCalledTimes(2);
      type WidgetBody = { widget_config: { series: Array<{ filter: { filters: Array<{ values: Array<string> }> } }> } };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- shape asserted by the expectations below
      const firstBody = requestBodyOf(vi.mocked(fetch).mock.calls[0][1]) as WidgetBody;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- shape asserted by the expectations below
      const secondBody = requestBodyOf(vi.mocked(fetch).mock.calls[1][1]) as WidgetBody;
      expect(firstBody.widget_config.series[0].filter.filters[1].values).toHaveLength(100);
      expect(secondBody.widget_config.series[0].filter.filters[1].values).toHaveLength(50);
    });

    it('does not throw when a batch fails — leaves that batch out of the returned map', async () => {
      const ids = Array.from({ length: 150 }, (_, i) => `asset-${i}`);
      vi.mocked(fetch)
        .mockResolvedValueOnce(new Response('boom', { status: 500 }))
        .mockResolvedValueOnce(jsonResponse([
          { label: 'SUCCESS', data: [{ key: 'asset-149', value: 2 }] },
          { label: 'FAILED', data: [] },
        ]));

      const counters = await client().fetchPostureCounters('tenant-1', ids);

      expect(counters.get('asset-0')).toBeUndefined();
      expect(counters.get('asset-149')).toEqual({ success: 2, failed: 0 });
    });

    it('returns an empty map without calling fetch when there are no ids', async () => {
      const counters = await client().fetchPostureCounters('tenant-1', []);
      expect(counters.size).toBe(0);
      expect(fetch).not.toHaveBeenCalled();
    });
  });
});

describe('createOpenaevClient — snapshot calls', () => {
  const client = () => createOpenaevClient('https://openaev.example.com', 'token', new AbortController().signal);

  const snapshotPage = {
    observations: [],
    next_cursor: 'cursor-2',
    has_more: false,
    snapshot_window_end: '2026-10-05T10:00:00Z',
    indexed_through: '2026-10-05T10:00:01Z',
    server_time: '2026-10-05T10:02:00Z',
    consistency_mode: 'eventual',
    snapshot_ready: true,
  };

  const streams = [
    { method: 'searchAttackObservations', path: 'attack-observations' },
    { method: 'searchVulnerabilityObservations', path: 'vulnerability-observations' },
  ] as const;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe.each(streams)('$method', ({ method, path }) => {
    it('posts page_size 1000 without a cursor when starting a full walk, and never sends since', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(snapshotPage));

      await client()[method]('tenant-1', { cursor: null });

      const [url, init] = vi.mocked(fetch).mock.calls[0];
      expect(url).toBe(`https://openaev.example.com/api/tenants/tenant-1/snapshot/${path}/search`);
      expect(init?.method).toBe('POST');
      expect(requestBodyOf(init)).toEqual({ page_size: 1000 });
    });

    it('resumes with the given cursor', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(snapshotPage));

      await client()[method]('tenant-1', { cursor: 'cursor-1' });

      expect(requestBodyOf(vi.mocked(fetch).mock.calls[0][1])).toEqual({ cursor: 'cursor-1', page_size: 1000 });
    });

    it('parses the page envelope', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(snapshotPage));

      const page = await client()[method]('tenant-1', { cursor: 'cursor-1' });

      expect(page).toMatchObject({ observations: [], next_cursor: 'cursor-2', has_more: false, snapshot_ready: true });
    });

    it('fails as non-retryable, naming BULK_SNAPSHOT_EXPORT, on a 404', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 404 }));

      const failure = await client()[method]('tenant-1', { cursor: null }).catch((err: unknown) => err);

      expect(failure).toBeInstanceOf(NonRetryableError);
      expect(failure).not.toBeInstanceOf(OpenaevNotFoundError);
      expect(failure).toHaveProperty('message', expect.stringContaining('BULK_SNAPSHOT_EXPORT'));
    });

    it('fails as non-retryable, naming ACCESS_SNAPSHOT_OBSERVATION, on a 403', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(new Response('Forbidden', { status: 403 }));

      const failure = await client()[method]('tenant-1', { cursor: null }).catch((err: unknown) => err);

      expect(failure).toBeInstanceOf(NonRetryableError);
      expect(failure).toHaveProperty('message', expect.stringContaining('ACCESS_SNAPSHOT_OBSERVATION'));
    });

    it('keeps the generic message on a 401', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

      const failure = await client()[method]('tenant-1', { cursor: null }).catch((err: unknown) => err);

      expect(failure).toBeInstanceOf(NonRetryableError);
      expect(failure).toHaveProperty('message', expect.not.stringContaining('ACCESS_SNAPSHOT_OBSERVATION'));
    });
  });

  it('leaves the 404 mapping of the other calls untouched', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 404 }));

    await expect(client().getAssetOverview('tenant-1', 'asset-1')).rejects.toBeInstanceOf(OpenaevNotFoundError);
  });
});

describe('paginateAll', () => {
  const page = (content: Array<string>, totalElements: number, last: boolean) => ({ content, totalElements, last });
  const signal = () => new AbortController().signal;

  it('reads every page and reports the total they all agreed on', async () => {
    const pages = [page(['a', 'b'], 3, false), page(['c'], 3, true)];

    expect(await paginateAll((index) => Promise.resolve(pages[index]), signal())).toEqual({ items: ['a', 'b', 'c'], totalElements: 3 });
  });

  it('reports no total when two pages disagreed on it', async () => {
    const pages = [page(['a', 'b'], 3, false), page(['d'], 2, true)];

    expect(await paginateAll((index) => Promise.resolve(pages[index]), signal())).toEqual({ items: ['a', 'b', 'd'], totalElements: null });
  });

  it('counts the total of the empty page that ends the read', async () => {
    const pages = [page(['a', 'b'], 3, false), page([], 2, false)];

    expect(await paginateAll((index) => Promise.resolve(pages[index]), signal())).toEqual({ items: ['a', 'b'], totalElements: null });
  });
});
