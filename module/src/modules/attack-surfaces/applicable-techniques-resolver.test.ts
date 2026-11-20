import { describe, expect, it } from 'vitest';
import type { ApplicablePairRow } from './applicable-techniques-resolver';
import type { AssetCategory } from '../supporting-assets/constants';
import { foldPairsOntoRequestedTechniques, withUnclassifiedBucket } from './applicable-techniques-resolver';

const row = (mitreTechniqueId: string, categoryId: AssetCategory, parentTechniqueId: string | null = null): ApplicablePairRow =>
  ({ mitreTechniqueId, categoryId, parentTechniqueId });

describe('foldPairsOntoRequestedTechniques', () => {
  it('answers on the technique that was asked about', () => {
    expect(foldPairsOntoRequestedTechniques([row('t1', 'host')], ['t1']))
      .toEqual([{ mitreTechniqueId: 't1', categoryId: 'host' }]);
  });

  it('lets a top-level technique reach a family through any sub-case of its branch', () => {
    const rows = [row('t1-sub', 'identity', 't1'), row('t1-other-sub', 'saas_application', 't1')];
    expect(foldPairsOntoRequestedTechniques(rows, ['t1'])).toEqual([
      { mitreTechniqueId: 't1', categoryId: 'identity' },
      { mitreTechniqueId: 't1', categoryId: 'saas_application' },
    ]);
  });

  it('collapses two sub-cases reaching the same family into one pair', () => {
    const rows = [row('t1-a', 'host', 't1'), row('t1-b', 'host', 't1')];
    expect(foldPairsOntoRequestedTechniques(rows, ['t1'])).toEqual([{ mitreTechniqueId: 't1', categoryId: 'host' }]);
  });

  it('keeps a sub-case answered on itself when the sub-case is what was asked about', () => {
    const rows = [row('t1-sub', 'identity', 't1')];
    expect(foldPairsOntoRequestedTechniques(rows, ['t1-sub']))
      .toEqual([{ mitreTechniqueId: 't1-sub', categoryId: 'identity' }]);
  });

  it('answers a parent and its sub-case alike when both were asked about', () => {
    expect(foldPairsOntoRequestedTechniques([row('t1-sub', 'identity', 't1')], ['t1', 't1-sub'])).toEqual([
      { mitreTechniqueId: 't1-sub', categoryId: 'identity' },
      { mitreTechniqueId: 't1', categoryId: 'identity' },
    ]);
  });

  it('gives a technique the same families whatever else was asked about alongside it', () => {
    const rows = [row('t1-sub', 'identity', 't1')];
    const alone = foldPairsOntoRequestedTechniques(rows, ['t1']);
    const alongside = foldPairsOntoRequestedTechniques(rows, ['t1', 't1-sub'])
      .filter((pair) => pair.mitreTechniqueId === 't1');
    expect(alongside).toEqual(alone);
  });

  it('drops a row whose branch nobody asked about', () => {
    expect(foldPairsOntoRequestedTechniques([row('t9-sub', 'host', 't9')], ['t1'])).toEqual([]);
  });
});

describe('withUnclassifiedBucket', () => {
  it('gives every requested technique the unclassified bucket on top of its own families', () => {
    const pairs = [{ mitreTechniqueId: 't1', categoryId: 'host' as const }];
    expect(withUnclassifiedBucket(pairs, ['t1', 't2'], 'generic_asset')).toEqual([
      { mitreTechniqueId: 't1', categoryId: 'host' },
      { mitreTechniqueId: 't1', categoryId: 'generic_asset' },
      { mitreTechniqueId: 't2', categoryId: 'generic_asset' },
    ]);
  });
});
