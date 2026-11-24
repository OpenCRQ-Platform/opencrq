import { IconButton, Spinner } from '@filigran/design-system';
import { DataTable, DataTableHeadBarOptions } from '@filigran/ui';
import type { ColumnDefWithOptionsHeader, DataTableSelectionConfig, SelectionState } from '@filigran/ui';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { CellContext, ColumnOrderState, ExpandedState, PaginationState, Row, SortingState, Updater, VisibilityState } from '@tanstack/react-table';
import { flexRender, getPaginationRowModel, getSortedRowModel } from '@tanstack/react-table';
import { ChevronDown, ChevronRight, Columns3, LayoutGrid, List, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DataPageFilter, DataPageSearch } from './data-page-filters';
import type { IconButtonGroupItem } from './icon-button-group';
import type { SegmentedCount } from './segmented-counts';
import type { HighlightColor, HighlightedTechnique } from '../shared/ttp-matrix-cell';
import { useDelayedFlag, usePersistedColumnVisibility, usePersistedPageSize, usePersistedSorting, usePersistedView, useTableColumnOrdering } from '../../hooks';
import { DeleteConfirmDialog } from '../shared/delete-confirm-dialog';
import { TtpMatrixView } from '../shared/ttp-matrix-view';
import { withTextAwareSorting } from '../../utils/table-sorting-utils';
import { cn } from '../../utils';
import { DataPageToolbar } from './data-page-toolbar';
import { useDataPageFilters } from './data-page-filters';
import { HighlightFilterToggle } from './highlight-filter-toggle';
import { ListNoResults } from './list-no-results';
import { SegmentedCounts } from './segmented-counts';
import { IconButtonGroup } from './icon-button-group';
import { getDataTableI18nKey } from './data-table-i18n';

// A fast answer shows no loading state, and one shown stays long enough not to flash.
const PENDING_DELAY_MS = 250;
const PENDING_MIN_DURATION_MS = 200;

// --- DataPageGrid: internal grid layout ---

interface DataPageGridProps {
  children: ReactNode,
}

const DataPageGrid = ({ children }: DataPageGridProps): ReactNode => (
  // `md:grid-cols-2` is shipped unlayered by `fds.css` since design system 1.0.0, so it beats every
  // larger breakpoint declared here and pins the grid at two columns. The arbitrary form is a name
  // the design system does not generate, so nothing competes for it.
  <div className="grid grid-cols-1 gap-5 md:grid-cols-[repeat(2,minmax(0,1fr))] lg:grid-cols-3 xl:grid-cols-4">
    {children}
  </div>
);

// --- Expandable rows ---

const EXPAND_COLUMN_ID = 'expand';
const SUB_ROW_TOGGLE_ATTRIBUTE = 'data-sub-row-toggle';
const EXPANDED_ROW_ATTRIBUTE = 'data-sub-row-expanded';

export interface ExpandableRows<T> {
  /** What a row unfolds into, drawn under it across every column. */
  render: (row: T) => ReactNode,
  /** Rows answering false get no chevron. Every row can expand when it is left out. */
  canExpand?: (row: T) => boolean,
  /** The chevron's accessible name; its `aria-expanded` carries the state. */
  toggleLabel: (row: T) => string,
}

const expandColumn = <T extends { id: string }>(
  toggleLabel: (row: T) => string,
  subRowId: (rowId: string) => string,
): ColumnDefWithOptionsHeader<T, unknown> => ({
  id: EXPAND_COLUMN_ID,
  header: () => <span className="sr-only">{t`Expand`}</span>,
  optionsHeader: () => null,
  size: 56,
  enableSorting: false,
  enableHiding: false,
  enableResizing: false,
  cell: ({ row }) => {
    if (!row.getCanExpand()) {
      return null;
    }
    const expanded = row.getIsExpanded();
    return (
      <IconButton
        type="button"
        priority="tertiary"
        size="sm"
        aria-expanded={expanded}
        aria-controls={expanded ? subRowId(row.id) : undefined}
        aria-label={toggleLabel(row.original)}
        data-sub-row-toggle={row.id}
        icon={expanded ? <ChevronDown aria-hidden="true" className="size-4" /> : <ChevronRight aria-hidden="true" className="size-4" />}
        onClick={(event) => {
          event.stopPropagation();
          row.toggleExpanded();
        }}
      />
    );
  },
});

// --- Row groups ---

const GROUP_COLUMN_ID = 'row-group';
const ROW_GROUP_ATTRIBUTE = 'data-row-group';

export interface RowGroups<T, G extends string> {
  groupOf: (row: T) => G,
  /** Every group a row can belong to, in the order the table shows them. */
  order: ReadonlyArray<G>,
  /** The row heading a group, drawn across every column above its first row on the page. */
  renderHeader: (group: G, count: number) => ReactNode,
}

// Hidden, and the leading sort key whatever the reader sorts on, so a group's rows stay together.
const groupColumn = <T, G extends string>({ groupOf, order }: RowGroups<T, G>): ColumnDefWithOptionsHeader<T, unknown> => ({
  id: GROUP_COLUMN_ID,
  accessorFn: (row) => order.indexOf(groupOf(row)),
  header: () => null,
  optionsHeader: () => null,
  enableHiding: false,
  enableResizing: false,
});

