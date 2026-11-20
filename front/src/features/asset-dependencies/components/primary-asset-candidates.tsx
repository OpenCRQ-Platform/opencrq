import { includesFolded } from '@app/utils/text-fold';
import type { SupportToPrimaryLinkRole } from '@app/module/client';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent, ReactElement, ReactNode } from 'react';
import { useLayoutEffect, useMemo, useState } from 'react';
import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import type { LinkListValue } from '../link-list-store';
import type { LinkDelta, LinkState, ShowFilter, StoredLink } from '../manage-dependencies-utils';
import { DebouncedSearchField } from '../../../components/shared/debounced-search-field';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { EmptyValue } from '../../../components/ui/empty-value';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { usePersistedPageSize } from '../../../hooks';
import { resolveOptionFilter } from '../../../utils';
import { createLinkListStore } from '../link-list-store';
import { linkStateOf, setLinkRoles } from '../manage-dependencies-utils';
import {
  InheritedCriteriaHeader,
  LINK_CRITERIA_COLUMN_SIZE,
  LINK_ROLES_COLUMN_SIZE,
  LinkListContext,
  LinkListCriteria,
  LinkListName,
  LinkListRoles,
  LinkRoleChipWidths,
} from './manage-dependencies-cells';
import { ShowFilterSelect } from './show-filter-select';

const TABLE_ID = 'manageDependencies-primary';
const PAGE_LIMIT = 25;
const NO_OWNER = 'none';

export interface PrimaryCandidateRow {
  id: string,
  name: string,
  organization: { id: string, name: string },
  owner: { id: string, name: string | null, email: string } | null,
}

const ownerLabel = (owner: { name: string | null, email: string }) => owner.name || owner.email;

/** Called once per list: the cells read the changing link state from `LinkListContext`. */
const buildColumns = (acrossScopes: boolean): Array<ColumnDefWithOptionsHeader<PrimaryCandidateRow, unknown>> => [
  {
    id: 'roles',
    header: t`Roles`,
    enableHiding: false,
    size: LINK_ROLES_COLUMN_SIZE,
    cell: ({ row }): ReactElement => <LinkListRoles id={row.original.id} name={row.original.name} />,
  },
  {
    id: 'name',
    accessorKey: 'name',
    header: t`Primary asset`,
    size: acrossScopes ? 196 : 264,
    cell: ({ row }): ReactElement => <LinkListName id={row.original.id} name={row.original.name} derivedName={null} />,
  },
  {
    id: 'owner',
    header: t`Owner`,
    size: acrossScopes ? 108 : 160,
    cell: ({ row }): ReactElement => <span>{row.original.owner === null ? <EmptyValue /> : ownerLabel(row.original.owner)}</span>,
  },
  ...(acrossScopes
    ? [{
      id: 'organization',
      header: t`Risk scope`,
      size: 120,
      cell: ({ row }: { row: { original: PrimaryCandidateRow } }): ReactElement => <span>{row.original.organization.name}</span>,
    }]
    : []),
  {
    id: 'inheritedCriteria',
    header: (): ReactElement => <InheritedCriteriaHeader />,
    size: LINK_CRITERIA_COLUMN_SIZE,
    cell: ({ row }): ReactElement => <LinkListCriteria id={row.original.id} />,
  },
];

interface PrimaryAssetCandidatesProps {
  /** Every primary asset of every risk scope, by name, so the links to any scope are counted and shown. */
  candidates: ReadonlyArray<PrimaryCandidateRow>,
  /** The scope the filter starts on, the page's own, or none for every scope. */
  initialScopeId: string | null,
  isLoading: boolean,
  sentence: ReactNode,
  storedLinks: ReadonlyMap<string, StoredLink>,
  delta: LinkDelta<PrimaryCandidateRow>,
  onDeltaChange: (delta: LinkDelta<PrimaryCandidateRow>) => void,
}

/**
 * The primary assets a supporting asset may support, roles first so a row reads "this asset, in
 * this role, for that primary asset". A tenant has dozens of them, so the list is filtered and
 * paged in the browser; the linked rows come first in the order the server stores them.
 */
