import { Chip } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { TECHNIQUE_AFFECTED_ASSET_SORT_KEYS } from '@app/module/client';
import type { AssetCategory, AssetCriticality, DismissalType, EvidenceHistoryOrigin, ExpectationType } from '@app/module/client';
import type { ColumnDefWithOptionsHeader } from '../../../../../../../../../components/ui/data-table-types';
import { SectionCard } from '../../../../../../../../../components/shared';
import { AssetName } from '../../../../../../../../../components/shared/asset-name';
import { DataPageLayout } from '../../../../../../../../../components/ui/data-page-layout';
import { EmptyValue } from '../../../../../../../../../components/ui/empty-value';
import { TechniqueAssetsActivityChart } from '../../../../../../../../../features/supporting-assets/components/technique-assets-activity-chart';
import { usePersistedPageSize, usePersistedSorting } from '../../../../../../../../../hooks';
import { useTRPC } from '../../../../../../../../../lib';
import { assetNameText, formatDate, getAssetCategoryLabel, getAssetCriticalityLabel, getExpectationTypeLabel } from '../../../../../../../../../utils';
import { dismissedStateLabel } from '../../../../../../../../../features/finding-detail';
import { Route as TechniqueRoute } from './route';

const TABLE_ID = 'technique.assets';
const PAGE_LIMIT = 50;
const DEFAULT_SORTING = [{ id: 'assetName', desc: false }];

/** Every column sorts on its own id: a column absent from here must declare `enableSorting: false`. */
const toSortKey = (columnId: string | undefined) => TECHNIQUE_AFFECTED_ASSET_SORT_KEYS.find((key) => key === columnId);

interface AssetForTechniqueRow {
  evidenceId: string,
  supportingAssetId: string,
  assetName: string | null,
  assetDerivedName: string | null,
  assetCategoryId: AssetCategory | null,
  assetCriticality: AssetCriticality | null,
  expectationType: ExpectationType | null,
  securityPlatformType: string | null,
  currentState: 'applicable' | 'dismissed' | null,
  stateChangedAt: Date | string | null,
  stateOrigin: EvidenceHistoryOrigin | null,
  dismissalType: DismissalType | null,
}

const TechniqueAssets = () => {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const { technique } = TechniqueRoute.useLoaderData();

  const { pageSize } = usePersistedPageSize(TABLE_ID, PAGE_LIMIT);
  const { sorting } = usePersistedSorting(TABLE_ID, DEFAULT_SORTING);
  const [page, setPage] = useState(1);
  const [activeSort] = sorting;

  const { data: assetPage, isLoading, isPlaceholderData, isFetching } = useQuery(trpc.supportingAssets.getEvidencesForTechnique.queryOptions(
    {
      mitreTechniqueId: technique.id,
      page,
      limit: pageSize,
      sortBy: toSortKey(activeSort?.id) ?? 'assetName',
      sortDesc: activeSort?.desc ?? false,
    },
    { placeholderData: keepPreviousData },
  ));
  const dataWithId = (assetPage?.items ?? []).map((a) => ({ ...a, id: a.evidenceId }));

  const columns: Array<ColumnDefWithOptionsHeader<AssetForTechniqueRow & { id: string }, unknown>> = [
    {
      id: 'assetName',
      accessorFn: (row) => assetNameText({ name: row.assetName, derivedName: row.assetDerivedName }, t`Unnamed asset`),
      header: t`Asset`,
      size: 220,
      cell: ({ row }): ReactElement => (
        <span className="font-medium">
          <AssetName name={row.original.assetName} derivedName={row.original.assetDerivedName} />
        </span>
      ),
    },
    {
      id: 'assetCategoryId',
      accessorKey: 'assetCategoryId',
      header: t`Category`,
      size: 140,
      cell: ({ row }): ReactElement => (
        <span className="text-muted-foreground">
          {row.original.assetCategoryId ? getAssetCategoryLabel(row.original.assetCategoryId) : <EmptyValue />}
        </span>
      ),
    },
    {
      id: 'assetCriticality',
      accessorKey: 'assetCriticality',
      header: t`Criticality`,
      size: 110,
      cell: ({ row }): ReactElement => (
        <span className="text-muted-foreground">
          {row.original.assetCriticality ? getAssetCriticalityLabel(row.original.assetCriticality) : <EmptyValue />}
        </span>
      ),
    },
    {
      id: 'expectationType',
      accessorKey: 'expectationType',
      header: t`Detection type`,
      size: 130,
      cell: ({ row }): ReactElement => {
        const type = row.original.expectationType;
        if (!type) {
          return <EmptyValue />;
        }
        return <Chip label={getExpectationTypeLabel(type)} />;
      },
    },
    {
      id: 'securityPlatformType',
      accessorKey: 'securityPlatformType',
      header: t`Platform`,
      size: 120,
      cell: ({ row }): ReactElement => {
        const platform = row.original.securityPlatformType;
        if (!platform) {
          return <EmptyValue />;
        }
        return <Chip label={platform} />;
      },
    },
    {
      id: 'currentState',
      accessorKey: 'currentState',
      header: t`State`,
      size: 170,
      cell: ({ row }): ReactElement => {
        if (row.original.currentState === 'dismissed') {
          return <Chip label={dismissedStateLabel({ kind: 'technique', origin: row.original.stateOrigin, dismissalType: row.original.dismissalType })} />;
        }
        return <Chip label={t`Applicable`} />;
      },
    },
    {
      id: 'stateChangedAt',
      accessorKey: 'stateChangedAt',
      header: t`Last updated`,
      size: 150,
      cell: ({ row }): ReactElement => {
        const dateValue = row.original.stateChangedAt;
        if (!dateValue) {
          return <EmptyValue />;
        }
        return <span className="text-muted-foreground">{formatDate(dateValue)}</span>;
      },
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <SectionCard title={t`Impacted assets activity`}>
        <p className="txt-sub-content text-muted-foreground">{t`Applicable assets over the last year`}</p>
        <TechniqueAssetsActivityChart mitreTechniqueId={technique.id} />
      </SectionCard>
      <SectionCard title={t`Affected assets`}>
        <DataPageLayout
          data={dataWithId}
          total={assetPage?.total ?? 0}
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
          onClickRow={(row) => {
            void navigate({
              from: '/$tenantId/{-$organizationId}/settings/taxonomies/mitre-attack/techniques/$techniqueExternalId',
              to: '/$tenantId/{-$organizationId}/assets/$supportingAssetId/findings',
              params: { supportingAssetId: row.original.supportingAssetId },
            });
          }}
        />
      </SectionCard>
    </div>
  );
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/taxonomies/mitre-attack/techniques/$techniqueExternalId/assets')({
  loader: () => ({ crumb: t`Assets` }),
  component: TechniqueAssets,
});
