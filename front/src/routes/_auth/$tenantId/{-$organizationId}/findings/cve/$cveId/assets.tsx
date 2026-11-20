import { Chip } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { createFileRoute, stripSearchParams, useNavigate } from '@tanstack/react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useState } from 'react';
import type { AssetCriticality, SupportingAssetExposure } from '@app/module/client';
import type { ColumnDefWithOptionsHeader } from '../../../../../../../components/ui/data-table-types';
import type { FindingTableRow } from '../../../../../../../features/findings-home';
import type { UniqueAttackWayInView } from '../../../../../../../features/unique-cve-finding';
import { dismissedStateFilterLabel, MonoChip } from '../../../../../../../features/finding-detail';
import { exploitationTechniquesOf, resolveTechniqueFilter, techniqueFilterLabel } from '../../../../../../../features/unique-cve-finding';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../../../../../components/ui/select';
import { DataPageLayout } from '../../../../../../../components/ui/data-page-layout';
import {
  UNIQUE_CVE_FINDING_ASSETS_LIST_SEARCH_DEFAULTS,
  uniqueCveFindingAssetsListSearchSchema,
} from '../../../../../../../features/unique-cve-finding/unique-cve-finding-assets-list-search';
import { FindingSourceSelect, findingsTableColumns, toFindingSort, toFindingTableRow } from '../../../../../../../features/findings-home';
import { usePersistedPageSize, usePersistedSorting, useUrlListFilters } from '../../../../../../../hooks';
import { useTRPC } from '../../../../../../../lib';
import { getAssetCriticalityLabel, getAssetExposureLabel, isEvidenceStateFilter, resolveOptionFilter } from '../../../../../../../utils';

const TABLE_ID = 'unique-cve-finding-assets';
const PAGE_LIMIT = 50;

const DEFAULT_SORTING = [{ id: 'score', desc: true }];

/** Every row is this CVE, so the columns naming the flaw would repeat the page's title. */
const FLAW_COLUMNS = new Set(['name', 'kind']);

type AssetFindingRow = FindingTableRow & {
  assetCriticality: AssetCriticality,
  assetExposure: SupportingAssetExposure,
  exploitation: Array<UniqueAttackWayInView>,
};

const assetColumns = (showState: boolean): Array<ColumnDefWithOptionsHeader<AssetFindingRow, unknown>> => {
  const columns = findingsTableColumns<AssetFindingRow>({ showState, showAsset: true }).filter((column) => !FLAW_COLUMNS.has(column.id ?? ''));
  const typeIndex = columns.findIndex((column) => column.id === 'assetCategoryId');
  const added: Array<ColumnDefWithOptionsHeader<AssetFindingRow, unknown>> = [
    {
      id: 'assetCriticality',
      accessorFn: (row) => row.assetCriticality,
      enableSorting: false,
      header: t`Criticality`,
      size: 120,
      cell: ({ row }): ReactElement => <span>{getAssetCriticalityLabel(row.original.assetCriticality)}</span>,
    },
    {
      id: 'assetExposure',
      accessorFn: (row) => row.assetExposure,
      enableSorting: false,
      header: t`Exposure`,
      size: 160,
      cell: ({ row }): ReactElement => <span className="text-muted-foreground">{getAssetExposureLabel(row.original.assetExposure)}</span>,
    },
    {
      id: 'exploitation',
      accessorFn: (row) => row.exploitation.map((technique) => technique.externalId).join(' '),
      enableSorting: false,
      header: t`Exploitation`,
      size: 200,
      cell: ({ row }): ReactElement => (
        <span className="flex flex-wrap gap-1">
          {row.original.exploitation.map((technique) => (
            <span key={technique.mitreTechniqueId} title={technique.name}>
              <MonoChip>{technique.externalId}</MonoChip>
            </span>
          ))}
        </span>
      ),
    },
  ];
  return columns.toSpliced(typeIndex + 1, 0, ...added);
};

