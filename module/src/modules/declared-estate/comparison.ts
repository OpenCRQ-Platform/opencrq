import type { AssetCategory, AssetSubcategory } from '../supporting-assets/constants';
import type { DeclaredEstateKind } from './constants';
import { DECLARED_ESTATE_KIND_VALUES, declaredEstateKindOf } from './constants';

/** `none_measured` says nothing about the estimate: no integration may report the kind yet. */
export const DECLARED_ESTATE_COMPARISON_STATE_VALUES = ['below', 'within', 'above', 'none_measured', 'not_declared'] as const;
export type DeclaredEstateComparisonState = (typeof DECLARED_ESTATE_COMPARISON_STATE_VALUES)[number];

export interface MeasuredAssetCountRow {
  readonly categoryId: AssetCategory,
  readonly subcategoryId: AssetSubcategory | null,
  readonly identityEnabled: boolean,
  readonly assetCount: number,
}

export interface DeclaredEstateKindComparison {
  readonly kind: DeclaredEstateKind,
  readonly bounds: { readonly low: number, readonly high: number } | null,
  readonly measured: number,
  readonly state: DeclaredEstateComparisonState,
}

export const measuredCountsByKind = (rows: ReadonlyArray<MeasuredAssetCountRow>): ReadonlyMap<DeclaredEstateKind, number> => {
  const counts = new Map<DeclaredEstateKind, number>();
  for (const row of rows) {
    const kind = declaredEstateKindOf(row.categoryId, row.subcategoryId, row.identityEnabled);
    if (kind !== null) {
      counts.set(kind, (counts.get(kind) ?? 0) + row.assetCount);
    }
  }
  return counts;
};

export const comparisonStateOf = (
  bounds: { readonly low: number, readonly high: number } | null,
  measured: number,
): DeclaredEstateComparisonState => {
  if (bounds === null) {
    return 'not_declared';
  }
  if (measured === 0) {
    return 'none_measured';
  }
  if (measured < bounds.low) {
    return 'below';
  }
  return measured > bounds.high ? 'above' : 'within';
};

export const compareDeclaredEstate = (
  declared: ReadonlyArray<{ readonly kind: DeclaredEstateKind, readonly bounds: { readonly low: number, readonly high: number } | null }>,
  measured: ReadonlyArray<MeasuredAssetCountRow>,
): Array<DeclaredEstateKindComparison> => {
  const boundsOf = new Map(declared.map((row) => [row.kind, row.bounds]));
  const measuredOf = measuredCountsByKind(measured);
  return DECLARED_ESTATE_KIND_VALUES.map((kind) => {
    const bounds = boundsOf.get(kind) ?? null;
    const count = measuredOf.get(kind) ?? 0;
    return { kind, bounds, measured: count, state: comparisonStateOf(bounds, count) };
  });
};
