import { describe, expect, it } from 'vitest';
import { ASSET_CATEGORY_VALUES, ASSET_SUBCATEGORY_VALUES } from '@app/module/client';
import { getAssetCategoryDescription } from './asset-category-utils';
import { getAssetSubcategoryDescription } from './asset-subcategory-description';
import { getAssetSubcategoryLabel } from './asset-subcategory-utils';

describe('getAssetSubcategoryDescription', () => {
  it.each([...ASSET_SUBCATEGORY_VALUES])('gives %s a one-line meaning distinct from its label', (subcategory) => {
    const description = getAssetSubcategoryDescription(subcategory);
    expect(description).not.toBe('');
    expect(description).not.toBe(getAssetSubcategoryLabel(subcategory));
    expect(description).not.toContain('\n');
  });

  it('answers an empty line for an unknown subcategory', () => {
    expect(getAssetSubcategoryDescription('not_a_subcategory')).toBe('');
  });
});

describe('getAssetCategoryDescription', () => {
  it.each([...ASSET_CATEGORY_VALUES])('gives %s a one-line meaning', (category) => {
    const description = getAssetCategoryDescription(category);
    expect(description).not.toBe(category);
    expect(description).not.toContain('\n');
  });
});
