import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NonRetryableError } from '@app/module';
import { OpenaevNotFoundError } from '../openaev-api-client';
import { createOpenaevLegacyClient, paginateUntilWatermark, streamUntilWatermark } from './openaev-legacy-client';

vi.mock('../../../utils/logger', () => ({
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

describe('createOpenaevLegacyClient', () => {
  const client = () => createOpenaevLegacyClient('https://openaev.example.com', 'token', new AbortController().signal);

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('probeSnapshotExport', () => {
    const snapshotPage = { observations: [], next_cursor: null, has_more: false, snapshot_ready: true };

    it('asks the attack stream of the tenant for one observation, with no cursor', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(snapshotPage));

      await client().probeSnapshotExport('tenant-1');

      const call = vi.mocked(fetch).mock.calls[0];
      expect(call[0]).toBe('https://openaev.example.com/api/tenants/tenant-1/snapshot/attack-observations/search');
      expect(call[1]).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer token' } });
      expect(requestBodyOf(call[1])).toEqual({ page_size: 1 });
    });

    it('is available when the route answers', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(snapshotPage));

      await expect(client().probeSnapshotExport('tenant-1')).resolves.toBe('available');
    });

    it('does not read the body of an answer, whatever it holds', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ unexpected: true }));

      await expect(client().probeSnapshotExport('tenant-1')).resolves.toBe('available');
    });

    it('is unavailable on a 404, the status OpenAEV answers while BULK_SNAPSHOT_EXPORT is off', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 404 }));

      await expect(client().probeSnapshotExport('tenant-1')).resolves.toBe('unavailable');
    });

    it('fails as non-retryable, naming ACCESS_SNAPSHOT_OBSERVATION, on a 403', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(new Response('Forbidden', { status: 403 }));

      const failure = await client().probeSnapshotExport('tenant-1').catch((err: unknown) => err);

      expect(failure).toBeInstanceOf(NonRetryableError);
      expect(failure).toHaveProperty('message', expect.stringContaining('ACCESS_SNAPSHOT_OBSERVATION'));
    });

    it('fails as non-retryable on a 401, with the generic message', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

      const failure = await client().probeSnapshotExport('tenant-1').catch((err: unknown) => err);

      expect(failure).toBeInstanceOf(NonRetryableError);
      expect(failure).toHaveProperty('message', expect.not.stringContaining('ACCESS_SNAPSHOT_OBSERVATION'));
    });

    it('lets a server error through as an ordinary, retried failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(new Response('boom', { status: 500 }));

      const failure = await client().probeSnapshotExport('tenant-1').catch((err: unknown) => err);

      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBeInstanceOf(NonRetryableError);
    });
  });

  describe('exercise calls', () => {
    it('searchExercises asks for the FINISHED exercises, newest first', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ...emptyPage, content: [{ exercise_id: 'ex-1', exercise_status: 'FINISHED' }] }));

      const page = await client().searchExercises('tenant-1', 2);

      const call = vi.mocked(fetch).mock.calls[0];
      expect(call[0]).toBe('https://openaev.example.com/api/tenants/tenant-1/exercises/search');
      expect(requestBodyOf(call[1])).toEqual({
        page: 2,
        size: 100,
        filterGroup: { mode: 'and', filters: [{ id: '1', key: 'exercise_status', operator: 'eq', mode: 'and', values: ['FINISHED'] }] },
        sorts: [{ property: 'exercise_updated_at', direction: 'desc' }],
      });
      expect(page.content[0]).toMatchObject({ exercise_id: 'ex-1' });
    });

    it('getExerciseExpectations, getExercise, getScenario and getInject read their own resource', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse([{ inject_expectation_id: 'exp-1', inject_expectation_type: 'DETECTION' }]))
        .mockResolvedValueOnce(jsonResponse({ exercise_id: 'ex-1', exercise_scenario: 'scn-1' }))
        .mockResolvedValueOnce(jsonResponse({ scenario_id: 'scn-1', scenario_name: 'Credential Harvesting' }))
        .mockResolvedValueOnce(jsonResponse({ inject_id: 'inject-1', inject_title: 'Dump LSASS', inject_attack_patterns: [{ attack_pattern_id: 'ap-1', attack_pattern_external_id: 'T1003' }] }));

      const expectations = await client().getExerciseExpectations('tenant-1', 'ex-1');
      const exercise = await client().getExercise('tenant-1', 'ex-1');
      const scenario = await client().getScenario('tenant-1', 'scn-1');
      const inject = await client().getInject('tenant-1', 'inject-1');

      expect(vi.mocked(fetch).mock.calls.map(([url, init]) => [init?.method, url])).toEqual([
        ['GET', 'https://openaev.example.com/api/tenants/tenant-1/exercises/ex-1/expectations'],
        ['GET', 'https://openaev.example.com/api/tenants/tenant-1/exercises/ex-1'],
        ['GET', 'https://openaev.example.com/api/tenants/tenant-1/scenarios/scn-1'],
        ['GET', 'https://openaev.example.com/api/tenants/tenant-1/injects/inject-1'],
      ]);
      expect(expectations[0]).toMatchObject({ inject_expectation_id: 'exp-1', inject_expectation_results: [] });
      expect(exercise.exercise_scenario).toBe('scn-1');
      expect(scenario.scenario_name).toBe('Credential Harvesting');
      expect(inject.inject_attack_patterns[0]).toMatchObject({ attack_pattern_external_id: 'T1003' });
    });

    it('maps a 404 to OpenaevNotFoundError, which the run skips a resource on', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 404 }));

      await expect(client().getExercise('tenant-1', 'ex-gone')).rejects.toBeInstanceOf(OpenaevNotFoundError);
    });
  });

  describe('findings calls', () => {
    it('searchFindings posts to /findings/search with both finding types, or-ed, sorted DESC', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(emptyPage));

      await client().searchFindings('tenant-1', 0);

      const call = vi.mocked(fetch).mock.calls[0];
      expect(call[0]).toBe('https://openaev.example.com/api/tenants/tenant-1/findings/search');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- shape asserted by the expectations below
      const body = requestBodyOf(call[1]) as { filterGroup: { filters: Array<{ key: string, mode: string, values: Array<string> }> }, sorts: Array<{ property: string, direction: string }> };
      expect(body.filterGroup.filters).toEqual([{ id: '1', key: 'finding_type', operator: 'eq', mode: 'or', values: ['CVE', 'Vulnerability'] }]);
      expect(body.sorts).toEqual([{ property: 'finding_updated_at', direction: 'desc' }]);
    });

    it('searchFindings parses a finding carrying finding_simulation', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
        ...emptyPage,
        content: [{
          finding_id: 'finding-1',
          // The response serializes the JSON value, lowercase, whatever the filter was sent as.
          // Verified on a live instance: a finding filtered on 'CVE' comes back as 'cve'.
          finding_type: 'cve',
          finding_value: 'CVE-2024-1234',
          finding_assets: [{ asset_id: 'asset-1' }],
          finding_simulation: { exercise_id: 'exercise-1', exercise_name: 'Q1 exercise' },
        }],
      }));

      const page = await client().searchFindings('tenant-1', 0);

      expect(page.content[0].finding_simulation).toEqual({ exercise_id: 'exercise-1', exercise_name: 'Q1 exercise' });
    });
  });
});

