import { FINDINGS_SEARCH_MAX_LENGTH } from '@app/module/client';
import { createFileRoute, stripSearchParams, useNavigate, useParams } from '@tanstack/react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { DebouncedSearchField } from '../../../../../components/shared';
import { DataPageLayout } from '../../../../../components/ui/data-page-layout';
import { UNIQUE_FINDINGS_LIST_SEARCH_DEFAULTS, uniqueFindingsListSearchSchema } from '../../../../../features/findings-home/unique-findings-list-search';
import { FindingsListShell, FindingSourceSelect, toUniqueFindingTableRow, uniqueFindingsTableColumns } from '../../../../../features/findings-home';
import { usePersistedPageSize, usePersistedSorting, useUrlListFilters } from '../../../../../hooks';
import { useTRPC } from '../../../../../lib';
import { useCounterparts, XtmRowMarks } from '../../../../../features/xtm/xtm-counterparts';
import { resolveOptionFilter } from '../../../../../utils';

const TABLE_ID = 'unique-findings';
const PAGE_LIMIT = 50;

type SortKey = 'score' | 'affectedAssets' | 'name' | 'age';

/** A column absent from here must declare `enableSorting: false`, or it offers an ordering the server cannot answer. */
const SORT_KEY_BY_COLUMN: Record<string, SortKey | undefined> = {
  score: 'score',
  affectedAssets: 'affectedAssets',
  name: 'name',
  ageDays: 'age',
};

const DEFAULT_SORTING = [{ id: 'score', desc: true }];

const toSortKey = (columnId: string | undefined): SortKey | undefined =>
  (columnId === undefined ? undefined : SORT_KEY_BY_COLUMN[columnId]);

const NoUniqueFindingEmptyState = ({ searched }: { searched: boolean }): ReactElement => (
  <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
    <p>{searched ? <Trans>No finding matches this search.</Trans> : <Trans>No applicable finding to group.</Trans>}</p>
  </div>
);

const UniqueFindingsList = () => {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const { organizationId } = useParams({ strict: false });
  const { filters, setFilters } = useUrlListFilters(uniqueFindingsListSearchSchema);
  const { pageSize } = usePersistedPageSize(TABLE_ID, PAGE_LIMIT);
  const { sorting } = usePersistedSorting(TABLE_ID, DEFAULT_SORTING);
  const [page, setPage] = useState(1);
  const [activeSort] = sorting;
  const sortBy = toSortKey(activeSort?.id) ?? 'score';
  const sortDesc = activeSort?.desc ?? true;
  const search = filters.search.trim();

  const { data: sourceCounts } = useQuery(trpc.findingScore.getFindingCountsBySource.queryOptions({
    organizationId: organizationId ?? null,
    applicableOnly: true,
  }));
  const resolvedSource = resolveOptionFilter(filters.source, sourceCounts?.map((c) => c.source), 'all');

  const { data, isLoading, isPlaceholderData, isFetching } = useQuery(trpc.findingScore.listUniqueFindings.queryOptions(
    {
      page,
      limit: pageSize,
      source: resolvedSource === 'all' ? null : resolvedSource,
      search: search === '' ? null : search,
      organizationId: organizationId ?? null,
      sortBy,
      sortDesc,
    },
    { placeholderData: keepPreviousData },
  ));

  const rows = (data?.items ?? []).map((group) => toUniqueFindingTableRow(group));
  // The same vulnerabilities in OpenCTI and OpenAEV, by CVE id: one batched lookup per page, nothing while not connected.
  const counterparts = useCounterparts('VULNERABILITY', rows.filter((row) => !row.isTechnique).map((row) => row.name));

  return (
    <FindingsListShell view="unique">
      <DataPageLayout
        data={rows}
        total={data?.total ?? 0}
        columns={uniqueFindingsTableColumns((row) => (
          <XtmRowMarks counterparts={counterparts.filter((c) => c.key === row.name.toUpperCase())} />
        ))}
        isLoading={isLoading}
        isPlaceholderData={isPlaceholderData}
        isFetching={isFetching}
        storageKey={TABLE_ID}
        initialPageSize={PAGE_LIMIT}
        initialSorting={DEFAULT_SORTING}
        pageIndex={page - 1}
        serverSorted
        onServerPageChange={(pagination) => setPage(pagination.pageIndex + 1)}
        emptyState={<NoUniqueFindingEmptyState searched={search !== ''} />}
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
            <FindingSourceSelect
              value={resolvedSource}
              sourceCounts={sourceCounts}
              onChange={(value) => {
                setFilters({ source: uniqueFindingsListSearchSchema.shape.source.parse(value) });
                setPage(1);
              }}
            />
          </div>
        )}
        onClickRow={(row) => {
          const { isTechnique, name, expectationType, vulnerabilityToken } = row.original;
          if (isTechnique && expectationType !== null) {
            void navigate({
              from: '/$tenantId/{-$organizationId}/findings/unique',
              to: '/$tenantId/{-$organizationId}/findings/technique/$externalId/$expectationType/overview',
              params: { externalId: name, expectationType },
            });
            return;
          }
          if (!isTechnique) {
            void navigate({
              from: '/$tenantId/{-$organizationId}/findings/unique',
              to: '/$tenantId/{-$organizationId}/findings/cve/$cveId',
              params: { cveId: name },
            });
            return;
          }
          if (vulnerabilityToken === null) {
            return;
          }
          void navigate({
            from: '/$tenantId/{-$organizationId}/findings/unique',
            to: '/$tenantId/{-$organizationId}/findings',
            search: { vulnerability: vulnerabilityToken },
          });
        }}
      />
    </FindingsListShell>
  );
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/findings/unique')({
  validateSearch: uniqueFindingsListSearchSchema,
  search: {
    middlewares: [
      stripSearchParams(UNIQUE_FINDINGS_LIST_SEARCH_DEFAULTS),
      // A tab carries the flat list's whole search over: its state and vulnerability mean nothing here.
      ({ search, next }) => {
        const { search: text, source } = next(search);
        return { search: text, source };
      },
    ],
  },
  component: UniqueFindingsList,
});
