import { Chip } from '@filigran/design-system';
import type { ColumnDefWithOptionsHeader } from '../../../../../../../components/ui/data-table-types';
import { t } from '@lingui/core/macro';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import type { AssetCategory } from '@app/module/client';
import { ASSET_CATEGORY_VALUES } from '@app/module/client';
import { useQuery } from '@tanstack/react-query';
import { DetailPageLayout, SectionCard } from '../../../../../../../components/shared';
import { DataPageLayout } from '../../../../../../../components/ui/data-page-layout';
import { useTRPC } from '../../../../../../../lib';
import { getAssetCategoryDescription, getAssetCategoryLabel } from '../../../../../../../utils';

type TechniqueRow = {
  id: string,
  externalId: string,
  name: string,
  isSubtechnique: boolean,
};

const CategoryDetailPage = () => {
  const trpc = useTRPC();
  const { categoryId } = Route.useParams();
  const navigate = useNavigate();
   
  const isValidCategory = ASSET_CATEGORY_VALUES.some((v) => v === categoryId);

  const { data: techniques, isLoading } = useQuery(trpc.supportingAssets.getTechniquesByCategory.queryOptions(
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- categoryId is an AssetCategory; validated by isValidCategory above
    { categoryId: categoryId as AssetCategory },
    { enabled: isValidCategory },
  ));

  const label = getAssetCategoryLabel(categoryId);
  const description = getAssetCategoryDescription(categoryId);

  const columns: Array<ColumnDefWithOptionsHeader<TechniqueRow, unknown>> = [
    {
      id: 'externalId',
      accessorKey: 'externalId',
      header: t`ID`,
      size: 130,
      cell: ({ row }): ReactElement => (
        <span className="font-mono txt-body2">{row.original.externalId}</span>
      ),
    },
    {
      id: 'name',
      accessorKey: 'name',
      header: t`Name`,
      cell: ({ row }): ReactElement => (
        <span className={row.original.isSubtechnique ? 'pl-4 text-muted-foreground' : 'font-medium'}>
          {row.original.name}
        </span>
      ),
    },
    {
      id: 'type',
      accessorKey: 'isSubtechnique',
      header: t`Type`,
      size: 130,
      cell: ({ row }): ReactElement => (
        <Chip label={row.original.isSubtechnique ? t`Sub-technique` : t`Technique`} />
      ),
    },
  ];

  return (
    <DetailPageLayout title={label}>
      <SectionCard title={t`Details`}>
        <p className="txt-sub-content text-muted-foreground">{description}</p>
      </SectionCard>
      <SectionCard title={t`Techniques`}>
        <DataPageLayout
          columns={columns}
          data={techniques ?? []}
          isLoading={isLoading}
          storageKey="supportingAssetCategoryTechniques"
          search={{ placeholder: t`Search techniques...`, texts: (technique) => [technique.externalId, technique.name] }}
          onClickRow={(row) => {
            void navigate({
              from: '/$tenantId/{-$organizationId}',
              to: 'settings/taxonomies/mitre-attack/techniques/$techniqueExternalId',
              params: { techniqueExternalId: row.original.externalId },
            });
          }}
        />
      </SectionCard>
    </DetailPageLayout>
  );
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/taxonomies/supporting-asset-categories/$categoryId')({
  loader: ({ params }) => ({ crumb: getAssetCategoryLabel(params.categoryId) }),
  component: CategoryDetailPage,
});
