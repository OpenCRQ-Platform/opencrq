import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import { useNavigate } from '@tanstack/react-router';
import type { FunctionComponent, ReactElement } from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { DebouncedSearchField } from '../../../components/shared';
import { useUrlListFilters } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { searchCatalogue } from '../catalogue-search-utils';
import { mitreAttackListSearchSchema } from '../mitre-attack-list-search';

interface MitreTechnique {
  id: string,
  externalId: string,
  name: string,
  isSubtechnique: boolean,
}

export const MitreTechniquesDataTable: FunctionComponent = () => {
  const trpc = useTRPC();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery(trpc.mitreAttack.getTechniques.queryOptions());
  const { filters, setFilters } = useUrlListFilters(mitreAttackListSearchSchema);
  const rows = searchCatalogue(data ?? [], filters.search);

  const columns: Array<ColumnDefWithOptionsHeader<MitreTechnique, unknown>> = [
    {
      id: 'externalId',
      accessorKey: 'externalId',
      header: t`ID`,
      size: 120,
      cell: ({ row }): ReactElement => (
        <span className="font-mono text-sm">{row.original.externalId}</span>
      ),
    },
    {
      id: 'name',
      accessorKey: 'name',
      header: t`Name`,
      size: 300,
      cell: ({ row }): ReactElement => (
        <span className={row.original.isSubtechnique ? 'pl-4 text-muted-foreground' : 'font-medium'}>
          {row.original.name}
        </span>
      ),
    },
    {
      id: 'isSubtechnique',
      accessorKey: 'isSubtechnique',
      header: t`Sub-technique`,
      size: 120,
      cell: ({ row }): ReactElement => (
        <span className="text-sm">
          {row.original.isSubtechnique ? <Trans>Yes</Trans> : <Trans>No</Trans>}
        </span>
      ),
    },
  ];

  return (
    <DataPageLayout
      data={rows}
      columns={columns}
      isLoading={isLoading}
      storageKey="mitreTechniques"
      initialSorting={[{ id: 'externalId', desc: false }]}
      leftHeaderContent={(
        <DebouncedSearchField
          placeholder={t`Search techniques...`}
          value={filters.search}
          onCommit={(search) => setFilters({ search })}
          clearLabel={t`Clear search`}
          className="w-80"
        />
      )}
      onClickRow={(row) => {
        void navigate({
          from: '/$tenantId/{-$organizationId}',
          to: 'settings/taxonomies/mitre-attack/techniques/$techniqueExternalId',
          params: { techniqueExternalId: row.original.externalId },
        })
      }}
    />
  );
};
