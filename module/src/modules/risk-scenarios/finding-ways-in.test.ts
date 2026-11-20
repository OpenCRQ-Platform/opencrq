import { describe, expect, it } from 'vitest';
import type { AssetNamesById, ReachWaysIn } from './finding-ways-in';
import { placeFindingRows } from './finding-ways-in';

const EMPTY: ReachWaysIn = { depths: [], directLinks: [], dependentWays: [] };

const primaryNames = new Map([['p1', 'Payments'], ['p2', 'Ledger']]);

const namesOf = (entries: Array<[id: string, name: string | null, derivedName?: string | null]>): AssetNamesById =>
  new Map(entries.map(([id, name, derivedName]) => [id, { name, derivedName: derivedName ?? null }]));

describe('placeFindingRows', () => {
  it('counts one way per scenario primary asset a depth-0 asset is linked to, and names the smaller one first', () => {
    const waysIn: ReachWaysIn = {
      ...EMPTY,
      depths: [{ supportingAssetId: 'a', depth: 0 }],
      directLinks: [{ supportingAssetId: 'a', primaryAssetId: 'p2' }, { supportingAssetId: 'a', primaryAssetId: 'p1' }],
    };

    const [row] = placeFindingRows([{ id: 'f1', supportingAssetId: 'a' }], waysIn, namesOf([['a', 'Asset A']]), primaryNames);

    expect(row).toMatchObject({
      id: 'f1',
      pathCount: 2,
      firstPath: { viaAssetId: 'p1', viaAssetName: 'Payments', viaAssetDerivedName: null, depth: 0 },
    });
  });

  it('gives a deeper asset the count and the first dependent the reach holds for it, with that dependent\'s names', () => {
    const waysIn: ReachWaysIn = {
      ...EMPTY,
      depths: [{ supportingAssetId: 'a', depth: 2 }],
      dependentWays: [{ providerAssetId: 'a', count: 2, firstDependentAssetId: 'd1' }],
    };
    const names = namesOf([['a', 'A'], ['d1', 'D1', 'derived D1']]);

    const [row] = placeFindingRows([{ supportingAssetId: 'a' }], waysIn, names, primaryNames);

    expect(row).toMatchObject({
      pathCount: 2,
      firstPath: { viaAssetId: 'd1', viaAssetName: 'D1', viaAssetDerivedName: 'derived D1', depth: 2 },
    });
  });

  it('ignores a primary asset link of a deeper asset and the dependents of a depth-0 asset', () => {
    const waysIn: ReachWaysIn = {
      depths: [{ supportingAssetId: 'deep', depth: 1 }, { supportingAssetId: 'direct', depth: 0 }],
      directLinks: [{ supportingAssetId: 'deep', primaryAssetId: 'p1' }, { supportingAssetId: 'direct', primaryAssetId: 'p2' }],
      dependentWays: [
        { providerAssetId: 'deep', count: 1, firstDependentAssetId: 'd' },
        { providerAssetId: 'direct', count: 3, firstDependentAssetId: 'd' },
      ],
    };

    const rows = placeFindingRows([{ supportingAssetId: 'deep' }, { supportingAssetId: 'direct' }], waysIn, namesOf([]), primaryNames);

    expect(rows.map((row) => [row.pathCount, row.firstPath?.viaAssetId])).toEqual([[1, 'd'], [1, 'p2']]);
  });

  it('carries the names of the asset and leaves the via names null when none is known', () => {
    const waysIn: ReachWaysIn = {
      ...EMPTY,
      depths: [{ supportingAssetId: 'a', depth: 1 }],
      dependentWays: [{ providerAssetId: 'a', count: 1, firstDependentAssetId: 'd1' }],
    };

    const [row] = placeFindingRows([{ supportingAssetId: 'a' }], waysIn, namesOf([['a', null, 'derived A']]), primaryNames);

    expect(row).toMatchObject({
      supportingAssetName: null,
      supportingAssetDerivedName: 'derived A',
      firstPath: { viaAssetId: 'd1', viaAssetName: null, viaAssetDerivedName: null },
    });
  });

  it('gives no way in to an asset the reach does not hold yet, and to a deeper one whose dependents it does not hold yet', () => {
    const rows = placeFindingRows(
      [{ supportingAssetId: 'late' }, { supportingAssetId: 'unknown' }, { supportingAssetId: 'orphan' }],
      { ...EMPTY, depths: [{ supportingAssetId: 'orphan', depth: 1 }] },
      namesOf([['late', 'Late asset']]),
      primaryNames,
    );

    expect(rows).toEqual([
      { supportingAssetId: 'late', supportingAssetName: 'Late asset', supportingAssetDerivedName: null, firstPath: null, pathCount: 0 },
      { supportingAssetId: 'unknown', supportingAssetName: null, supportingAssetDerivedName: null, firstPath: null, pathCount: 0 },
      { supportingAssetId: 'orphan', supportingAssetName: null, supportingAssetDerivedName: null, firstPath: null, pathCount: 0 },
    ]);
  });

  it('keeps the order of the rows and every field they carry', () => {
    const waysIn: ReachWaysIn = {
      ...EMPTY,
      depths: [{ supportingAssetId: 'a', depth: 0 }, { supportingAssetId: 'b', depth: 0 }],
      directLinks: [{ supportingAssetId: 'a', primaryAssetId: 'p1' }, { supportingAssetId: 'b', primaryAssetId: 'p1' }],
    };

    const rows = placeFindingRows(
      [{ id: 'f2', supportingAssetId: 'b', cveId: 'CVE-2' }, { id: 'f1', supportingAssetId: 'a', cveId: 'CVE-1' }, { id: 'f3', supportingAssetId: 'b', cveId: 'CVE-3' }],
      waysIn,
      namesOf([]),
      primaryNames,
    );

    expect(rows.map((row) => [row.id, row.cveId, row.pathCount])).toEqual([['f2', 'CVE-2', 1], ['f1', 'CVE-1', 1], ['f3', 'CVE-3', 1]]);
  });
});