const UniqueCveFindingAssetsTab = () => {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const { organizationId, cveId } = Route.useParams();
  const { filters, setFilters } = useUrlListFilters(uniqueCveFindingAssetsListSearchSchema);
  const { pageSize } = usePersistedPageSize(TABLE_ID, PAGE_LIMIT);
  const { sorting } = usePersistedSorting(TABLE_ID, DEFAULT_SORTING);
  const [page, setPage] = useState(1);
  const [activeSort] = sorting;
  const { sortBy, sortDesc } = toFindingSort(activeSort);

  const { data: group } = useQuery(trpc.findingScore.getUniqueCveFinding.queryOptions({ cveId, organizationId: organizationId ?? null }));
  const { data: attack } = useQuery(trpc.findingScore.getUniqueCveFindingAttack.queryOptions({ cveId, organizationId: organizationId ?? null }));
  const waysIn = attack?.waysIn ?? [];
  const technique = resolveTechniqueFilter(filters.technique, attack);
  const { data: sourceCounts } = useQuery(trpc.findingScore.getFindingCountsBySource.queryOptions({ organizationId: organizationId ?? null }));
  const resolvedSource = resolveOptionFilter(filters.source, sourceCounts?.map((c) => c.source), 'all');
  // A CVE none of whose findings is applicable still lists them, so it opens on every state.
  const state = filters.state ?? (group?.affectedAssetCount === 0 ? 'all' : 'applicable');

  const { data, isLoading, isPlaceholderData, isFetching } = useQuery(trpc.findingScore.listScoredFindings.queryOptions(
    {
      page,
      limit: pageSize,
      state: state === 'all' ? null : state,
      source: resolvedSource === 'all' ? null : resolvedSource,
      vulnerability: { kind: 'cve', cveId },
      technique,
      organizationId: organizationId ?? null,
      sortBy,
      sortDesc,
    },
    { placeholderData: keepPreviousData, enabled: group !== undefined },
  ));

  const rows = (data?.items ?? []).map((finding) => ({
    ...toFindingTableRow(finding),
    assetCriticality: finding.assetCriticality,
    assetExposure: finding.assetExposure,
    exploitation: exploitationTechniquesOf(waysIn, finding.assetExposure, finding.assetCategoryId),
  }));

  return (
    <DataPageLayout
      data={rows}
      total={data?.total ?? 0}
      columns={assetColumns(state !== 'applicable')}
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
          <p>
            {technique === null
              ? <Trans>No finding of this vulnerability stands in this state.</Trans>
              : <Trans>No finding of this vulnerability in this state opens this technique.</Trans>}
          </p>
        </div>
      )}
      leftHeaderContent={(
        <div className="flex items-center gap-3">
          <Select
            value={state}
            onValueChange={(value) => {
              if (isEvidenceStateFilter(value)) {
                setFilters({ state: value });
                setPage(1);
              }
            }}
          >
            <SelectTrigger className="w-56" aria-label={t`Filter by state`}>
              <SelectValue placeholder={t`Filter by state`} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="applicable"><Trans>Applicable</Trans></SelectItem>
              <SelectItem value="dismissed">{dismissedStateFilterLabel('cve')}</SelectItem>
              <SelectItem value="all"><Trans>All states</Trans></SelectItem>
            </SelectContent>
          </Select>
          <FindingSourceSelect
            value={resolvedSource}
            sourceCounts={sourceCounts}
            onChange={(value) => {
              setFilters({ source: uniqueCveFindingAssetsListSearchSchema.shape.source.parse(value) });
              setPage(1);
            }}
          />
          {technique !== null && (
            <Chip
              label={techniqueFilterLabel(waysIn, technique)}
              deleteLabel={t`Remove the technique filter`}
              onDelete={() => {
                setFilters({ technique: undefined });
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
  );
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/findings/cve/$cveId/assets')({
  validateSearch: uniqueCveFindingAssetsListSearchSchema,
  search: { middlewares: [stripSearchParams(UNIQUE_CVE_FINDING_ASSETS_LIST_SEARCH_DEFAULTS)] },
  loader: () => ({ crumb: t`Assets` }),
  component: UniqueCveFindingAssetsTab,
});
