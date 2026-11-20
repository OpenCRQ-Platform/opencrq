import type { OnChangeFn, SortingState } from '@tanstack/table-core';
import { usePersistedTableStateField } from './use-persisted-table-state-field';

interface UsePersistedSortingResult {
  sorting: SortingState,
  setSorting: OnChangeFn<SortingState>,
}

/**
 * Persists a table's user-chosen sorting in the shared local table state collection,
 * keyed by `tableId` (the same key used for column ordering, page size and view).
 * Once the user has picked a sort, it takes priority over `defaultSorting`.
 */
export const usePersistedSorting = (
  tableId: string,
  defaultSorting: SortingState,
): UsePersistedSortingResult => {
  const [sorting, setSorting] = usePersistedTableStateField(
    tableId,
    (state) => state.sorting,
    (draft, value) => {
      draft.sorting = value;
    },
    defaultSorting,
  );

  return { sorting, setSorting };
};
