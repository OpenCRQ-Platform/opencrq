import { FINDINGS_SEARCH_MAX_LENGTH } from '@app/module/client';
import { Button, Chip } from '@filigran/design-system';
import { createFileRoute, Link, stripSearchParams, useNavigate, useParams } from '@tanstack/react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../../../components/ui/select';
import { dismissedStateFilterLabel } from '../../../../../features/finding-detail';
import { DataPageLayout } from '../../../../../components/ui/data-page-layout';
import { ListEmptyCard } from '../../../../../components/ui/list-empty-card';
import { DebouncedSearchField } from '../../../../../components/shared';
import { FINDINGS_LIST_SEARCH_DEFAULTS, findingsListSearchSchema } from '../../../../../features/findings-home/findings-list-search';
import {
  FindingsListShell,
  FindingSourceSelect,
  findingsTableColumns,
  parseVulnerabilityToken,
  toFindingSort,
  toFindingTableRow,
  vulnerabilityFilterLabel,
} from '../../../../../features/findings-home';
import { ManageScopeAssetsButton } from '../../../../../features/organizations';
import { usePersistedPageSize, usePersistedSorting, useUrlListFilters } from '../../../../../hooks';
import { useTRPC } from '../../../../../lib';
import { isEvidenceStateFilter, resolveOptionFilter } from '../../../../../utils';

const TABLE_ID = 'findings';
const PAGE_LIMIT = 50;

const DEFAULT_SORTING = [{ id: 'score', desc: true }];

const FindingsEmptyState = (): ReactElement => (
  <ListEmptyCard
    title={<Trans>Start collecting evidence</Trans>}
    body={(
      <Trans>
        A finding is what an integration reports about your estate: a vulnerability on an asset, a check that did
        not hold, a control someone assessed. Connect one and its findings land here.
      </Trans>
    )}
    actions={(
      <Button asChild>
        <Link from="/$tenantId/{-$organizationId}/findings" to="/$tenantId/{-$organizationId}/integrations/available">
          <Trans>Connect an integration</Trans>
        </Link>
      </Button>
    )}
  />
);

const NoFindingInStateEmptyState = ({ searched }: { searched: boolean }): ReactElement => (
  <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
    <p>{searched ? <Trans>No finding matches this search.</Trans> : <Trans>No finding stands in this state.</Trans>}</p>
  </div>
);

