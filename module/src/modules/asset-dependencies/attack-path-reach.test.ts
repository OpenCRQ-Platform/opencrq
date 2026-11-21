import { describe, expect, it, vi } from 'vitest';
import { attackPathFreshSince, isAttackPathHopStale, MAX_ATTACK_PATH_DEPTH, primaryAssetsBehind, walkAttackPath } from './attack-path-reach';

type Hop = { fromAssetId: string, toAssetId: string };

/** Hops written as [reached, reached from], the way a `reachable_from` relation is stored. */
const hopsFrom = (hops: ReadonlyArray<readonly [reached: string, from: string]>) =>
  vi.fn((assetIds: ReadonlyArray<string>): Promise<ReadonlyArray<Hop>> =>
    Promise.resolve(hops.filter(([, from]) => assetIds.includes(from)).map(([fromAssetId, toAssetId]) => ({ fromAssetId, toAssetId }))));

describe('walkAttackPath', () => {
  it('follows the hops from the origin and gives each asset its shortest depth', async () => {
    expect(await walkAttackPath('a', hopsFrom([['b', 'a'], ['c', 'b'], ['c', 'a']])))
      .toEqual(new Map([['a', 0], ['b', 1], ['c', 1]]));
  });

  it('stops on a cycle', async () => {
    expect(await walkAttackPath('a', hopsFrom([['b', 'a'], ['a', 'b']]))).toEqual(new Map([['a', 0], ['b', 1]]));
  });

  it('stops at the maximum depth', async () => {
    const hops = Array.from({ length: MAX_ATTACK_PATH_DEPTH + 2 }, (_, i) => [`n${i + 1}`, `n${i}`] as const);
    const reached = await walkAttackPath('n0', hopsFrom(hops));
    expect(Math.max(...reached.values())).toBe(MAX_ATTACK_PATH_DEPTH);
  });
});

describe('primaryAssetsBehind', () => {
  it('lists the primary assets behind the reached assets, nearest first', () => {
    const depthOf = new Map([['controller', 0], ['database', 1], ['cache', 2]]);
    expect(primaryAssetsBehind(depthOf, [
      { primaryAssetId: 'p-service', primaryAssetName: 'SaaS service delivery', supportingAssetId: 'cache' },
      { primaryAssetId: 'p-data', primaryAssetName: 'Customer data', supportingAssetId: 'database' },
      { primaryAssetId: 'p-data', primaryAssetName: 'Customer data', supportingAssetId: 'cache' },
      { primaryAssetId: 'p-other', primaryAssetName: 'Other', supportingAssetId: 'unreached' },
    ])).toEqual([
      { primaryAssetId: 'p-data', primaryAssetName: 'Customer data', throughAssetIds: ['database', 'cache'] },
      { primaryAssetId: 'p-service', primaryAssetName: 'SaaS service delivery', throughAssetIds: ['cache'] },
    ]);
  });
});

describe('staleness', () => {
  const now = new Date('2026-11-21T00:00:00Z');

  it('reads a hop reported 30 days ago as fresh and one reported 31 days ago as stale', () => {
    expect(attackPathFreshSince(now)).toEqual(new Date('2026-10-22T00:00:00Z'));
    expect(isAttackPathHopStale(new Date('2026-10-22T00:00:00Z'), now)).toBe(false);
    expect(isAttackPathHopStale(new Date('2026-10-21T00:00:00Z'), now)).toBe(true);
  });
});
