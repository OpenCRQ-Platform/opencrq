import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { createFileRoute, stripSearchParams, useNavigate } from '@tanstack/react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { SectionCard } from '../../../../../../../../components/shared';
import { DataPageLayout } from '../../../../../../../../components/ui/data-page-layout';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../../../../../../components/ui/select';
import { dismissedStateFilterLabel } from '../../../../../../../../features/finding-detail';
import { toFindingSort } from '../../../../../../../../features/findings-home';
import { toUniqueTechniqueFindingAssetRow, uniqueTechniqueFindingAssetsColumns } from '../../../../../../../../features/unique-technique-finding';
import {
  UNIQUE_TECHNIQUE_FINDING_ASSETS_LIST_SEARCH_DEFAULTS,
  uniqueTechniqueFindingAssetsListSearchSchema,
} from '../../../../../../../../features/unique-technique-finding/unique-technique-finding-list-search';
import { usePersistedPageSize, usePersistedSorting, useUrlListFilters } from '../../../../../../../../hooks';
import { useTRPC } from '../../../../../../../../lib';
import { isEvidenceStateFilter } from '../../../../../../../../utils';
import { Route as UniqueTechniqueFindingRoute } from './route';

const TABLE_ID = 'unique-technique-finding.assets';
const PAGE_LIMIT = 50;
const DEFAULT_SORTING = [{ id: 'assetName', desc: false }];

const UniqueTechniqueFindingAssets = () => {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const { organizationId } = Route.useParams();
  const { finding } = UniqueTechniqueFindingRoute.useLoaderData();
  const { filters, setFilters } = useUrlListFilters(uniqueTechniqueFindingAssetsListSearchSchema);
  const { pageSize } = usePersistedPageSize(TABLE_ID, PAGE_LIMIT);
  const { sorting } = usePersistedSorting(TABLE_ID, DEFAULT_SORTING);
  const [page, setPage] = useState(1);
  const [activeSort] = sorting;
  const { sortBy, sortDesc } = toFindingSort(activeSort);

  const { data, isLoading, isPlaceholderData, isFetching } = useQuery(trpc.findingScore.listScoredFindings.queryOptions(
    {
      page,
      limit: pageSize,
      state: filters.state === 'all' ? null : filters.state,
      source: null,
      vulnerability: { kind: 'technique', externalId: finding.externalId, expectationType: finding.expectationType },
      organizationId: organizationId ?? null,
      sortBy,
      sortDesc,
    },
    { placeholderData: keepPreviousData },
  ));

  const rows = (data?.items ?? []).map((item) => toUniqueTechniqueFindingAssetRow(item));

  return (
    <SectionCard title={t`Affected assets`}>
      <DataPageLayout
        data={rows}
        total={data?.total ?? 0}
        columns={uniqueTechniqueFindingAssetsColumns({ showState: filters.state !== 'applicable' })}
        isLoading={isLoading}
        isPlaceholderData={isPlaceholderData}
        isFetching={isFetching}
        storageKey={TABLE_ID}
        initialPageSize={PAGE_LIMIT}
        initialSorting={DEFAULT_SORTING}
        pageIndex={page - 1}
        serverSorted
        onServerPageChange={(pagination) => setPage(pagination.pageIndex + 1)}
        emptyState={(
          <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
            <p><Trans>No finding stands in this state.</Trans></p>
          </div>
        )}
        leftHeaderContent={(
          <Select
            value={filters.state}
            onValueChange={(value) => {
              if (isEvidenceStateFilter(value)) {
                setFilters({ state: value });
                setPage(1);
              }
            }}
          >
            <SelectTrigger className="w-80" aria-label={t`Filter by state`}>
              <SelectValue placeholder={t`Filter by state`} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="applicable"><Trans>Applicable</Trans></SelectItem>
              <SelectItem value="dismissed">{dismissedStateFilterLabel('technique')}</SelectItem>
              <SelectItem value="all"><Trans>All states</Trans></SelectItem>
            </SelectContent>
          </Select>
        )}
        onClickRow={(row) => {
          void navigate({
            from: '/$tenantId/{-$organizationId}',
            to: 'findings/$evidenceId',
            params: { evidenceId: row.original.id },
          });
        }}
      />
    </SectionCard>
  );
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/findings/technique/$externalId/$expectationType/assets')({
  validateSearch: uniqueTechniqueFindingAssetsListSearchSchema,
  search: { middlewares: [stripSearchParams(UNIQUE_TECHNIQUE_FINDING_ASSETS_LIST_SEARCH_DEFAULTS)] },
  loader: () => ({ crumb: t`Assets` }),
  component: UniqueTechniqueFindingAssets,
});
