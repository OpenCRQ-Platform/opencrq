import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import { useNavigate } from '@tanstack/react-router';
import type { FunctionComponent, ReactElement } from 'react';
import { t } from '@lingui/core/macro';
import { useQuery } from '@tanstack/react-query';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { useTRPC } from '../../../lib';
import { truncateDescription } from '../../../utils';
import { businessResourceName, businessResourcePickerLine } from '../business-resource-labels';

interface BusinessValueCategoryRow {
  id: string,
  code: string,
  name: string,
  description: string | null,
  displayOrder: number,
}

export const BusinessValueCategoriesDataTable: FunctionComponent = () => {
  const trpc = useTRPC();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery(trpc.businessValueCategories.getBusinessValueCategories.queryOptions());

  const columns: Array<ColumnDefWithOptionsHeader<BusinessValueCategoryRow, unknown>> = [
    {
      id: 'name',
      accessorKey: 'name',
      header: t`Name`,
      size: 260,
      cell: ({ row }): ReactElement => (
        <span className="font-medium">{businessResourceName(row.original)}</span>
      ),
    },
    {
      id: 'description',
      header: t`Description`,
      size: 400,
      cell: ({ row }): ReactElement => (
        <span className="text-muted-foreground">{truncateDescription(businessResourcePickerLine(row.original))}</span>
      ),
    },
  ];

  return (
    <DataPageLayout
      data={data ?? []}
      columns={columns}
      isLoading={isLoading}
      storageKey="businessValueCategories"
      onClickRow={(row) => {
        void navigate({
          from: '/$tenantId/{-$organizationId}',
          to: 'settings/taxonomies/business-value-categories/$businessValueCategoryId',
          params: { businessValueCategoryId: row.original.id },
        });
      }}
    />
  );
};
