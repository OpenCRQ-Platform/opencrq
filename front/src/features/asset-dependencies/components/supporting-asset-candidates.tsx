import { Chip } from '@filigran/design-system';
import type { AssetCategory, AssetCriticality, DependencyCandidateRelation, SupportingAssetExposure, SupportToPrimaryLinkRole } from '@app/module/client';
import { ASSET_CATEGORY_VALUES, INTEGRATION_SOURCES } from '@app/module/client';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent, ReactElement, ReactNode } from 'react';
import { useDeferredValue, useLayoutEffect, useMemo, useState } from 'react';
import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import type { LinkListValue } from '../link-list-store';
import type { LinkDelta, LinkState, ShowFilter, StoredLink } from '../manage-dependencies-utils';
import { DebouncedSearchField } from '../../../components/shared/debounced-search-field';
import { SourceStack } from '../../../components/shared/source-stack';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { usePersistedPageSize } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { getAssetCategoryLabel, getAssetCriticalityLabel, resolveOptionFilter } from '../../../utils';
import { assetNameMatches, assetNameText } from '../../../utils/asset-name-utils';
import { getConnectorNameBySource } from '../../integrations';
import { createLinkListStore } from '../link-list-store';
import {
  linkStateOf,
  pendingRows,
  setLinkRoles,
  setPageLinked,
  toggleLink,
} from '../manage-dependencies-utils';
import {
  InheritedCriteriaHeader,
  LINK_CRITERIA_COLUMN_SIZE,
  LINK_ROLES_COLUMN_SIZE,
  LinkListCheckbox,
  LinkListContext,
  LinkListCriteria,
  LinkListHeaderCheckbox,
  LinkListName,
  LinkListRoles,
  LinkRoleChipWidths,
} from './manage-dependencies-cells';
import { ShowFilterSelect } from './show-filter-select';

const PAGE_LIMIT = 25;
const NO_ROWS: Array<SupportingCandidateRow> = [];
const NO_SOURCE = 'user';
const SOURCE_FILTERS = [...INTEGRATION_SOURCES, NO_SOURCE] as const;
type SourceFilter = (typeof SOURCE_FILTERS)[number];
const isSourceFilter = (value: string): value is SourceFilter => (SOURCE_FILTERS as ReadonlyArray<string>).includes(value);
const isCategory = (value: string): value is AssetCategory => (ASSET_CATEGORY_VALUES as ReadonlyArray<string>).includes(value);

export interface SupportingCandidateRow {
  id: string,
  name: string | null,
  derivedName: string | null,
  categoryId: AssetCategory,
  exposure: SupportingAssetExposure,
  criticality: AssetCriticality,
  sources: Array<string>,
}

interface SupportingAssetCandidatesProps {
  relation: DependencyCandidateRelation,
  /** The asset being edited: a supporting asset for `dependsOn` / `providesTo`, a primary asset for `supportsPrimary`. */
  assetId: string,
  sentence: ReactNode,
  storedLinks: ReadonlyMap<string, StoredLink>,
  delta: LinkDelta<SupportingCandidateRow>,
  onDeltaChange: (delta: LinkDelta<SupportingCandidateRow>) => void,
  withRoles: boolean,
}

const nameOf = (row: SupportingCandidateRow) => assetNameText(row, t`Unnamed asset`);

/**
 * Called once per list: the cells read the changing link state from `LinkListContext`. A relation
 * carrying roles links a row by its roles field, any other by a checkbox.
 */
const buildColumns = (withRoles: boolean): Array<ColumnDefWithOptionsHeader<SupportingCandidateRow, unknown>> => [
  withRoles
    ? {
      id: 'roles',
      header: t`Roles`,
      enableHiding: false,
      size: LINK_ROLES_COLUMN_SIZE,
      cell: ({ row }): ReactElement => <LinkListRoles id={row.original.id} name={nameOf(row.original)} />,
    }
    : {
      id: 'linked',
      header: (): ReactElement => <LinkListHeaderCheckbox />,
      enableSorting: false,
      enableHiding: false,
      size: 40,
      cell: ({ row }): ReactElement => <LinkListCheckbox id={row.original.id} name={nameOf(row.original)} />,
    },
  {
    id: 'name',
    accessorKey: 'name',
    header: t`Asset`,
    size: withRoles ? 200 : 270,
    cell: ({ row }): ReactElement => <LinkListName id={row.original.id} name={row.original.name} derivedName={row.original.derivedName} />,
  },
  {
    id: 'categoryId',
    header: t`Category`,
    size: withRoles ? 130 : 150,
    cell: ({ row }): ReactElement => <Chip className="max-w-full" label={getAssetCategoryLabel(row.original.categoryId)} />,
  },
  {
    id: 'sources',
    header: t`Source`,
    size: 88,
    cell: ({ row }): ReactElement => <SourceStack sources={row.original.sources} />,
  },
  ...(withRoles
    ? [{
      id: 'inheritedCriteria',
      header: (): ReactElement => <InheritedCriteriaHeader />,
      size: LINK_CRITERIA_COLUMN_SIZE,
      cell: ({ row }: { row: { original: SupportingCandidateRow } }): ReactElement => <LinkListCriteria id={row.original.id} />,
    }]
    : [
      {
        id: 'exposure',
        header: t`Exposure`,
        size: 120,
        cell: ({ row }: { row: { original: SupportingCandidateRow } }): ReactElement => {
          switch (row.original.exposure) {
            case 'internet_facing': return <Chip severity="critical" label={t`Internet`} />;
            case 'internal': return <Chip severity="info" label={t`Internal`} />;
            case 'unknown': return <Chip label={t`Unknown`} />;
          }
        },
      },
      {
        id: 'criticality',
        header: t`Criticality`,
        size: 110,
        cell: ({ row }: { row: { original: SupportingCandidateRow } }): ReactElement => (
          <span>{getAssetCriticalityLabel(row.original.criticality)}</span>
        ),
      },
    ]),
];

