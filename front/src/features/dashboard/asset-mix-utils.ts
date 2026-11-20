import type { AssetCategory, AssetSubcategory } from '@app/module/client';
import { UNCLASSIFIED_ASSET_CATEGORY } from '@app/module/client';

export interface AssetCountRow {
  categoryId: AssetCategory,
  subcategoryId: AssetSubcategory | null,
  assetCount: number,
}

export interface SubcategoryShare {
  subcategoryId: AssetSubcategory | null,
  assetCount: number,
}

export interface CategoryShare {
  categoryId: AssetCategory,
  assetCount: number,
  subcategories: Array<SubcategoryShare>,
}

export interface AssetMix {
  total: number,
  /** The longest bar, the to-classify one included, so every bar is a fraction of it. */
  largest: number,
  categories: Array<CategoryShare>,
  unclassified: number,
}

const byCountThenId = <T extends { assetCount: number }>(id: (row: T) => string) => (a: T, b: T): number =>
  b.assetCount - a.assetCount || id(a).localeCompare(id(b));

/**
 * Largest first, the assets without a subcategory last in their category. The to-classify bucket is
 * set apart from the categories: it is classification work pending, not a kind of asset.
 */
export const groupAssetMix = (rows: ReadonlyArray<AssetCountRow>): AssetMix => {
  const byCategory = new Map<AssetCategory, Array<SubcategoryShare>>();
  let unclassified = 0;
  for (const { categoryId, subcategoryId, assetCount } of rows) {
    if (categoryId === UNCLASSIFIED_ASSET_CATEGORY) {
      unclassified += assetCount;
    } else {
      byCategory.set(categoryId, [...(byCategory.get(categoryId) ?? []), { subcategoryId, assetCount }]);
    }
  }
  const categories = [...byCategory].map(([categoryId, subcategories]) => {
    const named = subcategories.filter((sub) => sub.subcategoryId !== null).sort(byCountThenId((sub) => sub.subcategoryId ?? ''));
    return {
      categoryId,
      assetCount: subcategories.reduce((sum, sub) => sum + sub.assetCount, 0),
      subcategories: [...named, ...subcategories.filter((sub) => sub.subcategoryId === null)],
    };
  }).sort(byCountThenId((category) => category.categoryId));
  const total = categories.reduce((sum, category) => sum + category.assetCount, unclassified);
  const largest = Math.max(1, unclassified, ...categories.map((category) => category.assetCount));
  return { total, largest, categories, unclassified };
};

export const subcategoryShadePercent = (index: number, namedCount: number): number =>
  (namedCount <= 1 ? 100 : Math.round(100 - (index * 60) / (namedCount - 1)));
