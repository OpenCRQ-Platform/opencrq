import { describe, expect, it } from 'vitest';
import { groupAssetMix, subcategoryShadePercent } from './asset-mix-utils';

describe('groupAssetMix', () => {
  it('orders the categories and their subcategories largest first, the unspecified subcategory last', () => {
    const mix = groupAssetMix([
      { categoryId: 'host', subcategoryId: null, assetCount: 9 },
      { categoryId: 'host', subcategoryId: 'laptop', assetCount: 2 },
      { categoryId: 'host', subcategoryId: 'server', assetCount: 5 },
      { categoryId: 'identity', subcategoryId: 'user_account', assetCount: 20 },
      { categoryId: 'cloud_resource', subcategoryId: 'storage', assetCount: 3 },
      { categoryId: 'cloud_resource', subcategoryId: 'compute', assetCount: 3 },
    ]);

    expect(mix.categories.map((category) => [category.categoryId, category.assetCount])).toEqual([
      ['identity', 20], ['host', 16], ['cloud_resource', 6],
    ]);
    expect(mix.categories[1]?.subcategories.map((sub) => sub.subcategoryId)).toEqual(['server', 'laptop', null]);
    expect(mix.categories[2]?.subcategories.map((sub) => sub.subcategoryId)).toEqual(['compute', 'storage']);
    expect(mix.total).toBe(42);
    expect(mix.largest).toBe(20);
  });

  it('sets the to-classify bucket apart from the categories, and still counts it in the total and the scale', () => {
    const mix = groupAssetMix([
      { categoryId: 'generic_asset', subcategoryId: null, assetCount: 30 },
      { categoryId: 'host', subcategoryId: 'server', assetCount: 4 },
    ]);

    expect(mix.categories.map((category) => category.categoryId)).toEqual(['host']);
    expect(mix).toMatchObject({ unclassified: 30, total: 34, largest: 30 });
  });

  it('reads an empty estate as no category and a scale of one', () => {
    expect(groupAssetMix([])).toEqual({ total: 0, largest: 1, categories: [], unclassified: 0 });
  });
});

describe('subcategoryShadePercent', () => {
  it('fades from full to 40 % across the named subcategories', () => {
    expect([0, 1, 2].map((index) => subcategoryShadePercent(index, 3))).toEqual([100, 70, 40]);
    expect(subcategoryShadePercent(0, 1)).toBe(100);
  });
});