// What TanStack draws for a column that declares no cell: the value as text, never the raw value.
const valueAsText = <T extends { id: string }>(context: CellContext<T, unknown>): string | null => {
  const value = context.renderValue();
  return value === null || value === undefined ? null : String(value);
};

// Whichever column the reader hid or moved first, one cell per row is enough for the heading to find it.
const isMarkerCell = <T extends { id: string }>(context: CellContext<T, unknown>): boolean => context.row.getVisibleCells()
  .find((cell) => cell.column.id !== EXPAND_COLUMN_ID && cell.column.id !== GROUP_COLUMN_ID)?.id === context.cell.id;

/** `DataTable` puts no attribute on a row, so a cell of each row carries its row's group for the heading to find. */
const withGroupMarker = <T extends { id: string }>(column: ColumnDefWithOptionsHeader<T, unknown>, groupOf: (row: T) => string): ColumnDefWithOptionsHeader<T, unknown> => ({
  ...column,
  cell: (context: CellContext<T, unknown>) => (
    <>
      {isMarkerCell(context) && <span hidden {...{ [ROW_GROUP_ATTRIBUTE]: groupOf(context.row.original) }} />}
      {flexRender(column.cell ?? valueAsText, context)}
    </>
  ),
});

interface SlottedRowProps {
  rowKey: string,
  domId?: string,
  /** A group's heading, rather than the content a row unfolds into. */
  heading?: boolean,
  onMounted: (rowKey: string, row: HTMLTableRowElement | null) => void,
  children: ReactNode,
}

/**
 * `DataTable` renders its body itself and takes no row of ours, so an unfolded row or a group's
 * heading is a `tr` this component owns, rendered through a portal and slotted in by `DataPageLayout`.
 */
const SlottedRow = ({ rowKey, domId, heading, onMounted, children }: SlottedRowProps): ReactNode => {
  const [{ row, cell }] = useState(() => {
    const tr = document.createElement('tr');
    if (domId !== undefined) {
      tr.id = domId;
    }
    if (heading === true) {
      tr.className = 'border-b border-border-light bg-elevation-heading';
      const th = document.createElement('th');
      th.scope = 'rowgroup';
      th.className = 'h-10 px-4 text-left font-normal';
      tr.append(th);
      return { row: tr, cell: th };
    }
    tr.className = 'border-b border-border-light';
    const td = document.createElement('td');
    td.style.padding = '0';
    tr.append(td);
    return { row: tr, cell: td };
  });
  // Re-running the effect below on a new callback would detach the row and drop the focus inside it.
  const onMountedRef = useRef(onMounted);
  useLayoutEffect(() => {
    onMountedRef.current = onMounted;
  });
  useLayoutEffect(() => {
    onMountedRef.current(rowKey, row);
    return () => {
      onMountedRef.current(rowKey, null);
      row.remove();
    };
  }, [row, rowKey]);
  return createPortal(children, cell);
};

/**
 * Table layout with column ordering persistence, pagination, optional row selection and bulk delete.
 */
