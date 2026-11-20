import { usePersistedTableStateField } from './use-persisted-table-state-field';

interface UsePersistedPageSizeResult {
  pageSize: number,
  setPageSize: (pageSize: number) => void,
}

/**
 * Persists a table's page size in the shared local table state collection,
 * keyed by `tableId` (the same key used for column ordering).
 */
export const usePersistedPageSize = (
  tableId: string,
  defaultPageSize: number,
): UsePersistedPageSizeResult => {
  const [pageSize, setPageSize] = usePersistedTableStateField(
    tableId,
    (state) => state.pageSize,
    (draft, value) => {
      draft.pageSize = value;
    },
    defaultPageSize,
  );

  return { pageSize, setPageSize };
};