interface CandidateTableProps {
  rows: Array<SupportingCandidateRow>,
  total: number,
  columns: Array<ColumnDefWithOptionsHeader<SupportingCandidateRow, unknown>>,
  isLoading: boolean,
  isPlaceholderData: boolean,
  isFetching: boolean,
  tableId: string,
  pageIndex: number,
  onPageChange: (pageIndex: number) => void,
  leftHeader: string,
  emptyState: ReactNode,
}

/**
 * The table, drawn in interruptible slices: a page of 500 rows drawn in one go froze the drawer's
 * slide-in. It reads no query, because a query settling mid-draw makes React redraw everything in
 * one block, and its initial value also defers a first render whose rows came from the cache.
 */
const CandidateTable: FunctionComponent<CandidateTableProps> = ({
  rows,
  total,
  columns,
  isLoading,
  isPlaceholderData,
  isFetching,
  tableId,
  pageIndex,
  onPageChange,
  leftHeader,
  emptyState,
}) => {
  const shownRows = useDeferredValue(rows, NO_ROWS);
  const drawing = shownRows !== rows;
  return (
    <DataPageLayout
      data={shownRows}
      total={total}
      columns={columns}
      isLoading={isLoading || (drawing && shownRows.length === 0)}
      isPlaceholderData={isPlaceholderData || (drawing && shownRows.length > 0)}
      isFetching={isFetching}
      storageKey={tableId}
      initialPageSize={PAGE_LIMIT}
      pageIndex={pageIndex}
      enableSorting={false}
      onServerPageChange={(pagination) => onPageChange(pagination.pageIndex)}
      leftHeaderContent={<span className="txt-sub-content text-muted-foreground">{leftHeader}</span>}
      emptyState={emptyState}
    />
  );
};

const matchesPending = (row: SupportingCandidateRow, search: string, category: string, source: string) =>
  (search === '' || assetNameMatches(row, search))
  && (category === 'all' || row.categoryId === category)
  && (source === 'all' || (source === NO_SOURCE ? row.sources.length === 0 : row.sources.includes(source)));

/**
 * The tenant's supporting assets for one relation of one asset, server-paged and linked first, with
 * the session's changes painted over the stored links. The pending view lists the changes alone,
 * from the rows they were made on.
 */