interface BaseDataPageLayoutProps<T extends { id: string }, G extends string> {
  data: Array<T>,
  columns: Array<ColumnDefWithOptionsHeader<T, unknown>>,
  storageKey: string,
  /**
   * Keys the remembered sort apart from the rest of the table state. A caller whose default
   * ordering follows a mode of its own passes one key per mode, so switching modes lands on that
   * mode's default and on the sort chosen inside it, while the columns, the page size and the view
   * stay shared across modes.
   */
  sortingStorageKey?: string,
  /** No rows to show yet: skeleton rows stand in for them, and the empty state is held back. */
  isLoading?: boolean,
  /**
   * The rows on screen belong to the previous page, sort, filter or search, and the new ones are on
   * their way: the query's own `isPlaceholderData`, under `placeholderData: keepPreviousData`. The
   * rows dim and go inert, and a spinner shows by the pager. A background refetch of the same rows
   * leaves it false, and shows nothing. Left out, as by a client-paginated table, the pager reserves
   * no room for the spinner.
   */
  isPlaceholderData?: boolean,
  leftHeaderContent?: ReactNode,
  viewToggle?: ReactNode,
  headerActions?: ReactNode,
  onCreate?: () => void,
  onClickRow?: (row: { original: T }) => void,
  initialSorting?: Array<{ id: string, desc: boolean }>,
  /** Columns the table starts with hidden, keyed by column id. */
  initialColumnVisibility?: VisibilityState,
  selectionOptions?: DataTableSelectionConfig<T>,
  onDeleteItems?: (ids: Array<string>) => void | Promise<void>,
  /**
   * For server-paginated tables (`total` set). Seed the initial query with
   * `usePersistedPageSize(tableId, initialPageSize)`, reusing the exact same `tableId`
   * constant passed as `storageKey` below, to avoid a refetch on mount.
   */
  onServerPageChange?: (pagination: PaginationState) => void,
  /**
   * Drops the unsorted third state, which no server ordering can answer. The caller reads the
   * ordering from `usePersistedSorting(sortingStorageKey ?? storageKey, ...)`, the state the
   * headers draw from.
   */
  serverSorted?: boolean,
  initialPageSize?: number,
  enableSorting?: boolean,
  emptyState?: ReactNode,
  /**
   * Drops the count and the pager above the table, for a table set in a card whose own title says
   * how many rows it holds. It is ignored as soon as the rows outgrow one page, since the pager is
   * then the only way to reach the ones below it.
   */
  hideToolbar?: boolean,
  /**
   * Fits the table to the height its parent gives it: the rows scroll inside the table under a pinned
   * header, and the page around it does not scroll (Design standards s.3, one scroller). The parent
   * is a flex column with a bounded height, as a list page's root is.
   */
  fillHeight?: boolean,
  /**
   * Makes each column's `size` binding: the table is laid out fixed, so a header or a cell wider than
   * its column is clipped instead of growing the column. With the sizes adding up to the pane, the
   * table then never scrolls sideways (Design standards s.3); without it the browser grows a column
   * to its header's min-content and the sizes are only a floor.
   */
  fixedColumnWidths?: boolean,
  /**
   * Draws no pager at all and shows every row on one page, for a short table set in a card. It also
   * drops the toolbar: `hideToolbar` alone brings the pager back once the rows outgrow a page.
   */
  hidePagination?: boolean,
  /**
   * Leads each row with a chevron that unfolds it into content of its own. The row click stays the
   * row's, and the unfolded content takes no part in sorting, paging or selection.
   */
  expandableRows?: ExpandableRows<T>,
  /** Keeps the rows of a group together, under a heading, whatever the sort; for a client-sorted table. */
  rowGroups?: RowGroups<T, G>,
  /**
   * A search box leading the toolbar, matching the texts it names on each row (Design standards s.3).
   * For a list held whole: a server-paginated table (`total` set) searches on the server instead.
   */
  search?: DataPageSearch<T>,
  /** Typed filters drawn as filter pills after the search, with the active-filter count and Clear all; same scope as `search`. */
  filters?: ReadonlyArray<DataPageFilter<T>>,
  /**
   * For a list the caller narrows itself, a server-paginated table or rows filtered before they come in:
   * whether a search or a filter of its own is set, and how to lift them all. When nothing comes back
   * while one is set, the no-results card shows under the toolbar, wired to `onClearAll` (Design
   * standards s.3), as it does for the `search` and `filters` this layout holds.
   */
  callerFilters?: { active: boolean, onClearAll: () => void },
}

/**
 * A server-paginated table says how many rows the list holds (`total`), which page it is on and
 * whether the query behind it is fetching. A page past the last one `total` leaves is moved back to
 * it through `onServerPageChange`, which only `pageIndex` carries back into the table, and not
 * before the answer is fresh: a cached response for that page, kept from when the list was shorter,
 * arrives settled with a `total` that is stale. The query's own `isFetching` is for that check alone,
 * never for `isLoading` or `isPlaceholderData`, since a background refetch is not a load.
 */
export type DataPageLayoutPaging = {
  total: number | undefined,
  pageIndex: number,
  isFetching: boolean,
} | {
  total?: undefined,
  /** Required of a caller that resets the page itself, or the two page numbers drift. */
  pageIndex?: number,
  isFetching?: undefined,
};

type DataPageLayoutProps<T extends { id: string }, G extends string> = BaseDataPageLayoutProps<T, G> & DataPageLayoutPaging;

