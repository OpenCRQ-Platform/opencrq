import { usePersistedTableStateField } from './use-persisted-table-state-field';

interface UsePersistedViewResult<TView extends string> {
  view: TView,
  setView: (view: TView) => void,
}

const isValidView = <TView extends string>(value: string, validViews: ReadonlyArray<TView>): value is TView =>
  validViews.some((validView) => validView === value);

/**
 * Persists a table's active view mode (e.g. `'grid' | 'table'` or `'table' | 'matrix'`)
 * in the shared local table state collection, keyed by `tableId` (the same key used
 * for column ordering and page size). `validViews` lists the views currently offered
 * by the caller: a stale persisted value (e.g. after the set of views changed) is
 * narrowed to `TView` via a type guard and falls back to `defaultView` instead of
 * being trusted through an unchecked type assertion.
 */
export const usePersistedView = <TView extends string>(
  tableId: string,
  defaultView: TView,
  validViews: ReadonlyArray<TView>,
): UsePersistedViewResult<TView> => {
  const [rawView, setRawView] = usePersistedTableStateField(
    tableId,
    (state) => state.view,
    (draft, value) => {
      draft.view = value;
    },
    defaultView as string,
  );
  const view = isValidView(rawView, validViews) ? rawView : defaultView;
  const setView = (newView: TView): void => setRawView(newView);

  return { view, setView };
};
