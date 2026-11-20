import { Chip } from '@filigran/design-system';
import type { DismissalType, EvidenceHistoryOrigin } from '@app/module/client';
import { CVE_AFFECTED_ASSET_SORT_KEYS } from '@app/module/client';
import type { ColumnDefWithOptionsHeader } from '../../../../../../../components/ui/data-table-types';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { t } from '@lingui/core/macro';
import { DescriptionField, DetailPageLayout, InfoField, SectionCard } from '../../../../../../../components/shared';
import { DataPageLayout } from '../../../../../../../components/ui/data-page-layout';
import { AssetName } from '../../../../../../../components/shared/asset-name';
import { EmptyValue } from '../../../../../../../components/ui/empty-value';
import { ThreatListTable } from '../../../../../../../features/threats/components/threat-list-table';
import { ThreatsCveActivityChart } from '../../../../../../../features/threats/components/threats-cve-activity-chart';
import { CveAssetsActivityChart } from '../../../../../../../features/supporting-assets/components/cve-assets-activity-chart';
import { usePersistedPageSize, usePersistedSorting } from '../../../../../../../hooks';
import { useTRPC } from '../../../../../../../lib';
import { assetNameText } from '../../../../../../../utils/asset-name-utils';
import { formatDate } from '../../../../../../../utils/date-utils';
import { formatFixed, formatFractionAsPercent } from '../../../../../../../utils/format-number';
import { dismissedStateLabel } from '../../../../../../../features/finding-detail';

const TABLE_ID = 'cve.assets';
const PAGE_LIMIT = 50;
const DEFAULT_SORTING = [{ id: 'assetName', desc: false }];

/** Every column sorts on its own id: a column absent from here must declare `enableSorting: false`. */
const toSortKey = (columnId: string | undefined) => CVE_AFFECTED_ASSET_SORT_KEYS.find((key) => key === columnId);

interface AssetForCveRow {
  evidenceId: string,
  supportingAssetId: string,
  assetName: string | null,
  assetDerivedName: string | null,
  assetCategoryId: string | null,
  assetCriticality: string | null,
  currentState: 'applicable' | 'dismissed' | null,
  stateChangedAt: Date | string | null,
  stateOrigin: EvidenceHistoryOrigin | null,
  dismissalType: DismissalType | null,
}

const CveDetailPage = () => {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const { cveId } = Route.useParams();

  const { pageSize } = usePersistedPageSize(TABLE_ID, PAGE_LIMIT);
  const { sorting } = usePersistedSorting(TABLE_ID, DEFAULT_SORTING);
  const [page, setPage] = useState(1);
  const [activeSort] = sorting;

  const { data: cveInfo } = useQuery(trpc.cve.getInfo.queryOptions({ cveId }));
  const { data: assetPage, isLoading, isPlaceholderData, isFetching } = useQuery(trpc.supportingAssets.getEvidencesForCve.queryOptions(
    {
      cveId,
      page,
      limit: pageSize,
      sortBy: toSortKey(activeSort?.id) ?? 'assetName',
      sortDesc: activeSort?.desc ?? false,
    },
    { placeholderData: keepPreviousData },
  ));
  const { data: rawThreats, isLoading: isLoadingThreats } = useQuery(trpc.threats.getByCveId.queryOptions(
    { cveId },
  ));
  const assets = assetPage?.items ?? [];
  const threats = rawThreats ?? [];

  const dataWithId = assets.map((a) => ({ ...a, id: a.evidenceId }));

  const columns: Array<ColumnDefWithOptionsHeader<AssetForCveRow & { id: string }, unknown>> = [
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
      size: 160,
      cell: ({ row }): ReactElement => (
        <span className="text-muted-foreground">
          {row.original.assetCategoryId ?? <EmptyValue />}
        </span>
      ),
    },
    {
      id: 'assetCriticality',
      accessorKey: 'assetCriticality',
      header: t`Criticality`,
      size: 120,
      cell: ({ row }): ReactElement => (
        <span className="text-muted-foreground">
          {row.original.assetCriticality ?? <EmptyValue />}
        </span>
      ),
    },
    {
      id: 'currentState',
      accessorKey: 'currentState',
      header: t`State`,
      size: 170,
      cell: ({ row }): ReactElement => {
        const stateValue = row.original.currentState;
        if (stateValue === 'dismissed') {
          return <Chip label={dismissedStateLabel({ kind: 'cve', origin: row.original.stateOrigin, dismissalType: row.original.dismissalType })} />;
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
        return (
          <span className="text-muted-foreground">
            {formatDate(dateValue)}
          </span>
        );
      },
    },
  ];

  const formatOptionalDate = (d: Date | string | null | undefined) =>
    d ? formatDate(d) : null;

  const formatEpss = (v: number | null | undefined) =>
    v != null ? formatFractionAsPercent(v, 2) : null;

  const formatWithDate = (value: string | null, updatedAt: Date | string | null | undefined) => {
    if (value == null) {
      return null;
    }
    const date = formatOptionalDate(updatedAt);
    return date ? t`${value} (updated ${date})` : value;
  };

  return (
    <DetailPageLayout title={cveId}>
      <div className="flex flex-col gap-6">
        <SectionCard title={t`CVE Information`}>
          <InfoField title={t`ID`} value={cveId} />
          <InfoField title={t`Title`} value={cveInfo?.cveTitle ?? null} />
          <DescriptionField title={t`Description`} value={cveInfo?.cveDescription ?? null} />
          <InfoField
            title={t`CVSS`}
            value={formatWithDate(cveInfo?.cvss != null ? formatFixed(cveInfo.cvss, 1) : null, cveInfo?.cvssUpdatedAt)}
          />
          <InfoField
            title={t`EPSS`}
            value={formatWithDate(formatEpss(cveInfo?.epss), cveInfo?.epssUpdatedAt)}
          />
          <InfoField
            title={t`KEV`}
            value={formatWithDate(cveInfo ? (cveInfo.kev ? t`Yes` : t`No`) : null, cveInfo?.kevUpdatedAt)}
          />
        </SectionCard>
        <div className="flex flex-col gap-4">
          <SectionCard title={t`Impacted assets activity`} cardClassName="flex-1">
            <p className="txt-sub-content text-muted-foreground">{t`Applicable assets over the last year`}</p>
            <CveAssetsActivityChart cveId={cveId} />
          </SectionCard>
          <SectionCard title={t`Threats activity`} cardClassName="flex-1">
            <p className="txt-sub-content text-muted-foreground">{t`Threats targeting this CVE over the last year`}</p>
            <ThreatsCveActivityChart cveId={cveId} />
          </SectionCard>
        </div>
      </div>
      <SectionCard title={t`Affected Assets`}>
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
              from: '/$tenantId/{-$organizationId}/settings/taxonomies/cve/$cveId',
              to: '/$tenantId/{-$organizationId}/assets/$supportingAssetId/findings',
              params: { supportingAssetId: row.original.supportingAssetId },
            });
          }}
        />
      </SectionCard>
      <SectionCard title={t`Threats`}>
        <ThreatListTable
          data={threats}
          isLoading={isLoadingThreats}
          storageKey="cve.threats"
        />
      </SectionCard>
    </DetailPageLayout>
  );
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/taxonomies/cve/$cveId')({
  loader: ({ params }) => ({ crumb: params.cveId }),
  component: CveDetailPage,
});