export const DataPageLayout = <T extends { id: string }, G extends string = string>({
  data: allData,
  total,
  isFetching,
  columns,
  isLoading,
  isPlaceholderData,
  storageKey,
  sortingStorageKey,
  leftHeaderContent,
  onCreate,
  viewToggle,
  headerActions,
  onClickRow,
  initialSorting,
  initialColumnVisibility,
  selectionOptions,
  onDeleteItems,
  onServerPageChange,
  serverSorted,
  pageIndex: controlledPageIndex,
  initialPageSize,
  enableSorting,
  emptyState,
  hideToolbar,
  fillHeight,
  fixedColumnWidths,
  hidePagination,
  expandableRows,
  rowGroups,
  search,
  filters,
  callerFilters,
}: DataPageLayoutProps<T, G>): ReactNode => {
  const defaultPageSize = initialPageSize ?? 50;
  const isSortingEnabled = enableSorting ?? true;
  const { pageSize, setPageSize } = usePersistedPageSize(storageKey, defaultPageSize);
  const [ownPageIndex, setOwnPageIndex] = useState(0);
  const pageIndex = controlledPageIndex ?? ownPageIndex;
  // A server-paginated list holds one page, so narrowing it here would hide rows of the others.
  const clientSide = total === undefined;
  const { rows: data, controls: filterControls, narrowed, clearAll: clearFilters } = useDataPageFilters(
    allData,
    clientSide ? search : undefined,
    clientSide ? filters : undefined,
    () => setOwnPageIndex(0),
  );
  const toolbarLeft = filterControls === null
    ? leftHeaderContent
    : (
      <>
        {filterControls}
        {leftHeaderContent}
      </>
    );
  const pagination: PaginationState = hidePagination === true ? { pageIndex: 0, pageSize: Math.max(data.length, 1) } : { pageIndex, pageSize };
  const showPending = useDelayedFlag(isPlaceholderData === true, { delay: PENDING_DELAY_MS, minDuration: PENDING_MIN_DURATION_MS });
  const pendingHostRef = useRef<HTMLDivElement>(null);

  // `DataTable` renders its own body and takes no attribute for it, so `inert` goes on through the DOM.
  useLayoutEffect(() => {
    const body = pendingHostRef.current?.querySelector('tbody');
    if (body) {
      body.inert = showPending;
    }
  }, [showPending]);

  const [expanded, setExpanded] = useState<ExpandedState>({});
  const subRowIdPrefix = useId();
  const subRowId = (rowId: string): string => `${subRowIdPrefix}-sub-row-${rowId}`;
  const subRowsRef = useRef(new Map<string, HTMLTableRowElement>());

  // React moves the rows it owns on a sort, a page change or new data and knows nothing of the
  // unfolded ones, so they are slotted back after their row, or out of a page that lost it.
  const placeSubRows = (): void => {
    const body = pendingHostRef.current?.querySelector('tbody');
    if (!body) {
      return;
    }
    body.querySelectorAll<HTMLElement>(`[${EXPANDED_ROW_ATTRIBUTE}]`).forEach((row) => {
      row.removeAttribute(EXPANDED_ROW_ATTRIBUTE);
      row.style.removeProperty('border-bottom-color');
    });
    const rows = new Map(Array.from(
      body.querySelectorAll<HTMLElement>(`[${SUB_ROW_TOGGLE_ATTRIBUTE}]`),
      (toggle) => [toggle.getAttribute(SUB_ROW_TOGGLE_ATTRIBUTE), toggle.closest('tr')],
    ));
    for (const [rowId, subRow] of subRowsRef.current) {
      const row = rows.get(rowId);
      if (!row) {
        subRow.remove();
        continue;
      }
      // The row and what it unfolds read as one block, closed by the unfolded row's own border.
      row.setAttribute(EXPANDED_ROW_ATTRIBUTE, '');
      row.style.borderBottomColor = 'transparent';
      subRow.cells[0].colSpan = row.cells.length;
      if (row.nextElementSibling !== subRow) {
        row.after(subRow);
      }
    }
  };

  // Placed on registration as well as on every commit: StrictMode remounts a new sub-row after this
  // component's own effect has run, and that remount detaches it once.
  const handleSubRowMounted = (rowId: string, subRow: HTMLTableRowElement | null): void => {
    if (subRow === null) {
      subRowsRef.current.delete(rowId);
    } else {
      subRowsRef.current.set(rowId, subRow);
    }
    placeSubRows();
  };

  const groupHeadersRef = useRef(new Map<string, HTMLTableRowElement>());

  // Before the first row of its group on the page, or out of a page holding none of it.
  const placeGroupHeaders = (): void => {
    const body = pendingHostRef.current?.querySelector('tbody');
    if (!body) {
      return;
    }
    const firstRowOf = new Map<string, HTMLTableRowElement>();
    body.querySelectorAll<HTMLElement>(`[${ROW_GROUP_ATTRIBUTE}]`).forEach((marker) => {
      const group = marker.getAttribute(ROW_GROUP_ATTRIBUTE);
      const row = marker.closest('tr');
      if (group !== null && row !== null && !firstRowOf.has(group)) {
        firstRowOf.set(group, row);
      }
    });
    for (const [group, header] of groupHeadersRef.current) {
      const row = firstRowOf.get(group);
      if (!row) {
        header.remove();
        continue;
      }
      header.cells[0].colSpan = row.cells.length;
      if (row.previousElementSibling !== header) {
        row.before(header);
      }
    }
  };

  const handleGroupHeaderMounted = (group: string, header: HTMLTableRowElement | null): void => {
    if (header === null) {
      groupHeadersRef.current.delete(group);
    } else {
      groupHeadersRef.current.set(group, header);
    }
    placeGroupHeaders();
  };

  useLayoutEffect(() => {
    if (expandableRows !== undefined) {
      placeSubRows();
    }
    if (rowGroups !== undefined) {
      placeGroupHeaders();
    }
  });

  // Computed outside of any setState updater so setPageSize/onServerPageChange never run as side effects of one.
  const handlePaginationChange = (updater: Updater<PaginationState>): void => {
    const next = typeof updater === 'function' ? updater(pagination) : updater;
    if (next.pageSize !== pageSize) {
      setPageSize(next.pageSize);
    }
    setOwnPageIndex(next.pageIndex);
    onServerPageChange?.(next);
  };

  // A refetch can shrink a server list below the page on screen, which then comes back empty: the
  // caller is sent to the list's last page instead.
  const lastPageIndex = Math.max(0, Math.ceil((total ?? 0) / pageSize) - 1);
  const isPastLastPage = total !== undefined && pageIndex > lastPageIndex && isPlaceholderData !== true && isLoading !== true && isFetching !== true;
  useEffect(() => {
    if (isPastLastPage) {
      onServerPageChange?.({ pageIndex: lastPageIndex, pageSize });
    }
  }, [isPastLastPage, lastPageIndex, onServerPageChange, pageSize]);

  const [selection, setSelection] = useState<SelectionState>({ selectAll: false, selectedIds: new Set(), excludedIds: new Set() });
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  const columnIds = columns.map((c) => c.id).filter((id): id is string => !!id);
  const { columnOrder, setColumnOrder, onResetTable } = useTableColumnOrdering(storageKey, columnIds);
  const { sorting, setSorting } = usePersistedSorting(sortingStorageKey ?? storageKey, initialSorting ?? ([] as SortingState));
  const tableSorting: SortingState = rowGroups === undefined ? sorting : [{ id: GROUP_COLUMN_ID, desc: false }, ...sorting];

  const handleSortingChange = (updater: Updater<SortingState>): void => {
    const next = (typeof updater === 'function' ? updater(tableSorting) : updater).filter((sort) => sort.id !== GROUP_COLUMN_ID);
    setSorting(next);
    // Page 3 of the old order is not page 3 of the new one.
    if (serverSorted) {
      setOwnPageIndex(0);
      onServerPageChange?.({ pageIndex: 0, pageSize });
    }
  };
  const { columnVisibility, setColumnVisibility } = usePersistedColumnVisibility(storageKey, initialColumnVisibility);

  const sortableColumns = isSortingEnabled && !serverSorted ? withTextAwareSorting(columns) : columns;
  const groupedColumns = rowGroups === undefined
    ? sortableColumns
    : [...sortableColumns.map((column) => withGroupMarker(column, rowGroups.groupOf)), groupColumn(rowGroups)];
  // The chevron column leads every row, and it and the group column stay out of the remembered order.
  const tableColumns = expandableRows === undefined ? groupedColumns : [expandColumn(expandableRows.toggleLabel, subRowId), ...groupedColumns];
  const tableColumnOrder = [
    ...(expandableRows === undefined ? [] : [EXPAND_COLUMN_ID]),
    ...columnOrder,
    ...(rowGroups === undefined ? [] : [GROUP_COLUMN_ID]),
  ];
  const handleColumnOrderChange = (updater: Updater<ColumnOrderState>): void => {
    const next = typeof updater === 'function' ? updater(tableColumnOrder) : updater;
    setColumnOrder(next.filter((id) => id !== EXPAND_COLUMN_ID && id !== GROUP_COLUMN_ID));
  };
  const tableColumnVisibility: VisibilityState = rowGroups === undefined ? columnVisibility : { ...columnVisibility, [GROUP_COLUMN_ID]: false };
  const handleColumnVisibilityChange = (updater: Updater<VisibilityState>): void => {
    const next = typeof updater === 'function' ? updater(tableColumnVisibility) : updater;
    setColumnVisibility(Object.fromEntries(Object.entries(next).filter(([id]) => id !== GROUP_COLUMN_ID)));
  };
  const groupCounts = rowGroups === undefined
    ? []
    : rowGroups.order
      .map((group) => ({ group, count: data.filter((item) => rowGroups.groupOf(item) === group).length }))
      .filter(({ count }) => count > 0);
  const unfolded = expandableRows === undefined
    ? []
    : data.filter((item) => (expanded === true || expanded[item.id] === true) && (expandableRows.canExpand?.(item) ?? true));

  const getSelectedIds = (): Array<string> => {
    if (selection.selectAll) {
      return data
        .filter((item) => !selection.excludedIds.has(item.id))
        .map((item) => item.id);
    }
    return Array.from(selection.selectedIds);
  };

  const builtInSelectionOptions: DataTableSelectionConfig<T> | undefined = onDeleteItems
    ? {
      selectionState: { state: selection, onSelectionChange: setSelection },
      selectionHeader: {
        actions: () => (
          <IconButton
            variant="destructive"
            priority="tertiary"
            icon={<Trash2 className="size-4" />}
            aria-label={t`Delete selected items`}
            onClick={() => setBulkDeleteOpen(true)}
          />
        ),
      },
    }
    : undefined;

  // A server-paginated table holds one page in `data`, so only `total` says whether a pager is owed.
  const showToolbar = hidePagination !== true && (hideToolbar !== true || (total ?? data.length) > pageSize);

  // `DataTable` draws a pager of its own when given no toolbar, so an empty one is what hides it.
  const toolbar = showToolbar ? (
    <DataPageToolbar
      dataLength={total ?? data.length}
      totalLength={narrowed ? allData.length : undefined}
      leftHeaderContent={toolbarLeft}
      pagination={isPlaceholderData === undefined
        ? <DataTableHeadBarOptions />
        : (
          <div className="flex shrink-0 items-center gap-2">
            {/* The slot stays when the spinner goes, so the pager never shifts. */}
            <span data-testid="data-table-pending-slot" className="flex size-4 shrink-0 items-center justify-center">
              {showPending && <Spinner size="sm" />}
            </span>
            <DataTableHeadBarOptions />
          </div>
        )}
      viewToggle={viewToggle}
      headerActions={headerActions}
      onCreate={onCreate}
    />
  ) : <></>;

  // Only a list with no row at all is empty: a page can come back empty while `total` still counts rows
  // (past the last page, or read in another statement than its count).
  // A search or a filter that matches nothing leaves the toolbar up, with its controls to undo it,
  // and says so under it with the shared no-results card.
  if (emptyState && !isLoading && allData.length === 0 && (total ?? 0) === 0 && callerFilters?.active !== true) {
    return (
      <div className="flex flex-col gap-4">
        {showToolbar && (
          <DataPageToolbar
            dataLength={allData.length}
            leftHeaderContent={leftHeaderContent}
            viewToggle={viewToggle}
            headerActions={headerActions}
            onCreate={onCreate}
          />
        )}
        {emptyState}
      </div>
    );
  }

  const table = (
    <div
      ref={pendingHostRef}
      className={cn(
        'data-table-pending-host',
        showPending && 'data-table-pending',
        fixedColumnWidths === true && 'data-table-fixed-columns [&_table]:table-fixed',
        // The flex chain down to the table's own scroller, which `sticky` sizes to its parent.
        fillHeight === true && 'flex min-h-0 flex-1 flex-col [&_.twp]:flex [&_.twp]:min-h-0 [&_.twp]:flex-1 [&_.twp]:flex-col [&_.twp>div:last-child]:min-h-0 [&_.twp>div:last-child]:flex-1',
      )}
      aria-busy={showPending || undefined}
    >
      <DataTable
        i18nKey={getDataTableI18nKey()}
        data={data}
        columns={tableColumns}
        isLoading={isLoading}
        toolbar={toolbar}
        tableOptions={{
          ...(isSortingEnabled
            ? {
              onSortingChange: handleSortingChange,
              ...(serverSorted
                ? { manualSorting: true, enableSortingRemoval: false }
                : { getSortedRowModel: getSortedRowModel() }),
            }
            : { enableSorting: false }),
          getPaginationRowModel: getPaginationRowModel(),
          onPaginationChange: handlePaginationChange,
          onColumnOrderChange: expandableRows === undefined && rowGroups === undefined ? setColumnOrder : handleColumnOrderChange,
          onColumnVisibilityChange: rowGroups === undefined ? setColumnVisibility : handleColumnVisibilityChange,
          ...(total !== undefined ? { rowCount: total, manualPagination: true } : {}),
          ...(expandableRows === undefined ? {} : {
            getRowCanExpand: (row: Row<T>) => expandableRows.canExpand?.(row.original) ?? true,
            onExpandedChange: setExpanded,
          }),
        }}
        onClickRow={onClickRow}
        onResetTable={onResetTable}
        tableState={{
          pagination,
          columnOrder: tableColumnOrder,
          columnVisibility: tableColumnVisibility,
          ...(isSortingEnabled ? { sorting: tableSorting } : {}),
          ...(expandableRows === undefined ? {} : { expanded }),
        }}
        selectionOptions={selectionOptions ?? builtInSelectionOptions}
        sticky={fillHeight === true}
      />
    </div>
  );
  // Outside the busy wrapper, which would silence it, and mounted before its text changes, which a
  // screen reader needs to announce it. A labelled `Spinner` meets neither, hence this status of its own.
  const pendingStatus = isPlaceholderData !== undefined && <span role="status" className="sr-only">{showPending ? t`Loading` : ''}</span>;

  const Host = fillHeight === true ? FillHeightHost : Fragment;
  // A server-paginated page can come back empty while `total` still counts rows (past the last page):
  // only a list that holds no row at all under a set search or filter has no result.
  const callerNarrowed = callerFilters?.active === true && (total ?? 0) === 0;
  const noResults = (narrowed || callerNarrowed) && !isLoading && data.length === 0;
  const clearAllFilters = (): void => {
    if (narrowed) {
      clearFilters();
    }
    if (callerFilters?.active === true) {
      callerFilters.onClearAll();
    }
  };

  return (
    <Host>
      {showToolbar
        ? table
        // `.twp`, the table's own outermost class, carries a top margin that spaces it from the
        // toolbar. With no toolbar it is a gap under the card's title and under nothing else.
        // With `fillHeight` it carries the flex chain too, or the table would stop fitting.
        : <div className={cn('[&_.twp]:mt-0', fillHeight === true && 'flex min-h-0 flex-1 flex-col')}>{table}</div>}
      {noResults && (
        <div className="mt-4" data-testid="data-page-no-results">
          <ListNoResults onClearFilters={clearAllFilters} />
        </div>
      )}
      {pendingStatus}
      {unfolded.map((item) => (
        <SlottedRow key={item.id} rowKey={item.id} domId={subRowId(item.id)} onMounted={handleSubRowMounted}>
          {expandableRows?.render(item)}
        </SlottedRow>
      ))}
      {groupCounts.map(({ group, count }) => (
        <SlottedRow key={group} rowKey={group} heading onMounted={handleGroupHeaderMounted}>
          {rowGroups?.renderHeader(group, count)}
        </SlottedRow>
      ))}
      {onDeleteItems && (
        <DeleteConfirmDialog
          open={bulkDeleteOpen}
          onOpenChange={setBulkDeleteOpen}
          onConfirm={async () => {
            await onDeleteItems(getSelectedIds());
            setSelection({ selectAll: false, selectedIds: new Set(), excludedIds: new Set() });
            setBulkDeleteOpen(false);
          }}
          title={<Trans>Delete selected items</Trans>}
          description={<Trans>This will permanently delete the selected items. This action cannot be undone.</Trans>}
        />
      )}
    </Host>
  );
};

