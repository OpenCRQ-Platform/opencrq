import { describe, expect, it } from 'vitest';
import * as ids from './ids';

/**
 * Every `seededRowId` generator owns a group, the fourth field of the identifier it builds, and two
 * generators sharing one produce the same identifier for the same index. The seeders that collide
 * then insert over each other, which only shows as a duplicate-key error in whichever profile
 * happens to run both — the default profile can stay green while another one is broken.
 */
const SEEDED_ROW_ID = /^019edb28-([0-9a-f]{4})-7000-8000-[0-9a-f]{12}$/;

describe('the seeded row id groups', () => {
  it('gives every generator a group no other generator uses', () => {
    const ownerByGroup = new Map<string, string>();
    const collisions: Array<string> = [];

    for (const [name, exported] of Object.entries(ids)) {
      if (typeof exported !== 'function') {
        continue;
      }
      // The two-index generators fold their arguments into one index; the one-index ones ignore
      // the second argument, so one call shape covers both.
      const group = SEEDED_ROW_ID.exec(exported(0, 0))?.[1];
      if (group === undefined) {
        continue;
      }
      const owner = ownerByGroup.get(group);
      if (owner !== undefined) {
        collisions.push(`${group}: ${owner} and ${name}`);
      } else {
        ownerByGroup.set(group, name);
      }
    }

    expect(collisions).toEqual([]);
    expect(ownerByGroup.size).toBeGreaterThan(20);
  });
});

describe('the large estate ids', () => {
  const SAMPLE = 100_000;

  it('keeps every index on an id of its own', () => {
    const seen = new Set(Array.from({ length: SAMPLE }, (_, index) => ids.largeEstateAssetId(index)));
    expect(seen.size).toBe(SAMPLE);
  });

  const SCRAMBLED = {
    asset: ids.largeEstateAssetId,
    finding: ids.largeEstateFindingId,
    findingHistory: (index: number) => ids.largeEstateFindingHistoryId(index, 0),
    dependency: ids.largeEstateDependencyId,
    assetSource: ids.largeEstateAssetSourceId,
    findingSource: ids.largeEstateFindingSourceId,
  };

  const idsOf = (make: (index: number) => string) => Array.from({ length: 2_000 }, (_, index) => make(index));
  const ascents = (sample: Array<string>) => sample.slice(1).map((id, index) => id > sample[index]);
  const assetAscents = ascents(idsOf(SCRAMBLED.asset));

  // A sequential id has no inversion, and a random order has about half of the 1 999 adjacent pairs.
  it.each(Object.entries(SCRAMBLED))('scrambles the %s ids against the index order', (_name, make) => {
    const inversions = ascents(idsOf(make)).filter((ascending) => !ascending).length;
    expect(inversions).toBeGreaterThan(800);
    expect(inversions).toBeLessThan(1_200);
  });

  it.each(Object.entries(SCRAMBLED).filter(([name]) => name !== 'asset'))('orders the %s ids independently of the asset ids', (_name, make) => {
    const agreeing = ascents(idsOf(make)).filter((ascending, index) => ascending === assetAscents[index]).length;
    expect(agreeing).toBeGreaterThan(800);
    expect(agreeing).toBeLessThan(1_200);
  });
});
