/** @vitest-environment jsdom */
import type { ColumnDefWithOptionsHeader } from '@filigran/ui';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataPageLayout } from './data-page-layout';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});

interface Row {
  id: string,
  name: string,
}

const ROWS: Array<Row> = [{ id: '1', name: 'Core banking' }, { id: '2', name: 'Payment gateway' }];

const COLUMNS: Array<ColumnDefWithOptionsHeader<Row, unknown>> = [
  { id: 'name', accessorKey: 'name', header: 'Name' },
];

const renderLayout = (isPlaceholderData?: boolean) => render(
  <DataPageLayout
    data={ROWS}
    total={200}
    pageIndex={0}
    isFetching={false}
    columns={COLUMNS}
    storageKey="data-page-layout-test"
    isPlaceholderData={isPlaceholderData}
  />,
);

const advance = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

// The table carries status regions of its own, so the announcement is told apart by what it says.
const loadingAnnouncement = () => screen.queryAllByRole('status').find((status) => status.textContent === 'Loading');

// What a reader of the page gets: an assistive technology's view and the visible loading marks.
const pendingState = (container: HTMLElement) => ({
  busy: container.querySelector('[aria-busy="true"]') !== null,
  dimmed: container.querySelector('.data-table-pending') !== null,
  inert: container.querySelector('tbody')?.inert === true,
  announced: loadingAnnouncement() !== undefined,
  spinner: (screen.queryByTestId('data-table-pending-slot')?.childElementCount ?? 0) > 0,
});

const IDLE = { busy: false, dimmed: false, inert: false, announced: false, spinner: false };
const PENDING = { busy: true, dimmed: true, inert: true, announced: true, spinner: true };

describe('DataPageLayout loading state', () => {
  it('should show nothing while the next rows answer within the delay', () => {
    const { container, rerender } = renderLayout(false);

    rerender(<DataPageLayout data={ROWS} total={200} pageIndex={0} isFetching={false} columns={COLUMNS} storageKey="data-page-layout-test" isPlaceholderData />);
    advance(249);
    expect(pendingState(container)).toEqual(IDLE);

    rerender(<DataPageLayout data={ROWS} total={200} pageIndex={0} isFetching={false} columns={COLUMNS} storageKey="data-page-layout-test" isPlaceholderData={false} />);
    advance(1000);
    expect(pendingState(container)).toEqual(IDLE);
  });

  it('should mark the rows busy and inert, show the spinner and announce the load once the delay has passed', () => {
    const { container } = renderLayout(true);

    advance(250);

    expect(pendingState(container)).toEqual(PENDING);
  });

  it('should keep the loading state for the minimum duration after the rows arrive, then clear it', () => {
    const { container, rerender } = renderLayout(true);
    advance(250);

    rerender(<DataPageLayout data={ROWS} total={200} pageIndex={0} isFetching={false} columns={COLUMNS} storageKey="data-page-layout-test" isPlaceholderData={false} />);
    advance(199);
    expect(pendingState(container)).toEqual(PENDING);

    advance(1);
    expect(pendingState(container)).toEqual(IDLE);
  });

  it('should keep the announcement outside the busy region, where a screen reader would silence it', () => {
    const { container } = renderLayout(true);
    advance(250);

    const announcement = loadingAnnouncement();
    expect(announcement).toBeDefined();
    expect(container.querySelector('[aria-busy="true"]')?.contains(announcement ?? null)).toBe(false);
  });

  it('should reserve the spinner slot and the announcement only on a table that reports placeholder rows', () => {
    renderLayout(false);
    expect(screen.queryByTestId('data-table-pending-slot')).not.toBeNull();
    const reportingStatuses = screen.queryAllByRole('status').length;
    cleanup();

    renderLayout();
    expect(screen.queryByTestId('data-table-pending-slot')).toBeNull();
    expect(screen.queryAllByRole('status')).toHaveLength(reportingStatuses - 1);
  });

  it('should never show a loading state for a table that does not report placeholder rows', () => {
    const { container } = renderLayout();

    advance(5000);

    expect(pendingState(container)).toEqual(IDLE);
  });
});