const FillHeightHost = ({ children }: { children: ReactNode }): ReactNode => (
  <div data-testid="data-page-fill-height" className="flex min-h-0 flex-1 flex-col">{children}</div>
);

/**
 * Card grid layout with a toolbar showing entity count.
 */
interface DataPageCardLayoutProps<T extends { id: string }> {
  data: Array<T>,
  renderCard: (item: T) => ReactNode,
  isLoading?: boolean,
  leftHeaderContent?: ReactNode,
  viewToggle?: ReactNode,
  headerActions?: ReactNode,
  onCreate?: () => void,
  emptyState?: ReactNode,
}

export const DataPageCardLayout = <T extends { id: string }>({
  data,
  renderCard,
  isLoading,
  leftHeaderContent,
  viewToggle,
  headerActions,
  onCreate,
  emptyState,
}: DataPageCardLayoutProps<T>): ReactNode => {
  const toolbar = (
    <DataPageToolbar
      dataLength={data.length}
      leftHeaderContent={leftHeaderContent}
      viewToggle={viewToggle}
      headerActions={headerActions}
      onCreate={onCreate}
    />
  );

  if (isLoading) {
    return <>{toolbar}</>;
  }

  if (emptyState && data.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {toolbar}
        {emptyState}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {toolbar}
      <DataPageGrid>
        {data.map((item) => renderCard(item))}
      </DataPageGrid>
    </div>
  );
};