const FindingsPage = () => {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const { organizationId } = useParams({ strict: false });
  const { filters, setFilters } = useUrlListFilters(findingsListSearchSchema);
  // Read from the state the headers draw from: a copy drifts the moment the table writes a sort.
  const { pageSize } = usePersistedPageSize(TABLE_ID, PAGE_LIMIT);
  const { sorting } = usePersistedSorting(TABLE_ID, DEFAULT_SORTING);
  const [page, setPage] = useState(1);
  const [activeSort] = sorting;
  const { sortBy, sortDesc } = toFindingSort(activeSort);

  const { data: sourceCounts } = useQuery(trpc.findingScore.getFindingCountsBySource.queryOptions({
    organizationId: organizationId ?? null,
  }));
  // `sourceCounts` is `undefined` while its query is pending, not because the tenant has no
  // sources: that distinction is what tells a still-loading options list apart from a source a
  // shared link points to that no longer exists.
  const resolvedSource = resolveOptionFilter(filters.source, sourceCounts?.map((c) => c.source), 'all');
  const vulnerability = filters.vulnerability === undefined ? null : parseVulnerabilityToken(filters.vulnerability);
  const search = filters.search.trim();

  const { data, isLoading, isPlaceholderData, isFetching } = useQuery(trpc.findingScore.listScoredFindings.queryOptions(
    {
      page,
      limit: pageSize,
      state: filters.state === 'all' ? null : filters.state,
      source: resolvedSource === 'all' ? null : resolvedSource,
      vulnerability,
      search: search === '' ? null : search,
      organizationId: organizationId ?? null,
      sortBy,
      sortDesc,
    },
    { placeholderData: keepPreviousData },
  ));
  const { data: scope } = useQuery(trpc.organizations.getOrganization.queryOptions(
    { id: organizationId ?? '' },
    { enabled: organizationId !== undefined },
  ));

  const rows = (data?.items ?? []).map((finding) => toFindingTableRow(finding));
  const columns = findingsTableColumns({ showState: filters.state !== 'applicable', showAsset: true });
  const total = data?.total ?? 0;
  const unscored = data?.unscored ?? 0;

  return (
    <FindingsListShell view="all">
      <DataPageLayout
        data={rows}
        total={total}
        columns={columns}
        isLoading={isLoading}
        isPlaceholderData={isPlaceholderData}
        isFetching={isFetching}
        storageKey={TABLE_ID}
        initialPageSize={PAGE_LIMIT}
        initialSorting={DEFAULT_SORTING}
        pageIndex={page - 1}
        serverSorted
        onServerPageChange={(pagination) => setPage(pagination.pageIndex + 1)}
        headerActions={scope && (
          <ManageScopeAssetsButton organizationId={scope.id} priority="secondary">
            <Trans>Manage assets</Trans>
          </ManageScopeAssetsButton>
        )}
        emptyState={unscored > 0
          ? undefined
          // `total` is narrowed by the state, the source, the vulnerability, the search and the scope
          // alike, so only the view that narrows by none of them can say the tenant has collected nothing at all.
          : (filters.state === 'applicable' && resolvedSource === 'all' && vulnerability === null && search === '' && organizationId === undefined && total === 0
            ? <FindingsEmptyState />
            : <NoFindingInStateEmptyState searched={search !== ''} />)}
        leftHeaderContent={(
          <div className="flex flex-wrap items-center gap-3">
            <DebouncedSearchField
              placeholder={t`Search findings...`}
              value={filters.search}
              onCommit={(committed) => {
                setFilters({ search: committed });
                setPage(1);
              }}
              clearLabel={t`Clear search`}
              maxLength={FINDINGS_SEARCH_MAX_LENGTH}
              className="w-80"
            />
            {unscored > 0 && (
              <span className="txt-sub-content text-muted-foreground">
                {plural(unscored, { one: '# finding is still being scored.', other: '# findings are still being scored.' })}
              </span>
            )}
            <Select
              value={filters.state}
              onValueChange={(value) => {
                if (isEvidenceStateFilter(value)) {
                  setFilters({ state: value });
                  // Page 3 of the old filter is a slice of a list that no longer exists.
                  setPage(1);
                }
              }}
            >
              <SelectTrigger className="w-80" aria-label={t`Filter by state`}>
                <SelectValue placeholder={t`Filter by state`} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="applicable"><Trans>Applicable</Trans></SelectItem>
                <SelectItem value="dismissed">{dismissedStateFilterLabel('both')}</SelectItem>
                <SelectItem value="all"><Trans>All states</Trans></SelectItem>
              </SelectContent>
            </Select>
            <FindingSourceSelect
              value={resolvedSource}
              sourceCounts={sourceCounts}
              onChange={(value) => {
                setFilters({ source: findingsListSearchSchema.shape.source.parse(value) });
                setPage(1);
              }}
            />
            {vulnerability !== null && (
              <Chip
                label={vulnerabilityFilterLabel(vulnerability)}
                deleteLabel={t`Remove the vulnerability filter`}
                onDelete={() => {
                  setFilters({ vulnerability: undefined });
                  setPage(1);
                }}
              />
            )}
          </div>
        )}
        onClickRow={(row) => {
          void navigate({
            from: '/$tenantId/{-$organizationId}',
            to: 'findings/$evidenceId',
            params: { evidenceId: row.original.id },
          });
        }}
      />
    </FindingsListShell>
  );
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/findings/')({
  validateSearch: findingsListSearchSchema,
  search: { middlewares: [stripSearchParams(FINDINGS_LIST_SEARCH_DEFAULTS)] },
  component: FindingsPage,
});
