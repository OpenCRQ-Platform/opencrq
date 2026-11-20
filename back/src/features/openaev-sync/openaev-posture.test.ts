import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readAssetPosture } from './openaev-posture';

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

const APP_TENANT = '01990000-0000-7000-8000-000000000001';
const connections = { [APP_TENANT]: { url: 'https://openaev.example.com', token: 'token' } };

const target = (sourceAssetId: string, openaevTenantId = 'oa-1') => ({ tenantId: APP_TENANT, openaevTenantId, sourceAssetId });

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const series = (counts: Record<string, { success: number, failed: number }>) => [
  { label: 'SUCCESS', data: Object.entries(counts).map(([key, { success }]) => ({ key, value: success })) },
  { label: 'FAILED', data: Object.entries(counts).map(([key, { failed }]) => ({ key, value: failed })) },
];

describe('readAssetPosture', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sums the counts of every source of the asset', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(series({ 'ep-1': { success: 3, failed: 1 }, 'ep-2': { success: 2, failed: 4 } })));

    const posture = await readAssetPosture({ targets: [target('ep-1'), target('ep-2')], connections });

    expect(posture).toEqual({ success: 5, failed: 5 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('asks each OpenAEV tenant for its own sources only', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(series({ 'ep-1': { success: 1, failed: 0 } })))
      .mockResolvedValueOnce(jsonResponse(series({ 'ep-2': { success: 0, failed: 2 } })));

    const posture = await readAssetPosture({ targets: [target('ep-1', 'oa-1'), target('ep-2', 'oa-2')], connections });

    expect(posture).toEqual({ success: 1, failed: 2 });
    const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url)).sort();
    expect(urls).toEqual([
      'https://openaev.example.com/api/tenants/oa-1/dashboards/adhoc/series',
      'https://openaev.example.com/api/tenants/oa-2/dashboards/adhoc/series',
    ]);
  });

  it('is null, without calling OpenAEV, when the asset has no OpenAEV source', async () => {
    expect(await readAssetPosture({ targets: [], connections })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('is null, without calling OpenAEV, when no connection is configured for the tenant', async () => {
    expect(await readAssetPosture({ targets: [target('ep-1')], connections: {} })).toBeNull();
    expect(await readAssetPosture({ targets: [target('ep-1')], connections: undefined })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('is null when OpenAEV has no counter for the asset', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(series({})));

    expect(await readAssetPosture({ targets: [target('ep-1')], connections })).toBeNull();
  });

  it('is null when OpenAEV answers with an error', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('boom', { status: 500 }));

    expect(await readAssetPosture({ targets: [target('ep-1')], connections })).toBeNull();
  });

  it('is null when OpenAEV does not answer within the timeout', async () => {
    vi.mocked(fetch).mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    }));
    const startedAt = Date.now();

    const posture = await readAssetPosture({ targets: [target('ep-1')], connections, timeoutMs: 50 });

    expect(posture).toBeNull();
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  it('keeps what the reachable OpenAEV tenants answered when another one fails', async () => {
    vi.mocked(fetch).mockImplementation((url) => Promise.resolve(String(url).includes('/oa-2/')
      ? new Response('boom', { status: 500 })
      : jsonResponse(series({ 'ep-1': { success: 4, failed: 1 } }))));

    const posture = await readAssetPosture({ targets: [target('ep-1', 'oa-1'), target('ep-2', 'oa-2')], connections });

    expect(posture).toEqual({ success: 4, failed: 1 });
  });
});