describe('DataPageLayout hideToolbar', () => {
  it('should show no pager while every row fits on one page', () => {
    render(<DataPageLayout data={ROWS} columns={COLUMNS} storageKey="data-page-layout-test" hideToolbar />);

    expect(screen.queryByRole('button', { name: 'Go to previous page' })).toBeNull();
  });

  it('should bring the pager back once the rows outgrow one page', () => {
    render(<DataPageLayout data={ROWS} total={200} pageIndex={0} isFetching={false} columns={COLUMNS} storageKey="data-page-layout-test" initialPageSize={2} hideToolbar />);

    expect(screen.queryByRole('button', { name: 'Go to previous page' })).not.toBeNull();
  });
});

describe('DataPageLayout fillHeight', () => {
  it('should fit the table to its parent, with the rows scrolling under a pinned header', () => {
    const { container } = render(<DataPageLayout data={ROWS} columns={COLUMNS} storageKey="data-page-layout-test" fillHeight />);

    expect(screen.getByTestId('data-page-fill-height').className).toContain('min-h-0');
    expect(container.querySelector('th')?.className).toContain('sticky');
  });

  it('should keep fitting the table when the toolbar is hidden', () => {
    const { container } = render(<DataPageLayout data={ROWS} columns={COLUMNS} storageKey="data-page-layout-test" fillHeight hideToolbar />);

    const wrapper = screen.getByTestId('data-page-fill-height').firstElementChild;
    expect(wrapper?.className).toContain('flex-1');
    expect(wrapper?.className).toContain('min-h-0');
    expect(container.querySelector('th')?.className).toContain('sticky');
  });

  it('should leave the table to the page scroll by default', () => {
    const { container } = render(<DataPageLayout data={ROWS} columns={COLUMNS} storageKey="data-page-layout-test" />);

    expect(screen.queryByTestId('data-page-fill-height')).toBeNull();
    expect(container.querySelector('th')?.className).not.toContain('sticky');
  });
});

describe('DataPageLayout fixedColumnWidths', () => {
  const SIZED: Array<ColumnDefWithOptionsHeader<Row, unknown>> = [{ id: 'name', accessorKey: 'name', header: 'Name', size: 120 }];

  it('should lay the table out fixed, so a header cannot grow its column past its size', () => {
    const { container } = render(<DataPageLayout data={ROWS} columns={SIZED} storageKey="data-page-layout-test" fixedColumnWidths />);

    expect(container.querySelector('.data-table-fixed-columns')?.className).toContain('[&_table]:table-fixed');
    expect(container.querySelector('th')?.style.width).toBe('120px');
  });

  it('should leave the table layout to the browser by default', () => {
    const { container } = render(<DataPageLayout data={ROWS} columns={SIZED} storageKey="data-page-layout-test" />);

    expect(container.querySelector('.data-table-fixed-columns')).toBeNull();
  });
});