/**
 * Composite layout that switches between table and card grid views via a built-in toggle.
 */
interface DataPageWithCardsProps<T extends { id: string }> {
  data: Array<T>,
  columns: Array<ColumnDefWithOptionsHeader<T, unknown>>,
  isLoading?: boolean,
  storageKey: string,
  renderCard: (item: T) => ReactNode,
  defaultView?: 'grid' | 'table',
  leftHeaderContent?: ReactNode,
  headerActions?: ReactNode,
  onCreate?: () => void,
  onClickRow?: (row: { original: T }) => void,
  initialSorting?: Array<{ id: string, desc: boolean }>,
  initialColumnVisibility?: VisibilityState,
  selectionOptions?: DataTableSelectionConfig<T>,
  onDeleteItems?: (ids: Array<string>) => void | Promise<void>,
  emptyState?: ReactNode,
}

export const DataPageWithCards = <T extends { id: string }>({
  data,
  columns,
  isLoading,
  storageKey,
  renderCard,
  defaultView: defaultViewProp,
  leftHeaderContent,
  headerActions,
  onCreate,
  onClickRow,
  initialSorting,
  initialColumnVisibility,
  selectionOptions,
  onDeleteItems,
  emptyState,
}: DataPageWithCardsProps<T>): ReactNode => {
  const defaultView = defaultViewProp ?? 'table';
  const { view, setView } = usePersistedView(storageKey, defaultView, ['table', 'grid']);
  const isGrid = view === 'grid';

  const viewItems: Array<IconButtonGroupItem<'grid' | 'table'>> = [
    { value: 'table', icon: <List className="h-4 w-4" />, tooltip: t`Lines view` },
    { value: 'grid', icon: <LayoutGrid className="h-4 w-4" />, tooltip: t`Cards view` },
  ];

  const viewToggle = <IconButtonGroup items={viewItems} value={view} onChange={setView} />;

  if (isGrid) {
    return (
      <DataPageCardLayout
        data={data}
        renderCard={renderCard}
        isLoading={isLoading}
        leftHeaderContent={leftHeaderContent}
        viewToggle={viewToggle}
        headerActions={headerActions}
        onCreate={onCreate}
        emptyState={emptyState}
      />
    );
  }

  return (
    <DataPageLayout
      data={data}
      columns={columns}
      isLoading={isLoading}
      storageKey={storageKey}
      leftHeaderContent={leftHeaderContent}
      onCreate={onCreate}
      viewToggle={viewToggle}
      headerActions={headerActions}
      onClickRow={onClickRow}
      initialSorting={initialSorting}
      initialColumnVisibility={initialColumnVisibility}
      selectionOptions={selectionOptions}
      onDeleteItems={onDeleteItems}
      emptyState={emptyState}
    />
  );
};