export const SupportingAssetCandidates: FunctionComponent<SupportingAssetCandidatesProps> = ({
  relation,
  assetId,
  sentence,
  storedLinks,
  delta,
  onDeltaChange,
  withRoles,
}) => {
  const trpc = useTRPC();
  const tableId = `manageDependencies-${relation}`;
  const { pageSize } = usePersistedPageSize(tableId, PAGE_LIMIT);
  const [search, setSearch] = useState('');
  const [show, setShow] = useState<ShowFilter>('all');
  const [category, setCategory] = useState('all');
  const [source, setSource] = useState('all');
  const [page, setPage] = useState(1);

  const { data: sourceCounts } = useQuery(trpc.supportingAssets.getAssetCountsBySource.queryOptions({ organizationId: null }));
  const resolvedSource = resolveOptionFilter(source, sourceCounts?.map((count) => count.source), 'all');
  const trimmedSearch = search.trim();

  const { data, isLoading, isPlaceholderData, isFetching } = useQuery(trpc.assetDependencies.listSupportingAssetCandidates.queryOptions(
    {
      relation,
      assetId,
      page,
      limit: pageSize,
      search: trimmedSearch === '' ? null : trimmedSearch,
      source: isSourceFilter(resolvedSource) ? resolvedSource : null,
      categoryId: isCategory(category) ? category : null,
      linkedOnly: show === 'linked',
    },
    { placeholderData: keepPreviousData, enabled: show !== 'pending' },
  ));

  const pending = pendingRows(delta).filter((row) => matchesPending(row, trimmedSearch, category, resolvedSource));
  const lastPage = Math.max(1, Math.ceil(pending.length / pageSize));
  const rows: Array<SupportingCandidateRow> = show === 'pending'
    ? pending.slice((Math.min(page, lastPage) - 1) * pageSize, Math.min(page, lastPage) * pageSize)
    : (data?.items ?? []);
  const total = show === 'pending' ? pending.length : (data?.total ?? 0);

  const storedOf = (id: string) => storedLinks.get(id) ?? null;
  const resetPage = () => setPage(1);

  // eslint-disable-next-line no-restricted-syntax -- TanStack renders each `cell` as a component: rebuilt columns would remount every cell and close an open roles list.
  const columns = useMemo(() => buildColumns(withRoles), [withRoles]);
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const stateOf = (id: string): LinkState => linkStateOf(delta, id, storedOf(id));
  const withRow = (id: string, change: (row: SupportingCandidateRow) => void) => {
    const row = rowsById.get(id);
    if (row) {
      change(row);
    }
  };
  const listValue: LinkListValue = withRoles
    ? {
      kind: 'roles',
      stateOf,
      setRoles: (id: string, roles: Array<SupportToPrimaryLinkRole>) => withRow(id, (row) => onDeltaChange(setLinkRoles(delta, row, storedOf(id), roles))),
    }
    : {
      kind: 'checkbox',
      stateOf,
      toggle: (id: string) => withRow(id, (row) => onDeltaChange(toggleLink(delta, row, storedOf(id)))),
      pageStates: rows.map((row) => stateOf(row.id)),
      setPageLinked: (linked: boolean) => onDeltaChange(setPageLinked(
        delta,
        rows.map((row) => ({ row, stored: storedOf(row.id) })),
        linked,
      )),
    };
  const [store] = useState(() => createLinkListStore(listValue));
  // A layout effect, so the changed row repaints in the same frame as the footer's count.
  useLayoutEffect(() => {
    store.publish(listValue);
  });

  const storedCount = storedLinks.size;
  const leftHeader = (() => {
    switch (show) {
      case 'all': return plural(total, { one: '# asset · sorted with the linked first', other: '# assets · sorted with the linked first' });
      case 'linked': return plural(total, { one: '# linked asset', other: '# linked assets' });
      case 'pending': return plural(total, { one: '# pending change', other: '# pending changes' });
    }
  })();

  const table = (
    <CandidateTable
      key={show}
      rows={rows}
      total={total}
      columns={columns}
      isLoading={show !== 'pending' && isLoading}
      isPlaceholderData={show !== 'pending' && isPlaceholderData}
      isFetching={show !== 'pending' && isFetching}
      tableId={tableId}
      pageIndex={(show === 'pending' ? Math.min(page, lastPage) : page) - 1}
      onPageChange={(pageIndex) => setPage(pageIndex + 1)}
      leftHeader={leftHeader}
      emptyState={show === 'pending' ? <Trans>No pending change.</Trans> : <Trans>No supporting asset matches.</Trans>}
    />
  );

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p>{sentence}</p>
        {withRoles && (
          <p className="txt-sub-content text-muted-foreground">
            <Trans>Pick a role to link a supporting asset, and remove its last role to unlink it.</Trans>
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <DebouncedSearchField
          placeholder={t`Search by name...`}
          value={search}
          onCommit={(next) => {
            setSearch(next);
            resetPage();
          }}
          clearLabel={t`Clear search`}
          className="w-72"
        />
        <ShowFilterSelect
          value={show}
          linkedCount={storedCount}
          pendingCount={Object.keys(delta).length}
          onChange={(next) => {
            setShow(next);
            resetPage();
          }}
        />
        <Select
          value={category}
          onValueChange={(value) => {
            setCategory(value);
            resetPage();
          }}
        >
          <SelectTrigger className="w-44" aria-label={t`Category`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all"><Trans>All categories</Trans></SelectItem>
            {ASSET_CATEGORY_VALUES.map((categoryId) => (
              <SelectItem key={categoryId} value={categoryId}>{getAssetCategoryLabel(categoryId)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={resolvedSource}
          onValueChange={(value) => {
            setSource(value);
            resetPage();
          }}
        >
          <SelectTrigger className="w-40" aria-label={t`Source`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all"><Trans>All sources</Trans></SelectItem>
            {(sourceCounts ?? []).map(({ source: value }) => (
              <SelectItem key={value} value={value}>
                {value === NO_SOURCE ? t`Set by user` : (getConnectorNameBySource(value) ?? value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <LinkListContext.Provider value={store}>
        {relation === 'supportsPrimary' ? <LinkRoleChipWidths>{table}</LinkRoleChipWidths> : table}
      </LinkListContext.Provider>
    </div>
  );
};
