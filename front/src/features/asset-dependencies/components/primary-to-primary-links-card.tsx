import type { PrimaryToPrimaryLinkStrength } from '@app/module/client';
import { DataTable, DataTableHeadBarOptions } from '@filigran/ui';
import type { ColumnDefWithOptionsHeader } from '@filigran/ui';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { getSortedRowModel } from '@tanstack/react-table';
import type { FunctionComponent, ReactElement } from 'react';
import { SectionCard } from '../../../components';
import { EmptyValue } from '../../../components/ui/empty-value';
import { FilterPill, FilterPillItem } from '../../../components/ui/filter-pill';
import { getDataTableI18nKey } from '../../../components/ui/data-table-i18n';
import { useUrlListFilters } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { useTenant } from '../../../providers/tenant-provider';
import { resolveOptionFilter } from '../../../utils';
import { withTextAwareSorting } from '../../../utils/table-sorting-utils';
import { getLinkStrengthLabel } from '../link-strength-labels';
import { primaryAssetDependenciesListSearchSchema } from '../primary-asset-dependencies-list-search';
import { ANY_RESOURCE_TYPE, filterLinksByResourceType, resourceTypeOptions } from '../primary-to-primary-links-utils';

interface PrimaryToPrimaryLinkRow {
  id: string,
  direction: 'provides' | 'depends',
  relatedAssetId: string,
  relatedAssetName: string,
  strength: PrimaryToPrimaryLinkStrength,
  dependencyResourceTypeId: string | null,
  dependencyResourceTypeName: string | null,
}

const STRENGTH_ORDER: Record<PrimaryToPrimaryLinkStrength, number> = { critical: 0, important: 1, minor: 2, unknown: 3 };

export const PrimaryToPrimaryLinksCard: FunctionComponent<{ primaryAssetId: string }> = ({ primaryAssetId }) => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { tenantId } = useTenant();
  const { filters, setFilters } = useUrlListFilters(primaryAssetDependenciesListSearchSchema);

  const { data: links } = useQuery(trpc.assetDependencies.getPrimaryToPrimaryLinks.queryOptions({ primaryAssetId }));
  const options = links === undefined ? undefined : resourceTypeOptions(links);
  const resourceType = resolveOptionFilter(filters.resourceType, options?.map((option) => option.value), ANY_RESOURCE_TYPE);
  const rows = filterLinksByResourceType(links ?? [], resourceType);

  const noType = t`No type`;
  const optionLabel = (name: string | null) => name ?? noType;
  const pickedLabel = options?.find((option) => option.value === resourceType)?.name;

  const columns: Array<ColumnDefWithOptionsHeader<PrimaryToPrimaryLinkRow, unknown>> = [
    {
      id: 'relationship',
      header: t`Relationship`,
      accessorFn: (link) => link.direction,
      size: 150,
      cell: ({ row }): ReactElement => (
        <span className="flex items-center gap-1.5">
          <span className="text-muted-foreground">{row.original.direction === 'depends' ? '←' : '→'}</span>
          <span>{row.original.direction === 'depends' ? t`Depends on` : t`Supports`}</span>
        </span>
      ),
    },
    {
      id: 'relatedAsset',
      header: t`Primary asset`,
      accessorFn: (link) => link.relatedAssetName,
      cell: ({ row }): ReactElement => <span>{row.original.relatedAssetName}</span>,
    },
    {
      id: 'strength',
      header: t({ message: 'Strength', context: 'of a dependency' }),
      accessorFn: (link) => STRENGTH_ORDER[link.strength],
      size: 130,
      cell: ({ row }): ReactElement => <span>{getLinkStrengthLabel(row.original.strength)}</span>,
    },
    {
      id: 'resourceType',
      header: t`Runs through`,
      accessorFn: (link) => link.dependencyResourceTypeName ?? '',
      size: 170,
      cell: ({ row }): ReactElement => (row.original.dependencyResourceTypeName === null
        ? <EmptyValue />
        : <span>{row.original.dependencyResourceTypeName}</span>),
    },
  ];

  const openRelatedAsset = async ({ original }: { original: PrimaryToPrimaryLinkRow }) => {
    try {
      const related = await queryClient.query(trpc.primaryAssets.getPrimaryAsset.queryOptions({ id: original.relatedAssetId }));
      if (related) {
        void navigate({
          to: '/$tenantId/{-$organizationId}/primary-assets/$primaryAssetId/dependencies',
          params: { tenantId, organizationId: related.organizationId, primaryAssetId: original.relatedAssetId },
        });
      }
    } catch {
      // The row stays where it is: the list names the asset already.
    }
  };

  return (
    <SectionCard title={t`Primary-to-Primary Dependencies`}>
      <DataTable
        i18nKey={getDataTableI18nKey()}
        data={rows}
        columns={withTextAwareSorting(columns)}
        toolbar={(
          <div className="flex items-center justify-between gap-2">
            <FilterPill
              label={t`Runs through`}
              valueLabel={resourceType === ANY_RESOURCE_TYPE ? undefined : optionLabel(pickedLabel ?? null)}
            >
              <FilterPillItem selected={resourceType === ANY_RESOURCE_TYPE} onSelect={() => setFilters({ resourceType: ANY_RESOURCE_TYPE })}>
                <Trans>All resource types</Trans>
              </FilterPillItem>
              {(options ?? []).map((option) => (
                <FilterPillItem
                  key={option.value}
                  selected={resourceType === option.value}
                  onSelect={() => setFilters({ resourceType: option.value })}
                >
                  {optionLabel(option.name)}
                </FilterPillItem>
              ))}
            </FilterPill>
            <DataTableHeadBarOptions />
          </div>
        )}
        tableOptions={{
          getSortedRowModel: getSortedRowModel(),
        }}
        onClickRow={openRelatedAsset}
      />
    </SectionCard>
  );
};