/**
 * Composite layout that switches between a data table (showing only matched TTPs)
 * and the full MITRE ATT&CK matrix with highlighting.
 */
interface DataPageWithTtpMatrixProps<T extends { id: string }> {
  data: Array<T>,
  columns: Array<ColumnDefWithOptionsHeader<T, unknown>>,
  storageKey: string,
  /** See `DataPageLayoutProps`: one key per mode when the caller's default ordering follows one. */
  sortingStorageKey?: string,
  highlightedTechniques: Array<HighlightedTechnique>,
  defaultColor?: HighlightColor,
  isLoading?: boolean,
  defaultView?: 'table' | 'matrix',
  leftHeaderContent?: ReactNode,
  headerActions?: ReactNode,
  onCreate?: () => void,
  onClickRow?: (row: { original: T }) => void,
  initialSorting?: Array<{ id: string, desc: boolean }>,
  /**
   * Segmented counts rendered in the toolbar. The caller owns both the counts and the narrowing:
   * it passes already-filtered `data` and `highlightedTechniques` for the active key.
   */
  segments?: Array<SegmentedCount>,
  activeSegment?: string,
  onSegmentChange?: (key: string) => void,
  segmentsLabel?: string,
  /**
   * Collapse the matrix to the highlighted techniques regardless of the user's toggle. A caller
   * whose active segment narrows the population passes it, or the cells outside the segment would
   * stay visible and the segment would filter the table view only. The manual toggle hides while
   * forced, since it could no longer do anything.
   */
  forceHighlightedOnly?: boolean,
  /** Absent from the table view: for what only the matrix needs said. */
  matrixFooter?: ReactNode,
  /** Absent from the table view, above the matrix: a legend of what its cells carry. */
  matrixHeader?: ReactNode,
  /** The tactics whose columns the matrix keeps, by tactic id; left out, it keeps them all. */
  matrixTacticIds?: ReadonlyArray<string>,
  initialPageSize?: number,
}

