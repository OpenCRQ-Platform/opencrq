import { compareText } from '@app/utils/text-fold';
import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import type { FunctionComponent, ReactElement } from 'react';
import { t } from '@lingui/core/macro';
import { useQuery } from '@tanstack/react-query';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { useTRPC } from '../../../lib';
import { getCountryFlagEmoji } from '../../../utils';

interface Country {
  id: string,
  name: string,
  isoAlpha2: string,
  isoAlpha3: string,
}

export const CountriesDataTable: FunctionComponent = () => {
  const trpc = useTRPC();
  const { data, isLoading } = useQuery(trpc.countries.getCountries.queryOptions());

  const columns: Array<ColumnDefWithOptionsHeader<Country, unknown>> = [
    {
      id: 'name',
      accessorKey: 'name',
      header: t`Name`,
      size: 320,
      sortingFn: (rowA, rowB) => compareText(rowA.original.name, rowB.original.name),
      cell: ({ row }): ReactElement => (
        <span className="flex items-center gap-2">
          <span aria-hidden="true">{getCountryFlagEmoji(row.original.isoAlpha2)}</span>
          <span className="font-medium">{row.original.name}</span>
        </span>
      ),
    },
    {
      id: 'isoAlpha2',
      accessorKey: 'isoAlpha2',
      header: t`ISO Alpha-2`,
      size: 140,
      cell: ({ row }): ReactElement => (
        <span className="text-muted-foreground">{row.original.isoAlpha2}</span>
      ),
    },
    {
      id: 'isoAlpha3',
      accessorKey: 'isoAlpha3',
      header: t`ISO Alpha-3`,
      size: 140,
      cell: ({ row }): ReactElement => (
        <span className="text-muted-foreground">{row.original.isoAlpha3}</span>
      ),
    },
  ];

  return (
    <DataPageLayout
      data={data ?? []}
      columns={columns}
      isLoading={isLoading}
      storageKey="countries"
      initialSorting={[{ id: 'name', desc: false }]}
    />
  );
};