describe('DataPageLayout expandable rows', () => {
  const renderExpandable = (onClickRow = vi.fn()) => render(
    <DataPageLayout
      data={ROWS}
      columns={COLUMNS}
      storageKey="data-page-layout-expand-test"
      initialSorting={[{ id: 'name', desc: false }]}
      onClickRow={onClickRow}
      expandableRows={{
        render: (row) => <p>{`Details of ${row.name}`}</p>,
        canExpand: (row) => row.id === '1',
        toggleLabel: (row) => `Show ${row.name}`,
      }}
    />,
  );

  const bodyRows = (container: HTMLElement) => Array.from(container.querySelectorAll('tbody > tr'));

  it('should offer the chevron only on the rows that have something to unfold', () => {
    renderExpandable();

    expect(screen.getByRole('button', { name: 'Show Core banking' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Show Payment gateway' })).toBeNull();
  });

  it('should unfold the row under itself, across every column, and fold it back', () => {
    const { container } = renderExpandable();
    const toggle = screen.getByRole('button', { name: 'Show Core banking' });

    fireEvent.click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const rows = bodyRows(container);
    expect(rows.map((row) => row.textContent)).toEqual(['Core banking', 'Details of Core banking', 'Payment gateway']);
    expect(rows[1].querySelector('td')?.colSpan).toBe(rows[0].querySelectorAll('td').length);

    fireEvent.click(toggle);

    expect(screen.queryByText('Details of Core banking')).toBeNull();
    expect(bodyRows(container)).toHaveLength(2);
  });

  it('should unfold on the first click under StrictMode, whose second mount detaches the content once', () => {
    const { container } = render(
      <StrictMode>
        <DataPageLayout
          data={ROWS}
          columns={COLUMNS}
          storageKey="data-page-layout-strict-test"
          expandableRows={{ render: (row) => <p>{`Details of ${row.name}`}</p>, toggleLabel: (row) => `Show ${row.name}` }}
        />
      </StrictMode>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show Core banking' }));

    expect(bodyRows(container).map((row) => row.textContent)).toContain('Details of Core banking');
  });

  it('should name the chevron column, and point the chevron at the row it unfolds', () => {
    renderExpandable();
    const toggle = screen.getByRole('button', { name: 'Show Core banking' });

    expect(screen.getByRole('columnheader', { name: 'Expand' })).toBeTruthy();
    expect(toggle.getAttribute('aria-controls')).toBeNull();

    fireEvent.click(toggle);

    const controlled = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
    expect(controlled?.textContent).toBe('Details of Core banking');
  });

  it('should keep the focus inside the unfolded content when the table renders again', () => {
    const layout = (rows: Array<Row>) => (
      <DataPageLayout
        data={rows}
        columns={COLUMNS}
        storageKey="data-page-layout-focus-test"
        expandableRows={{ render: (row) => <input aria-label={`Note on ${row.name}`} />, toggleLabel: (row) => `Show ${row.name}` }}
      />
    );
    const { rerender } = render(layout(ROWS));
    fireEvent.click(screen.getByRole('button', { name: 'Show Core banking' }));
    const input = screen.getByRole('textbox', { name: 'Note on Core banking' });
    input.focus();

    rerender(layout([...ROWS]));

    expect(document.activeElement).toBe(input);
  });

  it('should keep the unfolded content under its row when the rows are sorted again', () => {
    const { container } = renderExpandable();
    fireEvent.click(screen.getByRole('button', { name: 'Show Core banking' }));

    fireEvent.click(screen.getByText('Name'));

    expect(bodyRows(container).map((row) => row.textContent)).toEqual(['Payment gateway', 'Core banking', 'Details of Core banking']);
  });

  it('should leave the row click to the row, and the chevron click to the chevron', () => {
    const onClickRow = vi.fn();
    renderExpandable(onClickRow);

    fireEvent.click(screen.getByRole('button', { name: 'Show Core banking' }));
    expect(onClickRow).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Core banking'));
    expect(onClickRow).toHaveBeenCalledWith(expect.objectContaining({ original: ROWS[0] }));
  });

  it('should add no column to a table that does not unfold its rows', () => {
    const { container } = render(<DataPageLayout data={ROWS} columns={COLUMNS} storageKey="data-page-layout-plain-test" />);

    expect(bodyRows(container)[0].querySelectorAll('td')).toHaveLength(1);
  });
});

describe('DataPageLayout row groups', () => {
  interface GroupedRow {
    id: string,
    name: string,
    domain: 'endpoints' | 'network',
    reviewedOn: Date,
  }

  const reviewedOn = new Date('2026-10-01T00:00:00.000Z');
  const GROUPED_ROWS: Array<GroupedRow> = [
    { id: '1', name: 'Delta', domain: 'network', reviewedOn },
    { id: '2', name: 'Alpha', domain: 'endpoints', reviewedOn },
    { id: '3', name: 'Charlie', domain: 'network', reviewedOn },
    { id: '4', name: 'Bravo', domain: 'endpoints', reviewedOn },
  ];
  const GROUPED_COLUMNS: Array<ColumnDefWithOptionsHeader<GroupedRow, unknown>> = [
    { id: 'name', accessorKey: 'name', header: 'Name' },
  ];

  const renderGrouped = (storageKey: string, props: { columns?: Array<ColumnDefWithOptionsHeader<GroupedRow, unknown>>, initialPageSize?: number } = {}) => render(
    <DataPageLayout
      data={GROUPED_ROWS}
      columns={props.columns ?? GROUPED_COLUMNS}
      initialPageSize={props.initialPageSize}
      storageKey={storageKey}
      rowGroups={{
        groupOf: (row) => row.domain,
        order: ['endpoints', 'network'],
        renderHeader: (domain, count) => `${domain} · ${count}`,
      }}
    />,
  );

  const bodyRows = (container: HTMLElement) => Array.from(container.querySelectorAll('tbody > tr')).map((row) => row.textContent);

  it('should head each group with its count, in the given order, its rows in the order they came', () => {
    const { container } = renderGrouped('data-page-layout-groups-order');

    expect(bodyRows(container)).toEqual(['endpoints · 2', 'Alpha', 'Bravo', 'network · 2', 'Delta', 'Charlie']);
    const heading = container.querySelector('tbody th');
    expect(heading?.getAttribute('scope')).toBe('rowgroup');
  });

  it('should sort within each group, both ways, and keep the groups in their order', () => {
    const { container } = renderGrouped('data-page-layout-groups-sort');

    fireEvent.click(screen.getByText('Name'));
    expect(bodyRows(container)).toEqual(['endpoints · 2', 'Alpha', 'Bravo', 'network · 2', 'Charlie', 'Delta']);

    fireEvent.click(screen.getByText('Name'));
    expect(bodyRows(container)).toEqual(['endpoints · 2', 'Bravo', 'Alpha', 'network · 2', 'Delta', 'Charlie']);
  });

  it('should head a group again on the next page it reaches, with the count of the whole group', () => {
    const { container } = renderGrouped('data-page-layout-groups-pages', { initialPageSize: 3 });

    expect(bodyRows(container)).toEqual(['endpoints · 2', 'Alpha', 'Bravo', 'network · 2', 'Delta']);

    fireEvent.click(screen.getByRole('button', { name: 'Go to next page' }));
    expect(bodyRows(container)).toEqual(['network · 2', 'Charlie']);
  });

  it('should head the groups of rows that unfold, whose leading chevron cell is not a column of theirs', () => {
    const { container } = render(
      <DataPageLayout
        data={GROUPED_ROWS}
        columns={GROUPED_COLUMNS}
        storageKey="data-page-layout-groups-expandable"
        rowGroups={{ groupOf: (row) => row.domain, order: ['endpoints', 'network'], renderHeader: (domain, count) => `${domain} · ${count}` }}
        expandableRows={{ render: (row) => row.name, toggleLabel: (row) => `Show ${row.name}` }}
      />,
    );

    expect(bodyRows(container)).toEqual(['endpoints · 2', 'Alpha', 'Bravo', 'network · 2', 'Delta', 'Charlie']);
  });

  it('should draw a column that declares no cell as text, as an ungrouped table does', () => {
    const { container } = renderGrouped('data-page-layout-groups-cell', { columns: [{ id: 'reviewedOn', accessorKey: 'reviewedOn', header: 'Reviewed on' }] });

    expect(bodyRows(container)[1]).toBe(String(reviewedOn));
  });
});

describe('DataPageLayout pagination', () => {
  const manyRows: Array<Row> = Array.from({ length: 60 }, (_, index) => ({ id: String(index), name: `Scope ${index}` }));
  const pager = () => screen.queryByRole('button', { name: 'Go to previous page' });

  it('should draw no pager and show every row on a table that hides its pagination', () => {
    render(<DataPageLayout data={manyRows} columns={COLUMNS} storageKey="data-page-layout-no-pager" hidePagination />);

    expect(pager()).toBeNull();
    expect(screen.getByText('Scope 0')).toBeTruthy();
    expect(screen.getByText('Scope 59')).toBeTruthy();
  });

  it('should count the rows of every page, not the ones of the page shown', () => {
    renderLayout(false);

    expect(screen.getByText('200 entities')).toBeTruthy();
  });

  describe('when a refetch shrinks the list below the page on screen', () => {
    interface PageProps { data: Array<Row>, total: number, pageIndex: number, isPlaceholderData: boolean, isFetching?: boolean }
    const renderPage = (props: PageProps, onServerPageChange = vi.fn()) => {
      const ui = ({ isFetching = false, ...next }: PageProps) => (
        <DataPageLayout
          {...next}
          isFetching={isFetching}
          columns={COLUMNS}
          storageKey="data-page-layout-shrunk"
          initialPageSize={50}
          onServerPageChange={onServerPageChange}
          emptyState={<p>No scope yet.</p>}
        />
      );
      const view = render(ui(props));
      return { onServerPageChange, rerender: (next: PageProps) => view.rerender(ui(next)) };
    };

    it('should move to the last page and never claim the list is empty', () => {
      const { onServerPageChange } = renderPage({ data: [], total: 50, pageIndex: 1, isPlaceholderData: false });

      expect(onServerPageChange).toHaveBeenCalledWith({ pageIndex: 0, pageSize: 50 });
      expect(screen.queryByText('No scope yet.')).toBeNull();
    });

    it('should wait for the rows of the page it asked for before moving', () => {
      const { onServerPageChange, rerender } = renderPage({ data: [], total: 50, pageIndex: 1, isPlaceholderData: true, isFetching: true });
      expect(onServerPageChange).not.toHaveBeenCalled();

      rerender({ data: ROWS, total: 52, pageIndex: 1, isPlaceholderData: false });
      expect(onServerPageChange).not.toHaveBeenCalled();
    });

    it('should wait for a page read from the cache to be fetched again, since its total is the one of before', () => {
      const { onServerPageChange, rerender } = renderPage({ data: [], total: 44, pageIndex: 1, isPlaceholderData: false, isFetching: true });
      expect(onServerPageChange).not.toHaveBeenCalled();

      rerender({ data: ROWS, total: 64, pageIndex: 1, isPlaceholderData: false });
      expect(onServerPageChange).not.toHaveBeenCalled();
    });

    it('should move to the first page of a list that lost every row', () => {
      const { onServerPageChange } = renderPage({ data: [], total: 0, pageIndex: 2, isPlaceholderData: false });

      expect(onServerPageChange).toHaveBeenCalledWith({ pageIndex: 0, pageSize: 50 });
    });

    it('should not claim the list is empty while the rows on screen carry the count of another query', () => {
      renderPage({ data: [], total: 49, pageIndex: 0, isPlaceholderData: true, isFetching: true });

      expect(screen.queryByText('No scope yet.')).toBeNull();
    });

    it('should not claim the list is empty when its page comes back empty while the count still holds rows', () => {
      const { onServerPageChange } = renderPage({ data: [], total: 51, pageIndex: 1, isPlaceholderData: false });

      expect(onServerPageChange).not.toHaveBeenCalled();
      expect(screen.queryByText('No scope yet.')).toBeNull();
    });

    it('should not move while the list has not answered yet', () => {
      const onServerPageChange = vi.fn();
      render(
        <DataPageLayout
          data={[]}
          total={0}
          pageIndex={2}
          isFetching
          isLoading
          columns={COLUMNS}
          storageKey="data-page-layout-shrunk"
          initialPageSize={50}
          onServerPageChange={onServerPageChange}
        />,
      );

      expect(onServerPageChange).not.toHaveBeenCalled();
    });

    it('should leave a client-paginated table, which has no total, where it is', () => {
      const onServerPageChange = vi.fn();
      render(
        <DataPageLayout
          data={[]}
          pageIndex={2}
          columns={COLUMNS}
          storageKey="data-page-layout-client"
          initialPageSize={50}
          onServerPageChange={onServerPageChange}
          emptyState={<p>No scope yet.</p>}
        />,
      );

      expect(onServerPageChange).not.toHaveBeenCalled();
      expect(screen.getByText('No scope yet.')).toBeTruthy();
    });

    it('should still show the empty state of a list that has no row at all', () => {
      const { onServerPageChange } = renderPage({ data: [], total: 0, pageIndex: 0, isPlaceholderData: false });

      expect(onServerPageChange).not.toHaveBeenCalled();
      expect(screen.getByText('No scope yet.')).toBeTruthy();
    });
  });
});

interface RuleRow {
  id: string,
  name: string,
  enabled: boolean,
}

const RULES: Array<RuleRow> = [
  { id: '1', name: 'Core banking', enabled: true },
  { id: '2', name: 'Payment gateway', enabled: false },
  { id: '3', name: 'École network', enabled: true },
];

const RULE_COLUMNS: Array<ColumnDefWithOptionsHeader<RuleRow, unknown>> = [
  { id: 'name', accessorKey: 'name', header: 'Name' },
];

const renderSearchable = () => render(
  <DataPageLayout
    data={RULES}
    columns={RULE_COLUMNS}
    storageKey="data-page-layout-search"
    emptyState={<p>No rules yet.</p>}
    search={{ placeholder: 'Search rules', texts: (rule) => [rule.name] }}
    filters={[{
      id: 'status',
      label: 'Status',
      allLabel: 'All statuses',
      options: [{ value: 'enabled', label: 'Enabled' }, { value: 'disabled', label: 'Disabled' }],
      valueOf: (rule) => (rule.enabled ? 'enabled' : 'disabled'),
    }]}
  />,
  { wrapper: ({ children }) => <I18nProvider i18n={i18n}>{children}</I18nProvider> },
);

const typeSearch = (text: string) => {
  fireEvent.change(screen.getByPlaceholderText('Search rules'), { target: { value: text } });
  advance(500);
};

const rowNames = () => Array.from(document.querySelectorAll('tbody tr')).map((row) => row.textContent);

describe('DataPageLayout search and filters', () => {
  it('should draw the search box and the filter pill in the toolbar, with the whole count', () => {
    renderSearchable();

    expect(screen.getByPlaceholderText('Search rules')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Status' })).toBeTruthy();
    expect(screen.getByText('3 entities')).toBeTruthy();
  });

  it('should keep the rows whose text holds the search, accents and case folded, and count them out of the whole list', () => {
    renderSearchable();

    typeSearch('ecole');

    expect(rowNames()).toEqual(['École network']);
    expect(screen.getByText('1 of 3 entities')).toBeTruthy();
    expect(screen.getByText('1 active filter')).toBeTruthy();
  });

  it('should keep the table and its search up when nothing matches, instead of the empty state', () => {
    renderSearchable();

    typeSearch('nothing like it');

    expect(screen.queryByText('No rules yet.')).toBeNull();
    expect(screen.getByPlaceholderText('Search rules')).toBeTruthy();
    expect(screen.getByText('0 of 3 entities')).toBeTruthy();
  });

  it('should say No results under the toolbar when nothing matches, and lift the search with Clear filters', () => {
    renderSearchable();

    typeSearch('nothing like it');

    expect(screen.getByTestId('data-page-no-results')).toBeTruthy();
    expect(screen.getByText('No results')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    advance(500);

    expect(screen.queryByTestId('data-page-no-results')).toBeNull();
    expect(rowNames()).toHaveLength(3);
    expect(screen.getByText('3 entities')).toBeTruthy();
  });

  it('should not draw the no-results card while the search lets rows through', () => {
    renderSearchable();

    typeSearch('payment');

    expect(screen.queryByTestId('data-page-no-results')).toBeNull();
  });

  it('should lift the search with Clear all', () => {
    renderSearchable();
    typeSearch('payment');

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    advance(500);

    expect(rowNames()).toHaveLength(3);
    expect(screen.getByText('3 entities')).toBeTruthy();
  });

  it('should leave a server-paginated table, which searches on the server, unnarrowed and without the controls', () => {
    render(
      <DataPageLayout
        data={RULES}
        total={3}
        pageIndex={0}
        isFetching={false}
        columns={RULE_COLUMNS}
        storageKey="data-page-layout-search-server"
        search={{ placeholder: 'Search rules', texts: (rule) => [rule.name] }}
        filters={[{ id: 'status', label: 'Status', allLabel: 'All statuses', options: [], valueOf: () => 'enabled' }]}
      />,
      { wrapper: ({ children }) => <I18nProvider i18n={i18n}>{children}</I18nProvider> },
    );

    expect(screen.queryByPlaceholderText('Search rules')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Status' })).toBeNull();
  });

  it('should say No results when a server list narrowed by its caller answers no row, and lift the caller filters', () => {
    const onClearAll = vi.fn();
    render(
      <DataPageLayout
        data={[]}
        total={0}
        pageIndex={0}
        isFetching={false}
        columns={RULE_COLUMNS}
        storageKey="data-page-layout-caller-filters"
        emptyState={<p>No rules yet.</p>}
        callerFilters={{ active: true, onClearAll }}
      />,
      { wrapper: ({ children }) => <I18nProvider i18n={i18n}>{children}</I18nProvider> },
    );

    expect(screen.queryByText('No rules yet.')).toBeNull();
    expect(screen.getByTestId('data-page-no-results')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it('should not say No results for a server page that comes back empty while the count still holds rows', () => {
    render(
      <DataPageLayout
        data={[]}
        total={51}
        pageIndex={1}
        isFetching={false}
        columns={RULE_COLUMNS}
        storageKey="data-page-layout-caller-filters-past"
        callerFilters={{ active: true, onClearAll: vi.fn() }}
      />,
      { wrapper: ({ children }) => <I18nProvider i18n={i18n}>{children}</I18nProvider> },
    );

    expect(screen.queryByTestId('data-page-no-results')).toBeNull();
  });

  it('should keep the empty state, and no No results card, while the caller has no filter set', () => {
    render(
      <DataPageLayout
        data={[]}
        columns={RULE_COLUMNS}
        storageKey="data-page-layout-caller-filters-none"
        emptyState={<p>No rules yet.</p>}
        callerFilters={{ active: false, onClearAll: vi.fn() }}
      />,
      { wrapper: ({ children }) => <I18nProvider i18n={i18n}>{children}</I18nProvider> },
    );

    expect(screen.getByText('No rules yet.')).toBeTruthy();
    expect(screen.queryByTestId('data-page-no-results')).toBeNull();
  });
});
