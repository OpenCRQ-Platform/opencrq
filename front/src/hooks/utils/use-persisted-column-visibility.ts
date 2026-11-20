import type { OnChangeFn, VisibilityState } from '@tanstack/table-core';
import { usePersistedTableStateField } from './use-persisted-table-state-field';

interface UsePersistedColumnVisibilityResult {
  columnVisibility: VisibilityState,
  setColumnVisibility: OnChangeFn<VisibilityState>,
}

const EMPTY_COLUMN_VISIBILITY: VisibilityState = {};

/**
 * Persists a table's column visibility (which columns the user hid) in the shared
 * local table state collection, keyed by `tableId` (the same key used for column
 * ordering, page size, view and sorting).
 *
 * `defaultVisibility` seeds the columns a table starts with hidden. Like `defaultSorting`, it only
 * applies until the user touches the panel: the first toggle persists the whole map and takes over.
 */
export const usePersistedColumnVisibility = (
  tableId: string,
  defaultVisibility: VisibilityState = EMPTY_COLUMN_VISIBILITY,
): UsePersistedColumnVisibilityResult => {
  const [columnVisibility, setColumnVisibility] = usePersistedTableStateField(
    tableId,
    (state) => state.columnVisibility,
    (draft, value) => {
      draft.columnVisibility = value;
    },
    defaultVisibility,
  );

  return { columnVisibility, setColumnVisibility };
};
