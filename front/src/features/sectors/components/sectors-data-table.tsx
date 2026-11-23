import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import type { FunctionComponent, ReactElement } from 'react';
import { t } from '@lingui/core/macro';
import { useQuery } from '@tanstack/react-query';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { useTRPC } from '../../../lib';
import { truncateDescription } from '../../../utils';

interface Sector {
  id: string,
  name: string,
  description: string | null,
}

export const SectorsDataTable: FunctionComponent = () => {
  const trpc = useTRPC();
  const { data, isLoading } = useQuery(trpc.sectors.getSectors.queryOptions());

  const columns: Array<ColumnDefWithOptionsHeader<Sector, unknown>> = [
    {
      id: 'name',
      accessorKey: 'name',
      header: t`Name`,
      size: 280,
      cell: ({ row }): ReactElement => (
        <span className="font-medium">{row.original.name}</span>
      ),
    },
    {
      id: 'description',
      header: t`Description`,
      size: 420,
      cell: ({ row }): ReactElement => (
        <span className="text-muted-foreground">{truncateDescription(row.original.description)}</span>
      ),
    },
  ];

  return (
    <DataPageLayout
      data={data ?? []}
      columns={columns}
      isLoading={isLoading}
      storageKey="sectors"
      search={{ placeholder: t`Search sectors...`, texts: (sector) => [sector.name, sector.description] }}
      initialSorting={[{ id: 'name', desc: false }]}
    />
  );
};
