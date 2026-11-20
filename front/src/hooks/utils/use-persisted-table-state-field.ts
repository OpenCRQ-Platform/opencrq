import { eq, useLiveQuery } from '@tanstack/react-db';
import type { Updater } from '@tanstack/table-core';
import type { LocalTableState } from '../../stores';
import { localTableStateCollection } from '../../stores';

/**
 * Shared read/write logic behind every `use-persisted-*` hook: reads and writes a
 * single field of the local table state collection row keyed by `tableId`. Each
 * hook supplies `select`/`applyUpdate` for its own field so the read/write stays
 * fully typed against `LocalTableState`, without any generic key access.
 */
export const usePersistedTableStateField = <TValue>(
  tableId: string,
  select: (state: LocalTableState) => TValue | undefined,
  applyUpdate: (draft: LocalTableState, value: TValue) => void,
  defaultValue: TValue,
): [TValue, (updater: Updater<TValue>) => void] => {
  const { data: localTableState } = useLiveQuery({
    query: (q) =>
      q
        .from({ el: localTableStateCollection })
        .where(({ el }) => eq(el.id, tableId))
        .findOne(),
  });

  const value = (localTableState && select(localTableState)) ?? defaultValue;

  const setValue = (updater: Updater<TValue>): void => {
    if (localTableStateCollection.has(tableId)) {
      localTableStateCollection.update(tableId, (draft) => {
        const current = select(draft) ?? defaultValue;
        const next = updater instanceof Function ? updater(current) : updater;
        applyUpdate(draft, next);
      });
      return;
    }

    const next = updater instanceof Function ? updater(defaultValue) : updater;
    const newRow: LocalTableState = { id: tableId };
    applyUpdate(newRow, next);
    localTableStateCollection.insert(newRow);
  };

  return [value, setValue];
};
