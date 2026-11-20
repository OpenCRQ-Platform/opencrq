import type { EstateMode } from '@app/module/client';

/**
 * Which empty state the asset list shows. `scope-unmapped` is a closed scope holding none while the
 * estate holds some, which is a mapping to make rather than a connector to plug. `no-results` is a
 * search or a filter that matched nothing: the list is not empty, the reader narrowed it too far.
 */
export type AssetsEmptyState = 'estate-empty' | 'scope-unmapped' | 'no-results';

/** Whether a search or a filter narrows the list, which is what tells no result from no asset. */
export const isAssetsListFiltered = ({ search, source, category, group = 'all' }: {
  search: string,
  source: string,
  category: string,
  group?: string,
}): boolean => search.trim() !== '' || source !== 'all' || category !== 'all' || group !== 'all';

export const resolveAssetsEmptyState = ({
  total,
  search,
  source,
  category,
  group = 'all',
  estateMode,
  estateTotal,
}: {
  total: number,
  search: string,
  source: string,
  category: string,
  /** The group filter, `all` when none narrows the list. */
  group?: string,
  estateMode: EstateMode | undefined,
  /** Assets the tenant holds, all scopes together. Undefined until it is known. */
  estateTotal: number | undefined,
}): AssetsEmptyState | null => {
  if (total > 0) {
    return null;
  }
  if (isAssetsListFiltered({ search, source, category, group })) {
    return 'no-results';
  }
  if (estateMode !== 'closed') {
    return 'estate-empty';
  }
  // Nothing to map is not a mapping to make: a closed scope in a tenant with no asset at all reads
  // as the empty estate it is. Until the estate is known, neither card is the honest one.
  if (estateTotal === undefined) {
    return null;
  }
  return estateTotal > 0 ? 'scope-unmapped' : 'estate-empty';
};