export const DataPageWithTtpMatrix = <T extends { id: string }>({
  data,
  columns,
  storageKey,
  sortingStorageKey,
  highlightedTechniques,
  defaultColor: defaultColorProp,
  isLoading,
  defaultView: defaultViewProp,
  leftHeaderContent,
  headerActions,
  onCreate,
  onClickRow,
  initialSorting,
  segments,
  activeSegment,
  onSegmentChange,
  segmentsLabel,
  forceHighlightedOnly,
  matrixFooter,
  matrixHeader,
  matrixTacticIds,
  initialPageSize,
}: DataPageWithTtpMatrixProps<T>): ReactNode => {
  const defaultColor = defaultColorProp ?? 'red';
  const defaultView = defaultViewProp ?? 'matrix';
  const { view, setView } = usePersistedView(storageKey, defaultView, ['table', 'matrix']);
  const [filterHighlightedOnly, setFilterHighlightedOnly] = useState(false);

  const viewItems: Array<IconButtonGroupItem<'table' | 'matrix'>> = [
    { value: 'matrix', icon: <Columns3 className="h-4 w-4" />, tooltip: t`Matrix view` },
    { value: 'table', icon: <List className="h-4 w-4" />, tooltip: t`List view` },
  ];

  const viewToggle = <IconButtonGroup items={viewItems} value={view} onChange={setView} />;

  const hasHighlighted = highlightedTechniques.length > 0;
  const isHighlightedOnly = filterHighlightedOnly || forceHighlightedOnly === true;

  const filterToggle = hasHighlighted && view === 'matrix' && forceHighlightedOnly !== true
    ? <HighlightFilterToggle active={filterHighlightedOnly} onToggle={() => setFilterHighlightedOnly((prev) => !prev)} />
    : null;

  const combinedViewToggle = filterToggle
    ? (
      <div className="flex items-center gap-2">
        {filterToggle}
        {viewToggle}
      </div>
    )
    : viewToggle;

  const combinedLeftContent = segments !== undefined && activeSegment !== undefined && onSegmentChange !== undefined
    ? (
      <>
        <SegmentedCounts
          segments={segments}
          value={activeSegment}
          onChange={onSegmentChange}
          ariaLabel={segmentsLabel ?? t`Filter by result`}
        />
        {leftHeaderContent}
      </>
    )
    : leftHeaderContent;

  if (view === 'matrix') {
    return (
      <div className="flex flex-col gap-4">
        <DataPageToolbar
          dataLength={data.length}
          leftHeaderContent={combinedLeftContent}
          viewToggle={combinedViewToggle}
          headerActions={headerActions}
          onCreate={onCreate}
        />
        {matrixHeader}
        <TtpMatrixView
          highlightedTechniques={highlightedTechniques}
          defaultColor={defaultColor}
          isLoading={isLoading}
          filterHighlightedOnly={isHighlightedOnly}
          tacticIds={matrixTacticIds}
        />
        {matrixFooter}
      </div>
    );
  }

  return (
    <DataPageLayout
      data={data}
      columns={columns}
      isLoading={isLoading}
      storageKey={storageKey}
      sortingStorageKey={sortingStorageKey}
      leftHeaderContent={combinedLeftContent}
      onCreate={onCreate}
      viewToggle={combinedViewToggle}
      headerActions={headerActions}
      onClickRow={onClickRow}
      initialSorting={initialSorting}
      initialPageSize={initialPageSize}
    />
  );
};
