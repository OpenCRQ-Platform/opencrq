import type { ColumnOrderState, OnChangeFn } from '@tanstack/table-core';
import { localTableStateCollection } from '../../stores';
import { usePersistedTableStateField } from './use-persisted-table-state-field';

/**
 * Merges a saved column order with the current set of column IDs. Removes stale columns and
 * inserts each new one right after the column defined before it, so a column meant to sit beside
 * another (a figure's "i") stays there in an order saved before it existed.
 */
export const reconcileColumnOrder = (
  savedOrder: Array<string>,
  currentColumnIds: Array<string>,
): Array<string> => {
  const order = savedOrder.filter((id) => currentColumnIds.includes(id));
  currentColumnIds.forEach((id, index) => {
    if (order.includes(id)) {
      return;
    }
    const predecessor = currentColumnIds.slice(0, index).findLast((previous) => order.includes(previous));
    order.splice(predecessor === undefined ? 0 : order.indexOf(predecessor) + 1, 0, id);
  });
  return order;
};

interface UseTableColumnOrderingResult {
  columnOrder: ColumnOrderState,
  setColumnOrder: OnChangeFn<ColumnOrderState>,
  onResetTable: () => void,
}

/**
 * Persists a table's column order in the shared local table state collection,
 * keyed by `tableId`. The saved order is reconciled against the current columns
 * on every read, dropping removed ones and placing new ones after the column defined before them.
 */
export const useTableColumnOrdering = (
  tableId: string,
  columnIds: Array<string>,
): UseTableColumnOrderingResult => {
  const [savedColumnOrder, setColumnOrder] = usePersistedTableStateField(
    tableId,
    (state) => state.columnOrder,
    (draft, value) => {
      draft.columnOrder = value;
    },
    columnIds,
  );
  const columnOrder = reconcileColumnOrder(savedColumnOrder, columnIds);

  const onResetTable = (): void => {
    localTableStateCollection.delete([tableId]);
  };

  return { columnOrder, setColumnOrder, onResetTable };
};
