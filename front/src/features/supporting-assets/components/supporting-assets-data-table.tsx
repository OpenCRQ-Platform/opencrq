import { Button, Chip } from '@filigran/design-system';
import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import { Bot, EllipsisVertical, UserRound } from 'lucide-react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import type { FunctionComponent, ReactElement } from 'react';
import { useState } from 'react';
import { i18n } from '@lingui/core';
import { msg, plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { AssetCategory, AssetCriticality, AssetSortKey, AssetSubcategory } from '@app/module/client';
import { ASSET_CATEGORY_VALUES, postureBandForScore, postureSeverityBand } from '@app/module/client';
import { AssetName } from '../../../components/shared/asset-name';
import { ConfirmDialog } from '../../../components/shared/confirm-dialog';
import { DebouncedSearchField } from '../../../components/shared/debounced-search-field';
import { DeleteConfirmDialog } from '../../../components/shared/delete-confirm-dialog';
import { IconActions, IconActionsItem } from '../../../components/shared/icon-actions';
import { SourceStack } from '../../../components/shared/source-stack';
import { BadgeCellList } from '../../../components/ui/badge-cell-list';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { EmptyValue } from '../../../components/ui/empty-value';
import { FilterClearAll, FilterPill, FilterPillItem, FilterPillLabel, FilterPillSeparator } from '../../../components/ui/filter-pill';
import { ListEmptyCard } from '../../../components/ui/list-empty-card';
import { ListNoResults } from '../../../components/ui/list-no-results';
import { useConfirmationDialog, usePersistedPageSize, usePersistedSorting, useUrlListFilters } from '../../../hooks';
import { DeclaredEstateComparisonCard, declaredEstateComparisonChartOf } from '../../declared-estate';
import { ScoreGaugeMark } from '../../finding-score';
import { getConnectorIconBySource, getConnectorNameBySource } from '../../integrations';
import { ManageScopeAssetsButton, useOpenScopeDrawer } from '../../organizations';
import { useTRPC } from '../../../lib';
import { formatDate, getAssetCategoryLabel, getAssetCriticalityLabel, getAssetSubcategoryLabel, resolveOptionFilter } from '../../../utils';
import { resolveAssetsEmptyState } from '../assets-empty-state-utils';
import { exposureIsNotApplicable } from '../exposure-utils';
import { identityGlanceOf } from '../identity-glance-utils';
import { SUPPORTING_ASSETS_LIST_SEARCH_DEFAULTS, supportingAssetsListSearchSchema } from '../supporting-assets-list-search';
import { postureBandWord } from './posture-band-word';
import { SupportingAssetCreateSheet } from './supporting-asset-create-sheet';

interface SupportingAsset {
  id: string,
  tenantId: string,
  name: string | null,
  derivedName: string | null,
  description: string | null,
  ownerId: string | null,
  exposure: string,
  categoryId: AssetCategory,
  subcategoryId: AssetSubcategory | null,
  criticality: AssetCriticality,
  lastSeenAt: Date | string | null,
  applicableEvidenceCount: number,
  posture: number | null,
  techniqueCount: number,
  owner: { id: string | null, name: string | null } | null,
  sources: Array<string>,
  groups: Array<{ id: string, name: string }>,
}

const TABLE_ID = 'supportingAssets';
const PAGE_LIMIT = 50;
/** Category rows the chart shows whole on a short viewport before "Show all categories". */
const SHORT_VIEWPORT_CHART_ROWS = 3;
const DEFAULT_SORTING = [{ id: 'name', desc: false }];

/** The sentinel the `source` filter takes for an asset with no observation at all. */
const NO_SOURCE = 'user';

const sourceFilterLabel = (source: string): string => (source === NO_SOURCE ? t`Set by user` : (getConnectorNameBySource(source) ?? source));

/** Only the columns the server can order on: the others are marked `enableSorting: false`. */
const SORT_KEY_BY_COLUMN: Record<string, AssetSortKey | undefined> = {
  name: 'name',
  categoryId: 'categoryId',
  subcategoryId: 'subcategoryId',
  exposure: 'exposure',
  criticality: 'criticality',
  lastSeenAt: 'lastSeenAt',
  posture: 'posture',
};

const toSortKey = (columnId: string | undefined): AssetSortKey | undefined =>
  (columnId === undefined ? undefined : SORT_KEY_BY_COLUMN[columnId]);

export const SupportingAssetsDataTable: FunctionComponent = () => {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const openScopeDrawer = useOpenScopeDrawer();
  const { organizationId } = useParams({ strict: false });

  const [createSheetOpen, setCreateSheetOpen] = useState(false);
  const [isAskingEstimate, setAskingEstimate] = useState(false);
  const confirmationDialog = useConfirmationDialog();
  const { confirm, requestConfirmation } = confirmationDialog;

  const { filters, setFilters } = useUrlListFilters(supportingAssetsListSearchSchema);
  const { pageSize } = usePersistedPageSize(TABLE_ID, PAGE_LIMIT);
  const { sorting } = usePersistedSorting(TABLE_ID, DEFAULT_SORTING);
  const [page, setPage] = useState(1);
  const [activeSort] = sorting;
  const sortBy = toSortKey(activeSort?.id) ?? 'name';
  const sortDesc = activeSort?.desc ?? false;

  const { data: sourceCounts } = useQuery(trpc.supportingAssets.getAssetCountsBySource.queryOptions({ organizationId: organizationId ?? null }));
  // `sourceCounts` is `undefined` while its query is pending, not because the tenant has no
  // sources: that distinction is what tells a still-loading options list apart from a source a
  // shared link points to that no longer exists.
  const resolvedSource = resolveOptionFilter(filters.source, sourceCounts?.map((c) => c.source), 'all');
  const { data: assetGroups } = useQuery(trpc.supportingAssets.listAssetGroups.queryOptions());
  // Same rule as the source: a group a shared link names that the tenant no longer has drops out.
  const resolvedGroup = resolveOptionFilter(filters.group, assetGroups?.map((g) => g.id), 'all');

  const { data, isLoading, isPlaceholderData, isFetching } = useQuery(trpc.supportingAssets.listSupportingAssets.queryOptions(
    {
      page,
      limit: pageSize,
      search: filters.search.trim() === '' ? null : filters.search.trim(),
      source: resolvedSource === 'all' ? null : resolvedSource,
      categoryId: filters.category === 'all' ? null : filters.category,
      categoryMode: filters.categoryMode,
      groupId: resolvedGroup === 'all' ? null : resolvedGroup,
      organizationId: organizationId ?? null,
      membershipOrganizationId: null,
      sortBy,
      sortDesc,
    },
    { placeholderData: keepPreviousData },
  ));
  const { data: scope } = useQuery(trpc.organizations.getOrganization.queryOptions(
    { id: organizationId ?? '' },
    { enabled: organizationId !== undefined },
  ));
  const { data: comparison } = useQuery(trpc.declaredEstate.comparison.queryOptions({ organizationId: organizationId ?? null }));
  const { data: techniqueCounts } = useQuery(trpc.supportingAssets.getTechniqueCountPerCategory.queryOptions());
  const countByCategory = new Map<string, number>(
    (techniqueCounts ?? []).map((r) => [r.categoryId, r.techniqueCount]),
  );
  const enrichedData: Array<SupportingAsset> = (data?.items ?? []).map((asset) => ({
    ...asset,
    techniqueCount: countByCategory.get(asset.categoryId) ?? 0,
    sources: asset.sources.flatMap((s) => (s.source ? [s.source] : [])),
  }));
  const total = data?.total ?? 0;
  const observationCount = data?.totalObservations ?? 0;

  const deleteSupportingAssets = useMutation(trpc.supportingAssets.deleteSupportingAssets.mutationOptions({
    meta: { successMessage: msg`Supporting asset deleted successfully.` },
  }));

  const handleDeleteConfirm = () => {
    const id = confirm();
    if (id) {
      deleteSupportingAssets.mutate([id]);
    }
  };

  const columns: Array<ColumnDefWithOptionsHeader<SupportingAsset, unknown>> = [
    {
      id: 'name',
      accessorKey: 'name',
      header: t`Name`,
      size: 200,
      cell: ({ row }): ReactElement => {
        const glance = identityGlanceOf(row.original.categoryId, row.original.subcategoryId);
        return (
          <span className="flex min-w-0 items-center gap-1.5 font-medium">
            {glance !== null && (
              <span title={glance === 'human' ? t`Human identity` : t`Non-human identity`}>
                {glance === 'human'
                  ? <UserRound className="h-3.5 w-3.5 text-muted-foreground" aria-label={t`Human identity`} />
                  : <Bot className="h-3.5 w-3.5 text-muted-foreground" aria-label={t`Non-human identity`} />}
              </span>
            )}
            <AssetName name={row.original.name} derivedName={row.original.derivedName} className="min-w-0 truncate" />
          </span>
        );
      },
    },
    {
      id: 'posture',
      accessorKey: 'posture',
      header: t`Score`,
      size: 90,
      cell: ({ row }): ReactElement => {
        const { posture: score } = row.original;
        if (score === null) {
          return <EmptyValue />;
        }
        const band = postureBandForScore(score);
        const word = postureBandWord(band);
        return (
          <ScoreGaugeMark
            score={score}
            band={postureSeverityBand(band)}
            label={i18n._({ id: 'OpenCRQ Posture score: {score} out of 100, {word}', message: 'OpenCRQ Posture score: {score} out of 100, {word}', values: { score, word } })}
          />
        );
      },
    },
    {
      id: 'sources',
      accessorFn: (row) => row.sources.join(','),
      enableSorting: false,
      header: t`Sources`,
      size: 100,
      cell: ({ row }): ReactElement => <SourceStack sources={row.original.sources} />,
    },
    {
      id: 'categoryId',
      accessorKey: 'categoryId',
      header: t`Category`,
      size: 180,
      cell: ({ row }): ReactElement => (
        <Chip label={getAssetCategoryLabel(row.original.categoryId)} />
      ),
    },
    {
      id: 'subcategoryId',
      accessorKey: 'subcategoryId',
      header: t`Subcategory`,
      size: 160,
      cell: ({ row }): ReactElement => (
        row.original.subcategoryId === null
          ? <EmptyValue />
          : <span>{getAssetSubcategoryLabel(row.original.subcategoryId)}</span>
      ),
    },
    {
      id: 'groups',
      header: t`Groups`,
      enableSorting: false,
      size: 250,
      cell: ({ row }): ReactElement => <BadgeCellList items={row.original.groups} />,
    },
    {
      id: 'owner',
      header: t`Owner`,
      enableSorting: false,
      size: 150,
      cell: ({ row }): ReactElement => (
        <span className="text-muted-foreground">
          {row.original.owner?.name ?? <EmptyValue />}
        </span>
      ),
    },
    {
      id: 'exposure',
      accessorKey: 'exposure',
      header: t`Exposure`,
      size: 120,
      cell: ({ row }): ReactElement => {
        if (exposureIsNotApplicable(row.original.categoryId, row.original.exposure)) {
          return <span className="text-muted-foreground">{t`Not applicable`}</span>;
        }
        switch (row.original.exposure) {
          case 'internet_facing': return <Chip severity="critical" label={t`Internet`} />;
          case 'internal': return <Chip severity="info" label={t`Internal`} />;
          default: return <Chip label={t`Unknown`} />;
        }
      },
    },
    {
      id: 'criticality',
      accessorKey: 'criticality',
      header: t`Criticality`,
      size: 120,
      cell: ({ row }): ReactElement => <Chip label={getAssetCriticalityLabel(row.original.criticality)} />,
    },
    {
      id: 'lastSeenAt',
      accessorKey: 'lastSeenAt',
      header: t`Last seen`,
      size: 140,
      cell: ({ row }): ReactElement => (
        row.original.lastSeenAt === null ? <EmptyValue /> : <span>{formatDate(row.original.lastSeenAt)}</span>
      ),
    },
    {
      id: 'techniqueCount',
      header: t`Category TTPs`,
      enableSorting: false,
      size: 80,
      cell: ({ row }): ReactElement => {
        if (row.original.techniqueCount === 0) {
          return <EmptyValue />;
        }
        return <Chip label={String(row.original.techniqueCount)} />;
      },
    },
    {
      id: 'evidenceCount',
      header: t`Findings`,
      enableSorting: false,
      size: 100,
      cell: ({ row }): ReactElement => {
        if (row.original.applicableEvidenceCount === 0) {
          return <EmptyValue />;
        }
        return (
          <Chip
            label={String(row.original.applicableEvidenceCount)}
            onClick={(e) => {
              e.stopPropagation();
              void navigate({
                from: '/$tenantId/{-$organizationId}/assets',
                to: '$supportingAssetId/findings',
                params: { supportingAssetId: row.original.id },
              });
            }}
          />
        );
      },
    },
    {
      id: 'description',
      header: t`Description`,
      enableSorting: false,
      cell: ({ row }): ReactElement => (
        <span className="text-muted-foreground">
          {row.original.description ?? <EmptyValue />}
        </span>
      ),
    },
    {
      id: 'actions',
      enableHiding: false,
      enableResizing: false,
      cell: ({ row }): ReactElement => (
        <div className="flex items-center justify-end">
          <IconActions icon={<EllipsisVertical className="h-4 w-4 text-primary" />}>
            <IconActionsItem
              onClick={(e) => {
                e.stopPropagation();
                requestConfirmation(row.original.id);
              }}
            >
              {t`Delete`}
            </IconActionsItem>
          </IconActions>
        </div>
      ),
    },
  ];

  // Only a closed scope holding nothing has to tell an estate with assets from an estate without,
  // so the tenant-wide count is fetched there and nowhere else.
  const { data: estateCounts } = useQuery(trpc.supportingAssets.getAssetCountsBySource.queryOptions(
    { organizationId: null },
    { enabled: total === 0 && scope?.estateMode === 'closed' },
  ));
  const emptyState = resolveAssetsEmptyState({
    total,
    search: filters.search,
    source: resolvedSource,
    category: filters.category,
    group: resolvedGroup,
    estateMode: scope?.estateMode,
    estateTotal: estateCounts?.reduce((sum, row) => sum + row.assetCount, 0),
  });

  const applyFilters = (patch: Parameters<typeof setFilters>[0]): void => {
    setFilters(patch);
    setPage(1);
  };
  // The search counts as a filter: Clear all lifts it with the others, as Clear filters does.
  const activeFilterCount = [filters.search.trim() !== '', resolvedSource !== 'all', filters.category !== 'all', resolvedGroup !== 'all'].filter(Boolean).length;
  const categoryLabel = filters.category === 'all' ? '' : getAssetCategoryLabel(filters.category);

  const estimateEstate = organizationId === undefined ? undefined : () => setAskingEstimate(true);
  const declaredAt = comparison?.declaredAt ?? null;
  const chart = comparison === undefined ? null : declaredEstateComparisonChartOf(comparison.kinds);

  const estateEmptyCard = (
    <ListEmptyCard
      title={<Trans>Start with your assets</Trans>}
      body={(
        <Trans>
          A supporting asset is what a scenario is measured over: its exposure and its criticality are
          what turn an attack into an amount. Add one by hand, or connect an integration and let it bring
          the estate in.
        </Trans>
      )}
      actions={(
        <>
          <Button onClick={() => setCreateSheetOpen(true)}>
            <Trans>Create a new supporting asset</Trans>
          </Button>
          <Button
            priority="secondary"
            onClick={() => void navigate({ from: '/$tenantId/{-$organizationId}', to: 'integrations/available' })}
          >
            <Trans>Connect an integration</Trans>
          </Button>
          {estimateEstate !== undefined && (
            <Button priority="secondary" onClick={estimateEstate}>
              {declaredAt === null ? <Trans>Estimate my estate</Trans> : <Trans>Review my estimate</Trans>}
            </Button>
          )}
        </>
      )}
    />
  );
  const scopeUnmappedCard = scope && (
    <ListEmptyCard
      title={<Trans>No asset in this scope</Trans>}
      body={<Trans>Nothing is measured over it until an asset of the estate is mapped to it.</Trans>}
      actions={<ManageScopeAssetsButton organizationId={scope.id}><Trans>Manage assets</Trans></ManageScopeAssetsButton>}
    />
  );
  const emptyStateCard = emptyState === null ? undefined : {
    'no-results': <ListNoResults onClearFilters={() => applyFilters(SUPPORTING_ASSETS_LIST_SEARCH_DEFAULTS)} />,
    'scope-unmapped': scopeUnmappedCard || estateEmptyCard,
    'estate-empty': estateEmptyCard,
  }[emptyState];

  // The page itself never scrolls: the chart keeps its height and the table takes the rest, with its
  // rows scrolling inside it (Design standards s.3, one scroller). On a short viewport (a 720 px
  // laptop) the chart gives way: it shows its first rows whole behind "Show all categories", never a
  // scroller of its own, so the table keeps several rows.
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      {chart !== null && chart.rows.length > 0 && (
        <div className="shrink-0">
          <DeclaredEstateComparisonCard chart={chart} declaredAt={declaredAt} onEstimate={estimateEstate} shortViewportRows={SHORT_VIEWPORT_CHART_ROWS} />
        </div>
      )}
      <DataPageLayout
        data={enrichedData}
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
        fillHeight
        emptyState={emptyStateCard}
        leftHeaderContent={(
          <div className="flex flex-wrap items-center gap-3">
            <DebouncedSearchField
              placeholder={t`Search assets...`}
              value={filters.search}
              onCommit={(search) => {
                setFilters({ search });
                setPage(1);
              }}
              clearLabel={t`Clear search`}
              className="w-80"
            />
            <FilterPill
              label={t`Source`}
              valueLabel={resolvedSource === 'all' ? undefined : sourceFilterLabel(resolvedSource)}
            >
              <FilterPillItem selected={resolvedSource === 'all'} onSelect={() => applyFilters({ source: 'all' })}>
                <Trans>All sources</Trans>
              </FilterPillItem>
              {(sourceCounts ?? []).map(({ source, assetCount }) => {
                const icon = source === NO_SOURCE ? null : getConnectorIconBySource(source);
                return (
                  <FilterPillItem
                    key={source}
                    selected={resolvedSource === source}
                    onSelect={() => applyFilters({ source: supportingAssetsListSearchSchema.shape.source.parse(source) })}
                  >
                    <span className="flex items-center gap-1.5">
                      {source === NO_SOURCE && <UserRound className="h-3.5 w-3.5" />}
                      {icon !== null && <img src={icon} alt="" className="h-3.5 w-3.5 rounded-full object-contain" />}
                      {sourceFilterLabel(source)}
                      <span className="text-muted-foreground">({assetCount})</span>
                    </span>
                  </FilterPillItem>
                );
              })}
            </FilterPill>
            <FilterPill
              label={t`Category`}
              valueLabel={filters.category === 'all' ? undefined : categoryLabel}
              text={filters.category !== 'all' && filters.categoryMode === 'except' ? t`Category: except ${categoryLabel}` : undefined}
            >
              <FilterPillItem selected={filters.category === 'all'} onSelect={() => applyFilters({ category: 'all', categoryMode: 'only' })}>
                <Trans>All categories</Trans>
              </FilterPillItem>
              {ASSET_CATEGORY_VALUES.map((categoryId) => (
                <FilterPillItem key={categoryId} selected={filters.category === categoryId} onSelect={() => applyFilters({ category: categoryId })}>
                  {getAssetCategoryLabel(categoryId)}
                </FilterPillItem>
              ))}
              {filters.category !== 'all' && (
                <>
                  <FilterPillSeparator />
                  <FilterPillLabel><Trans>Match</Trans></FilterPillLabel>
                  <FilterPillItem selected={filters.categoryMode === 'only'} onSelect={() => applyFilters({ categoryMode: 'only' })}>
                    <Trans>Only</Trans>
                  </FilterPillItem>
                  <FilterPillItem selected={filters.categoryMode === 'except'} onSelect={() => applyFilters({ categoryMode: 'except' })}>
                    <Trans>Except</Trans>
                  </FilterPillItem>
                </>
              )}
            </FilterPill>
            {(assetGroups ?? []).length > 0 && (
              <FilterPill
                label={t`Group`}
                valueLabel={(assetGroups ?? []).find(({ id }) => id === resolvedGroup)?.name}
              >
                <FilterPillItem selected={resolvedGroup === 'all'} onSelect={() => applyFilters({ group: 'all' })}>
                  <Trans>All groups</Trans>
                </FilterPillItem>
                {(assetGroups ?? []).map(({ id, name, assetCount }) => (
                  <FilterPillItem key={id} selected={resolvedGroup === id} onSelect={() => applyFilters({ group: id })}>
                    <span className="flex items-center gap-1.5">
                      <span className="max-w-[220px] truncate" title={name}>{name}</span>
                      <span className="text-muted-foreground">({assetCount})</span>
                    </span>
                  </FilterPillItem>
                ))}
              </FilterPill>
            )}
            <FilterClearAll
              count={activeFilterCount}
              onClearAll={() => applyFilters(SUPPORTING_ASSETS_LIST_SEARCH_DEFAULTS)}
            />
            <span className="txt-sub-content text-muted-foreground">
              {plural(total, { one: '# asset', other: '# assets' })}
              {' · '}
              {plural(observationCount, { one: '# source observation', other: '# source observations' })}
            </span>
          </div>
        )}
        onCreate={() => setCreateSheetOpen(true)}
        onClickRow={(row) => {
          void navigate({
            from: '/$tenantId/{-$organizationId}/assets',
            to: '$supportingAssetId',
            params: { supportingAssetId: row.original.id },
          })
        }}
        onDeleteItems={(ids) => deleteSupportingAssets.mutate(ids)}
      />

      <DeleteConfirmDialog
        open={confirmationDialog.isOpen}
        onOpenChange={(open) => {
          if (!open) {
            confirmationDialog.cancel();
          }
        }}
        onConfirm={handleDeleteConfirm}
        title={<Trans>Delete supporting asset</Trans>}
        description={<Trans>This will permanently delete this supporting asset and all its dependency links. This action cannot be undone.</Trans>}
      />

      <SupportingAssetCreateSheet
        open={createSheetOpen}
        onOpenChange={setCreateSheetOpen}
        organizationId={organizationId}
      />
      {organizationId !== undefined && (
        <ConfirmDialog
          open={isAskingEstimate}
          onOpenChange={setAskingEstimate}
          onConfirm={() => openScopeDrawer(organizationId, 'declare-estate')}
          title={<Trans>The estate is declared on the risk scope</Trans>}
          description={<Trans>A scope's declared estate is managed from its own details page. Opening it leaves this page.</Trans>}
          submitButtonText={<Trans>Go to the risk scope</Trans>}
        />
      )}
    </div>
  );
};
