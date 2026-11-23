import { Chip } from '@filigran/design-system';
import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import { ASSET_CATEGORY_VALUES } from '@app/module/client';
import type { AssetCategory } from '@app/module/client';
import { t } from '@lingui/core/macro';
import type { ReactElement } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { EmptyValue } from '../../../components/ui/empty-value';
import { useTRPC } from '../../../lib';
import { getAssetCategoryDescription, getAssetCategoryLabel } from '../../../utils';

type CategoryRow = {
  id: AssetCategory,
  name: string,
  description: string,
  techniqueCount: number,
};

export const SupportingAssetCategoriesDataTable = () => {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const { data: countsData, isLoading } = useQuery(trpc.supportingAssets.getTechniqueCountPerCategory.queryOptions());
  const countByCategory = new Map((countsData ?? []).map((r) => [r.categoryId, r.techniqueCount]));

  const rows: Array<CategoryRow> = ASSET_CATEGORY_VALUES.map((categoryId) => ({
    id: categoryId,
    name: getAssetCategoryLabel(categoryId),
    description: getAssetCategoryDescription(categoryId),
    techniqueCount: countByCategory.get(categoryId) ?? 0,
  }));

  const columns: Array<ColumnDefWithOptionsHeader<CategoryRow, unknown>> = [
    {
      id: 'name',
      accessorKey: 'name',
      header: t`Name`,
      size: 180,
      cell: ({ row }): ReactElement => <span className="font-medium">{row.original.name}</span>,
    },
    {
      id: 'description',
      accessorKey: 'description',
      header: t`Description`,
      cell: ({ row }): ReactElement => <span className="text-muted-foreground">{row.original.description}</span>,
    },
    {
      id: 'techniqueCount',
      accessorKey: 'techniqueCount',
      header: t`TTP count`,
      size: 100,
      cell: ({ row }): ReactElement => {
        if (row.original.techniqueCount === 0) {
          return <EmptyValue />;
        }
        return <Chip label={String(row.original.techniqueCount)} />;
      },
    },
  ];

  return (
    <DataPageLayout
      columns={columns}
      data={rows}
      isLoading={isLoading}
      storageKey="supportingAssetCategories"
      search={{ placeholder: t`Search categories...`, texts: (category) => [category.name, category.description] }}
      onClickRow={(row) => {
        void navigate({
          from: '/$tenantId/{-$organizationId}',
          to: 'settings/taxonomies/supporting-asset-categories/$categoryId',
          params: { categoryId: row.original.id },
        });
      }}
    />
  );
};
