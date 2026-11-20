import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import { useNavigate } from '@tanstack/react-router';
import type { FunctionComponent, ReactElement } from 'react';
import { t } from '@lingui/core/macro';
import { useQuery } from '@tanstack/react-query';
import { DataPageWithCards } from '../../../components/ui/data-page-layout';
import { useTRPC } from '../../../lib';
import { truncateDescription } from '../../../utils';
import { AttackOutcomeCard } from './attack-outcome-card';

interface AttackOutcome {
  id: string,
  name: string,
  description: string | null,
}

export const AttackOutcomesDataTable: FunctionComponent = () => {
  const trpc = useTRPC();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery(trpc.attackOutcomes.getAttackOutcomes.queryOptions());

  const columns: Array<ColumnDefWithOptionsHeader<AttackOutcome, unknown>> = [
    {
      id: 'name',
      accessorKey: 'name',
      header: t`Name`,
      size: 200,
      cell: ({ row }): ReactElement => (
        <span className="font-medium">
          {row.original.name}
        </span>
      ),
    },
    {
      id: 'description',
      header: t`Description`,
      size: 300,
      cell: ({ row }): ReactElement => (
        <span className="text-muted-foreground">{truncateDescription(row.original.description)}</span>
      ),
    },
  ];

  const handleNavigate = (id: string) => {
    void navigate({
      from: '/$tenantId/{-$organizationId}',
      to: 'settings/taxonomies/attack-outcomes/$attackOutcomeId',
      params: { attackOutcomeId: id },
    });
  };

  return (
    <DataPageWithCards
      data={data ?? []}
      columns={columns}
      isLoading={isLoading}
      storageKey="attackOutcomes"
      defaultView="grid"
      onClickRow={(row) => handleNavigate(row.original.id)}
      renderCard={(outcome) => (
        <AttackOutcomeCard
          key={outcome.id}
          id={outcome.id}
          name={outcome.name}
          description={outcome.description ?? null}
          onNavigate={handleNavigate}
        />
      )}
    />
  );
};