describe('streamUntilWatermark', () => {
  const dated = (id: string, updatedAt: string | null) => ({ id, updatedAt });
  const pagesOf = (...pages: Array<Array<ReturnType<typeof dated>>>) => (page: number) =>
    Promise.resolve({ content: pages[page] ?? [], last: page >= pages.length - 1 });
  const updatedAtOf = (item: ReturnType<typeof dated>) => item.updatedAt;
  const watermark = new Date('2026-01-05T00:00:00Z');

  it('hands over each page without keeping it, and stops after the last one', async () => {
    const fetchPage = vi.fn(pagesOf(
      [dated('a', '2026-01-09T00:00:00Z'), dated('b', '2026-01-08T00:00:00Z')],
      [dated('c', '2026-01-07T00:00:00Z')],
    ));
    const onPage = vi.fn();

    await streamUntilWatermark(fetchPage, updatedAtOf, watermark, new AbortController().signal, onPage);

    expect(onPage.mock.calls.map(([items]) => items.map((item: { id: string }) => item.id))).toEqual([['a', 'b'], ['c']]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('stops at the first entry at or before the watermark, and keeps only what is newer on that page', async () => {
    const fetchPage = vi.fn(pagesOf(
      [dated('new', '2026-01-09T00:00:00Z'), dated('boundary', '2026-01-05T00:00:00Z'), dated('older', '2026-01-01T00:00:00Z')],
      [dated('never-read', '2025-12-01T00:00:00Z')],
    ));
    const onPage = vi.fn();

    await streamUntilWatermark(fetchPage, updatedAtOf, watermark, new AbortController().signal, onPage);

    expect(onPage).toHaveBeenCalledOnce();
    expect(onPage.mock.calls[0][0]).toEqual([dated('new', '2026-01-09T00:00:00Z')]);
    expect(fetchPage).toHaveBeenCalledOnce();
  });

  it('keeps an entry that carries no date, since it cannot be told older', async () => {
    const onPage = vi.fn();

    await streamUntilWatermark(pagesOf([dated('undated', null)]), updatedAtOf, watermark, new AbortController().signal, onPage);

    expect(onPage.mock.calls[0][0]).toEqual([dated('undated', null)]);
  });

  it('walks every page when the watermark is null', async () => {
    const fetchPage = vi.fn(pagesOf([dated('a', '2020-01-01T00:00:00Z')], [dated('b', '2019-01-01T00:00:00Z')]));
    const onPage = vi.fn();

    await streamUntilWatermark(fetchPage, updatedAtOf, null, new AbortController().signal, onPage);

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(onPage).toHaveBeenCalledTimes(2);
  });

  it('stops on an empty page', async () => {
    const fetchPage = vi.fn().mockResolvedValue({ content: [], last: false });
    const onPage = vi.fn();

    await streamUntilWatermark(fetchPage, updatedAtOf, null, new AbortController().signal, onPage);

    expect(fetchPage).toHaveBeenCalledOnce();
    expect(onPage).not.toHaveBeenCalled();
  });

  it('reads no page once aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchPage = vi.fn(pagesOf([dated('a', '2026-01-09T00:00:00Z')]));

    await streamUntilWatermark(fetchPage, updatedAtOf, watermark, controller.signal, vi.fn());

    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('reports a walk cut short by the page cap', async () => {
    const fetchPage = vi.fn().mockResolvedValue({ content: [dated('a', '2026-01-09T00:00:00Z')], last: false });
    const onMaxPagesReached = vi.fn();

    await streamUntilWatermark(fetchPage, updatedAtOf, null, new AbortController().signal, vi.fn(), onMaxPagesReached);

    expect(fetchPage).toHaveBeenCalledTimes(1_000);
    expect(onMaxPagesReached).toHaveBeenCalledWith(1_000);
  });
});

describe('paginateUntilWatermark', () => {
  it('returns the newer entries of every page it read, in the order received', async () => {
    const pages = [
      [{ id: 'a', updatedAt: '2026-01-09T00:00:00Z' }],
      [{ id: 'b', updatedAt: '2026-01-08T00:00:00Z' }, { id: 'old', updatedAt: '2026-01-01T00:00:00Z' }],
    ];

    const items = await paginateUntilWatermark(
      (page) => Promise.resolve({ content: pages[page] ?? [], last: page >= pages.length - 1 }),
      (item) => item.updatedAt,
      new Date('2026-01-05T00:00:00Z'),
      new AbortController().signal,
    );

    expect(items.map((item) => item.id)).toEqual(['a', 'b']);
  });
});
