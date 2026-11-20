import { describe, expect, it, vi } from 'vitest';
import type { ReachRow } from './reach';
import { diffReach, MAX_REACH_DEPTH, walkReach } from './reach';

type Link = { dependentAssetId: string, providerAssetId: string };

const providersFrom = (links: ReadonlyArray<readonly [dependent: string, provider: string]>) =>
  vi.fn((dependentIds: ReadonlyArray<string>): Promise<ReadonlyArray<Link>> =>
    Promise.resolve(links.filter(([dependent]) => dependentIds.includes(dependent)).map(([dependentAssetId, providerAssetId]) => ({ dependentAssetId, providerAssetId }))));

describe('walkReach', () => {
  it('returns an empty map without reading any provider when nothing is linked directly', async () => {
    const providersOf = providersFrom([['a', 'b']]);

    expect(await walkReach([], providersOf)).toEqual(new Map());
    expect(providersOf).not.toHaveBeenCalled();
  });

  it('counts a duplicated direct asset once', async () => {
    const providersOf = providersFrom([]);

    expect(await walkReach(['a', 'a', 'b'], providersOf)).toEqual(new Map([['a', 0], ['b', 0]]));
  });

  it('gives each provider the depth of the shortest way down to it', async () => {
    const providersOf = providersFrom([['a', 'b'], ['b', 'c'], ['a', 'c'], ['c', 'd']]);

    expect(await walkReach(['a'], providersOf)).toEqual(new Map([['a', 0], ['b', 1], ['c', 1], ['d', 2]]));
  });

  it('keeps depth 0 for an asset that is both direct and a provider of another direct asset', async () => {
    const providersOf = providersFrom([['a', 'b']]);

    expect(await walkReach(['a', 'b'], providersOf)).toEqual(new Map([['a', 0], ['b', 0]]));
  });

  it('ends on a cycle, including one through the direct asset', async () => {
    const providersOf = providersFrom([['a', 'b'], ['b', 'c'], ['c', 'a'], ['c', 'b']]);

    expect(await walkReach(['a'], providersOf)).toEqual(new Map([['a', 0], ['b', 1], ['c', 2]]));
  });

  it('reaches depth 5 and leaves out an asset first reached at depth 6', async () => {
    const chain = ['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'];
    const providersOf = providersFrom(chain.slice(1).map((provider, i) => [chain[i], provider] as const));

    const reach = await walkReach(['a0'], providersOf);

    expect(MAX_REACH_DEPTH).toBe(5);
    expect(reach.get('a5')).toBe(5);
    expect(reach.has('a6')).toBe(false);
    expect(reach.size).toBe(6);
  });

  it('asks for the providers once per level, with the assets newly reached only', async () => {
    const providersOf = providersFrom([['a', 'b'], ['a', 'c'], ['b', 'd'], ['c', 'd'], ['d', 'a']]);

    await walkReach(['a'], providersOf);

    expect(providersOf.mock.calls.map(([ids]) => [...ids].sort())).toEqual([['a'], ['b', 'c'], ['d']]);
  });

  it('stops asking once a level reaches nothing new', async () => {
    const providersOf = providersFrom([['a', 'b'], ['b', 'a']]);

    await walkReach(['a'], providersOf);

    expect(providersOf).toHaveBeenCalledTimes(2);
  });
});

describe('diffReach', () => {
  const row = (primaryAssetId: string, supportingAssetId: string, depth: number, organizationId = 'org-1'): ReachRow =>
    ({ organizationId, primaryAssetId, supportingAssetId, depth });

  it('writes nothing for identical inputs', () => {
    const rows = [row('p1', 's1', 0), row('p1', 's2', 1), row('p2', 's1', 2)];

    expect(diffReach(rows, [...rows].reverse())).toEqual({ upserts: [], stale: [] });
  });

  it('upserts a wanted row nobody holds', () => {
    expect(diffReach([row('p1', 's1', 0)], [row('p1', 's1', 0), row('p1', 's2', 1)])).toEqual({
      upserts: [row('p1', 's2', 1)],
      stale: [],
    });
  });

  it('names a held row nobody wants as stale, by its primary asset and supporting asset', () => {
    expect(diffReach([row('p1', 's1', 0), row('p1', 's2', 1)], [row('p1', 's1', 0)])).toEqual({
      upserts: [],
      stale: [{ primaryAssetId: 'p1', supportingAssetId: 's2' }],
    });
  });

  it('upserts a held row whose depth changed, without deleting it', () => {
    expect(diffReach([row('p1', 's1', 2)], [row('p1', 's1', 1)])).toEqual({ upserts: [row('p1', 's1', 1)], stale: [] });
  });

  it('upserts a held row whose organization changed, without deleting it', () => {
    expect(diffReach([row('p1', 's1', 1, 'org-1')], [row('p1', 's1', 1, 'org-2')])).toEqual({
      upserts: [row('p1', 's1', 1, 'org-2')],
      stale: [],
    });
  });

  it('keys a row on its primary asset and its supporting asset: the same supporting asset under two primary assets is two rows', () => {
    expect(diffReach([row('p1', 's1', 0)], [row('p1', 's1', 0), row('p2', 's1', 0)])).toEqual({
      upserts: [row('p2', 's1', 0)],
      stale: [],
    });
  });
});
