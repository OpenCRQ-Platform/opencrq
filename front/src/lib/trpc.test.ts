import { afterEach, describe, expect, it, vi } from 'vitest';
import { trpcClient } from './trpc';

/** The path and query of a request, decoded: `/trpc/a.b,c.d?batch=1&input=…`. */
const pathAndQuery = (url: string) => {
  const parsed = new URL(url, 'http://localhost');
  return decodeURIComponent(parsed.pathname + parsed.search);
};

/** Answers each request as the server would: a batch with one result per call, a single call with its own. */
const stubFetch = () => {
  const fetchMock = vi.fn((url: string) => {
    const result = { result: { data: null } };
    const calls = pathAndQuery(url).split('?')[0].split(',').length;
    const body = url.includes('batch=1') ? Array.from({ length: calls }, () => result) : result;
    return Promise.resolve(new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return () => fetchMock.mock.calls.map(([url]) => pathAndQuery(url));
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('trpcClient', () => {
  it('should send a call asking to skip batching in a request of its own, and batch the others', async () => {
    const requests = stubFetch();

    await Promise.all([
      trpcClient.assetDependencies.createSupportToSupportLinks.mutate([], { context: { skipBatch: true } }),
      trpcClient.assetDependencies.deleteSupportToSupportLinks.mutate([], { context: { skipBatch: true } }),
      trpcClient.assetDependencies.createSupportToPrimaryLinks.mutate([]),
      trpcClient.assetDependencies.deleteSupportToPrimaryLinks.mutate([]),
    ]);

    const sent = requests();
    expect(sent.filter((url) => !url.includes('batch=1')).sort()).toEqual([
      '/trpc/assetDependencies.createSupportToSupportLinks',
      '/trpc/assetDependencies.deleteSupportToSupportLinks',
    ]);
    expect(sent.filter((url) => url.includes('batch=1')).map((url) => url.split('?')[0])).toEqual([
      '/trpc/assetDependencies.createSupportToPrimaryLinks,assetDependencies.deleteSupportToPrimaryLinks',
    ]);
  });
});
