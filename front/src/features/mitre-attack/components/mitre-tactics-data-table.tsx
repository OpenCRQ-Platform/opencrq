import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import { useNavigate } from '@tanstack/react-router';
import type { FunctionComponent, ReactElement } from 'react';
import { t } from '@lingui/core/macro';
import { useQuery } from '@tanstack/react-query';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { DebouncedSearchField } from '../../../components/shared';
import { useUrlListFilters } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { searchCatalogue } from '../catalogue-search-utils';
import { mitreAttackListSearchSchema } from '../mitre-attack-list-search';

interface MitreTactic {
  id: string,
  externalId: string,
  name: string,
  description: string | null,
  order: number,
}

export const MitreTacticsDataTable: FunctionComponent = () => {
  const trpc = useTRPC();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery(trpc.mitreAttack.getTactics.queryOptions());
  const { filters, setFilters } = useUrlListFilters(mitreAttackListSearchSchema);
  const rows = searchCatalogue(data ?? [], filters.search);

  const columns: Array<ColumnDefWithOptionsHeader<MitreTactic, unknown>> = [
    {
      id: 'externalId',
      accessorKey: 'externalId',
      header: t`ID`,
      size: 100,
      cell: ({ row }): ReactElement => (
        <span className="font-mono text-sm">{row.original.externalId}</span>
      ),
    },
    {
      id: 'name',
      accessorKey: 'name',
      header: t`Name`,
      size: 200,
      cell: ({ row }): ReactElement => (
        <span className="font-medium">{row.original.name}</span>
      ),
    },
    {
      id: 'order',
      accessorKey: 'order',
      header: t`Order`,
      size: 80,
    },
  ];

  return (
    <DataPageLayout
      data={rows}
      columns={columns}
      isLoading={isLoading}
      storageKey="mitreTactics"
      leftHeaderContent={(
        <DebouncedSearchField
          placeholder={t`Search tactics...`}
          value={filters.search}
          onCommit={(search) => setFilters({ search })}
          clearLabel={t`Clear search`}
          className="w-80"
        />
      )}
      onClickRow={(row) => {
        void navigate({
          from: '/$tenantId/{-$organizationId}',
          to: 'settings/taxonomies/mitre-attack/tactics/$tacticExternalId',
          params: { tacticExternalId: row.original.externalId },
        })
      }}
    />
  );
};