export const PrimaryAssetCandidates: FunctionComponent<PrimaryAssetCandidatesProps> = ({
  candidates,
  initialScopeId,
  isLoading,
  sentence,
  storedLinks,
  delta,
  onDeltaChange,
}) => {
  const { pageSize } = usePersistedPageSize(TABLE_ID, PAGE_LIMIT);
  const [search, setSearch] = useState('');
  const [show, setShow] = useState<ShowFilter>('all');
  const [scope, setScope] = useState(initialScopeId ?? 'all');
  const [owner, setOwner] = useState('all');
  const [page, setPage] = useState(1);

  const scopes = [...new Map(candidates.map((row) => [row.organization.id, row.organization])).values()]
    .sort((a, b) => a.name.localeCompare(b.name));
  const owners = [...new Map(candidates.flatMap((row) => (row.owner === null ? [] : [[row.owner.id, row.owner] as const]))).values()]
    .sort((a, b) => ownerLabel(a).localeCompare(ownerLabel(b)));
  const resolvedScope = resolveOptionFilter(scope, scopes.map((s) => s.id), 'all');
  // Several scopes add a column and a filter naming the scope.
  const acrossScopes = scopes.length > 1;
  const resolvedOwner = resolveOptionFilter(owner, [NO_OWNER, ...owners.map((o) => o.id)], 'all');

  const storedOf = (id: string) => storedLinks.get(id) ?? null;

  // Only the pending view reads the delta, so a change leaves the other views' rows, and the table, as they are.
  const pendingIds = show === 'pending' ? new Set(Object.keys(delta)) : null;
  const matching = candidates.filter((row) => {
    if (show === 'linked' && !storedLinks.has(row.id)) {
      return false;
    }
    if (pendingIds !== null && !pendingIds.has(row.id)) {
      return false;
    }
    return includesFolded(row.name, search)
      && (resolvedScope === 'all' || row.organization.id === resolvedScope)
      && (resolvedOwner === 'all' || (resolvedOwner === NO_OWNER ? row.owner === null : row.owner?.id === resolvedOwner));
  });
  // On the stored links, never the session's ticks, so a row ticked a moment ago stays under the pointer.
  const ordered = [...matching.filter((row) => storedLinks.has(row.id)), ...matching.filter((row) => !storedLinks.has(row.id))];
  const lastPage = Math.max(1, Math.ceil(ordered.length / pageSize));
  const currentPage = Math.min(page, lastPage);
  const rows = ordered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const resetPage = () => setPage(1);

  // eslint-disable-next-line no-restricted-syntax -- TanStack renders each `cell` as a component: rebuilt columns would remount every cell and close an open roles list.
  const columns = useMemo(() => buildColumns(acrossScopes), [acrossScopes]);
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const listValue: LinkListValue = {
    kind: 'roles',
    stateOf: (id: string): LinkState => linkStateOf(delta, id, storedOf(id)),
    setRoles: (id: string, roles: Array<SupportToPrimaryLinkRole>) => {
      const row = rowsById.get(id);
      if (row) {
        onDeltaChange(setLinkRoles(delta, row, storedOf(id), roles));
      }
    },
  };
  const [store] = useState(() => createLinkListStore(listValue));
  // A layout effect, so the changed row repaints in the same frame as the footer's count.
  useLayoutEffect(() => {
    store.publish(listValue);
  });

  const leftHeader = (() => {
    switch (show) {
      case 'all': return plural(ordered.length, { one: '# primary asset · sorted with the linked first', other: '# primary assets · sorted with the linked first' });
      case 'linked': return plural(ordered.length, { one: '# linked primary asset', other: '# linked primary assets' });
      case 'pending': return plural(ordered.length, { one: '# pending change', other: '# pending changes' });
    }
  })();

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p>{sentence}</p>
        <p className="txt-sub-content text-muted-foreground">
          <Trans>Pick a role to link a primary asset, and remove its last role to unlink it.</Trans>
        </p>
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
          linkedCount={candidates.filter((row) => storedLinks.has(row.id)).length}
          pendingCount={Object.keys(delta).length}
          onChange={(next) => {
            setShow(next);
            resetPage();
          }}
        />
        {acrossScopes && (
          <Select
            value={resolvedScope}
            onValueChange={(value) => {
              setScope(value);
              resetPage();
            }}
          >
            <SelectTrigger className="w-44" aria-label={t`Risk scope`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all"><Trans>All risk scopes</Trans></SelectItem>
              {scopes.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Select
          value={resolvedOwner}
          onValueChange={(value) => {
            setOwner(value);
            resetPage();
          }}
        >
          <SelectTrigger className="w-44" aria-label={t`Owner`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all"><Trans>All owners</Trans></SelectItem>
            <SelectItem value={NO_OWNER}><Trans>No owner</Trans></SelectItem>
            {owners.map((o) => <SelectItem key={o.id} value={o.id}>{ownerLabel(o)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <LinkListContext.Provider value={store}>
        <LinkRoleChipWidths>
          <DataPageLayout
            key={show}
            data={rows}
            total={ordered.length}
            columns={columns}
            isLoading={isLoading}
            isFetching={false}
            storageKey={TABLE_ID}
            initialPageSize={PAGE_LIMIT}
            pageIndex={currentPage - 1}
            enableSorting={false}
            onServerPageChange={(pagination) => setPage(pagination.pageIndex + 1)}
            leftHeaderContent={<span className="txt-sub-content text-muted-foreground">{leftHeader}</span>}
            emptyState={show === 'pending' ? <Trans>No pending change.</Trans> : <Trans>No primary asset matches.</Trans>}
          />
        </LinkRoleChipWidths>
      </LinkListContext.Provider>
    </div>
  );
};
