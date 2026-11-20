import { describe, expect, it } from 'vitest';
import type { ExposureWeights } from './asset-relevance';
import { computeAssetRelevance, resolveAssetRelevanceWeight, resolveUnknownEstateWeight } from './asset-relevance';

const DEFAULT_WEIGHTS: ExposureWeights = {
  internet_facing: 1.0,
  internal: 0.4,
  unknown: 0.8,
};

describe('computeAssetRelevance', () => {
  it('should weight each category by its own inventoried assets and by nothing else', () => {
    const result = computeAssetRelevance({
      categoryIds: ['host', 'cloud_resource', 'identity'],
      techniqueCategoryMapping: {
        'T1021': ['host', 'cloud_resource'],
        'T1059': ['host', 'cloud_resource', 'identity'],
        'T1003': ['host', 'identity'],
      },
      supportingAssetCounts: {
        host: { internet_facing: 3, internal: 5 },
        cloud_resource: { internet_facing: 25 },
        identity: { internal: 30 },
      },
      exposureWeights: DEFAULT_WEIGHTS,
    });

    expect(result).not.toBeNull();
    expect(result!.total.likely).toBe(42);
    expect(result!.perTechnique['T1021'].likely).toBe(30);
    expect(result!.perTechnique['T1059'].likely).toBe(42);
    expect(result!.perTechnique['T1003'].likely).toBe(17);
  });

  it('should weight assets whose exposure was never set with the unknown weight', () => {
    const result = computeAssetRelevance({
      categoryIds: ['identity'],
      techniqueCategoryMapping: { 'T1': ['identity'] },
      supportingAssetCounts: { identity: { internet_facing: 12, unknown: 30 } },
      exposureWeights: DEFAULT_WEIGHTS,
    });

    expect(result).not.toBeNull();
    expect(result!.total.likely).toBe(36);
  });

  it('should collapse a range to a point, since an inventoried count is exact', () => {
    const result = computeAssetRelevance({
      categoryIds: ['host'],
      techniqueCategoryMapping: { 'T1': ['host'] },
      supportingAssetCounts: { host: { internal: 10 } },
      exposureWeights: DEFAULT_WEIGHTS,
    });

    expect(result).not.toBeNull();
    expect(result!.total.min).toBe(4);
    expect(result!.total.likely).toBe(4);
    expect(result!.total.max).toBe(4);
  });

  it('should give a technique reaching every category the whole weighted volume', () => {
    const result = computeAssetRelevance({
      categoryIds: ['cat-1', 'cat-2'],
      techniqueCategoryMapping: { 'T1': ['cat-1', 'cat-2'] },
      supportingAssetCounts: {
        'cat-1': { internet_facing: 10 },
        'cat-2': { internet_facing: 5 },
      },
      exposureWeights: DEFAULT_WEIGHTS,
    });

    expect(result).not.toBeNull();
    expect(result!.perTechnique['T1'].likely).toBe(result!.total.likely);
  });

  it('should give a technique reaching a subset of categories a share of the volume', () => {
    const result = computeAssetRelevance({
      categoryIds: ['cat-1', 'cat-2'],
      techniqueCategoryMapping: { 'T1': ['cat-1'] },
      supportingAssetCounts: {
        'cat-1': { internet_facing: 10 },
        'cat-2': { internet_facing: 10 },
      },
      exposureWeights: DEFAULT_WEIGHTS,
    });

    expect(result).not.toBeNull();
    expect(result!.perTechnique['T1'].likely).toBe(result!.total.likely / 2);
  });

  it('should return null when no category of the scenario holds a single inventoried asset', () => {
    const result = computeAssetRelevance({
      categoryIds: ['cat-1', 'cat-2'],
      techniqueCategoryMapping: { 'T1': ['cat-1'] },
      supportingAssetCounts: {},
      exposureWeights: DEFAULT_WEIGHTS,
    });

    expect(result).toBeNull();
  });

  it('should return null when the scenario touches no category at all', () => {
    const result = computeAssetRelevance({
      categoryIds: [],
      techniqueCategoryMapping: { 'T1': ['cat-1'] },
      supportingAssetCounts: { 'cat-1': { internet_facing: 10 } },
      exposureWeights: DEFAULT_WEIGHTS,
    });

    expect(result).toBeNull();
  });

  it('should ignore inventoried counts of categories the scenario does not touch', () => {
    const result = computeAssetRelevance({
      categoryIds: ['cat-1'],
      techniqueCategoryMapping: { 'T1': ['cat-1'] },
      supportingAssetCounts: {
        'cat-1': { internet_facing: 10 },
        'cat-2': { internet_facing: 999 },
      },
      exposureWeights: DEFAULT_WEIGHTS,
    });

    expect(result).not.toBeNull();
    expect(result!.total.likely).toBe(10);
  });
});

describe('resolveAssetRelevanceWeight', () => {
  const relevanceOf = (counts: Record<string, { internet_facing?: number, internal?: number, unknown?: number }>, mapping: Record<string, Array<string>>) =>
    computeAssetRelevance({
      categoryIds: Object.keys(counts),
      techniqueCategoryMapping: mapping,
      supportingAssetCounts: counts,
      exposureWeights: DEFAULT_WEIGHTS,
    });

  it('should give every technique the same unknown-estate share when no category holds an asset', () => {
    const relevance = relevanceOf({ 'cat-1': {}, 'cat-2': {} }, { 'T1': ['cat-1'], 'T2': ['cat-2'] });

    expect(relevance).toBeNull();
    expect(resolveAssetRelevanceWeight(relevance, 'T1', 2)).toBe(0.5);
    expect(resolveAssetRelevanceWeight(relevance, 'T2', 2)).toBe(0.5);
    expect(resolveAssetRelevanceWeight(relevance, 'T-unmapped', 2)).toBe(0.5);
  });

  it('should never hand a technique the whole estate for want of an inventory', () => {
    for (const touched of [1, 2, 5, 11]) {
      expect(resolveAssetRelevanceWeight(null, 'T1', touched)).toBe(1 / touched);
    }
  });

  it('should keep the weight at one when the scenario touches no category at all', () => {
    expect(resolveUnknownEstateWeight(0)).toBe(1);
    expect(resolveAssetRelevanceWeight(null, 'T1', 0)).toBe(1);
  });

  it('should weigh a category by exactly its own inventoried assets and by nothing else', () => {
    const relevance = relevanceOf(
      { 'cat-1': { internet_facing: 10 }, 'cat-2': { internal: 25 } },
      { 'T1': ['cat-1'], 'T2': ['cat-1', 'cat-2'] },
    );

    expect(relevance).not.toBeNull();
    // 25 internal assets weigh the same as 10 internet-facing ones.
    expect(resolveAssetRelevanceWeight(relevance, 'T1', 2)).toBe(0.5);
    expect(resolveAssetRelevanceWeight(relevance, 'T2', 2)).toBe(1);
  });

  it('should damp a technique reaching none of the inventoried categories to zero', () => {
    const relevance = relevanceOf({ 'cat-1': { internet_facing: 10 } }, { 'T1': ['cat-1'] });

    expect(relevance).not.toBeNull();
    expect(resolveAssetRelevanceWeight(relevance, 'T-elsewhere', 1)).toBe(0);
  });

  it('should cap the weight at one', () => {
    const relevance = relevanceOf({ 'cat-1': { internet_facing: 10 } }, { 'T1': ['cat-1', 'cat-1'] });

    expect(relevance).not.toBeNull();
    expect(resolveAssetRelevanceWeight(relevance, 'T1', 1)).toBe(1);
  });
});
