import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import { TREATMENT_PLAN_STATUSES } from '@app/module/client';
import { Button } from '@filigran/design-system';
import { EllipsisVertical } from 'lucide-react';
import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import type { inferRouterOutputs } from '@trpc/server';
import { useNavigate } from '@tanstack/react-router';
import type { FunctionComponent, ReactElement } from 'react';
import { useState } from 'react';
import { msg, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useMutation, useQuery } from '@tanstack/react-query';
import { DeleteConfirmDialog } from '../../../components/shared/delete-confirm-dialog';
import { IconActions, IconActionsItem } from '../../../components/shared/icon-actions';
import { DataPageWithCards } from '../../../components/ui/data-page-layout';
import { EmptyValue } from '../../../components/ui/empty-value';
import { ListEmptyCard } from '../../../components/ui/list-empty-card';
import { useConfirmationDialog } from '../../../hooks';
import { RiskScopeFilter } from '../../organizations/components/risk-scope-filter';
import { filterByRiskScope } from '../../organizations/risk-scope-filter-utils';
import { useRiskScopeFilter } from '../../organizations/use-risk-scope-filter';
import { useTRPC } from '../../../lib';
import { formatDate, formatDateTime } from '../../../utils';
import { formatDollar } from '../../../utils/format-currency';
import { AleReduction } from '../ui/ale-reduction';
import { ExpiredChip, OverdueChip, PlanStatusChip } from '../ui/plan-chips';
import { PlanReturn } from '../ui/plan-return';
import { isOverdue } from '../treatment-plan-utils';
import { TreatmentPlanCard } from './treatment-plan-card';
import { TreatmentPlanCreateDrawer } from './treatment-plan-create-drawer';
import { TreatmentPlansKpiBand } from './treatment-plans-kpi-band';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;
type TreatmentPlanRow = RouterOutputs['treatmentPlans']['getTreatmentPlans'][number];

const byReturnDescending = (a: TreatmentPlanRow, b: TreatmentPlanRow): number => {
  if (a.returnPercent === null || b.returnPercent === null) {
    return (a.returnPercent === null ? 1 : 0) - (b.returnPercent === null ? 1 : 0);
  }
  return b.returnPercent - a.returnPercent;
};

interface TreatmentPlansDataTableProps {
  organizationId?: string,
}

export const TreatmentPlansDataTable: FunctionComponent<TreatmentPlansDataTableProps> = ({ organizationId }) => {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const confirmationDialog = useConfirmationDialog();
  const { confirm, requestConfirmation } = confirmationDialog;
  const [isCreateOpen, setCreateOpen] = useState(false);

  const { data, isLoading } = useQuery(trpc.treatmentPlans.getTreatmentPlans.queryOptions({ organizationId }));
  const scopeFilterShown = organizationId === undefined;
  const { riskScope, scopes, setRiskScope } = useRiskScopeFilter(scopeFilterShown);

  const deletePlans = useMutation(trpc.treatmentPlans.deleteTreatmentPlans.mutationOptions({
    meta: { successMessage: msg`Treatment plan deleted successfully.` },
  }));

  // A grid has no header to sort by, so the cards keep the table's default order.
  const plans = [...filterByRiskScope(data ?? [], riskScope)].sort(byReturnDescending);

  const handleDeleteConfirm = () => {
    const id = confirm();
    if (id) {
      deletePlans.mutate([id]);
    }
  };

  const columns: Array<ColumnDefWithOptionsHeader<TreatmentPlanRow, unknown>> = [
    {
      id: 'name',
      accessorKey: 'name',
      header: t`Name`,
      size: 280,
      cell: ({ row }): ReactElement => (
        <span className="flex items-center gap-2">
          <span className="font-medium">{row.original.name}</span>
          {isOverdue(row.original.endDate) && <OverdueChip />}
        </span>
      ),
    },
    ...(organizationId === undefined
      ? [{
        id: 'organization',
        header: t`Risk scope`,
        size: 180,
        accessorFn: (row: TreatmentPlanRow) => row.organization.name ?? '',
        cell: ({ row }): ReactElement => (
          <span>{row.original.organization.name ?? <EmptyValue />}</span>
        ),
      } satisfies ColumnDefWithOptionsHeader<TreatmentPlanRow, unknown>]
      : []),
    {
      id: 'status',
      header: t`Status`,
      size: 130,
      accessorFn: (row) => TREATMENT_PLAN_STATUSES.indexOf(row.status),
      cell: ({ row }): ReactElement => <PlanStatusChip status={row.original.status} />,
    },
    {
      id: 'owner',
      header: t`Owner`,
      size: 160,
      accessorFn: (row) => row.owner?.name ?? '',
      cell: ({ row }): ReactElement => (
        <span>{row.original.owner?.name ?? <EmptyValue />}</span>
      ),
    },
    {
      id: 'endDate',
      header: t`Due date`,
      size: 130,
      accessorFn: (row) => row.endDate ?? undefined,
      sortUndefined: 'last',
      cell: ({ row }): ReactElement => (
        <span className="whitespace-nowrap">
          {row.original.endDate ? formatDate(row.original.endDate) : <EmptyValue />}
        </span>
      ),
    },
    {
      id: 'costYear1',
      header: t`First-year cost`,
      size: 140,
      accessorFn: (row) => row.costYear1 ?? undefined,
      sortUndefined: 'last',
      cell: ({ row }): ReactElement => (
        <span className="whitespace-nowrap">
          {row.original.costYear1 === null ? <EmptyValue /> : formatDollar(row.original.costYear1)}
        </span>
      ),
    },
    {
      id: 'aleReduction',
      header: t`ALE reduction`,
      size: 160,
      // Undefined rather than 0: a plan no run has priced yet parks at the bottom instead of
      // ranking as the one that buys the least.
      accessorFn: (row) => row.totalAleReduction ?? undefined,
      sortUndefined: 'last',
      cell: ({ row }): ReactElement => (
        <AleReduction value={row.original.totalAleReduction} />
      ),
    },
    {
      id: 'return',
      header: t`Return`,
      size: 120,
      accessorFn: (row) => row.returnPercent ?? undefined,
      sortUndefined: 'last',
      cell: ({ row }): ReactElement => (
        <PlanReturn value={row.original.returnPercent} className="font-medium" />
      ),
    },
    {
      id: 'pricedAt',
      header: t`Last simulation`,
      size: 280,
      accessorFn: (row) => row.pricedAt ?? undefined,
      sortUndefined: 'last',
      cell: ({ row }): ReactElement => (
        <span className="flex items-center gap-2 whitespace-nowrap">
          {row.original.pricedAt === null ? <EmptyValue /> : formatDateTime(row.original.pricedAt)}
          {row.original.expired && <ExpiredChip />}
        </span>
      ),
    },
    {
      id: 'actions',
      enableHiding: false,
      enableResizing: false,
      cell: ({ row }): ReactElement => (
        <div className="flex items-center justify-end">
          <IconActions icon={<EllipsisVertical className="h-4 w-4 text-primary" />}>
            <IconActionsItem
              onClick={(e) => {
                e.stopPropagation();
                requestConfirmation(row.original.id);
              }}
            >
              {t`Delete`}
            </IconActionsItem>
          </IconActions>
        </div>
      ),
    },
  ];

  const handleNavigate = (id: string) => {
    void navigate({
      from: '/$tenantId/{-$organizationId}',
      to: 'treatment-plans/$treatmentPlanId',
      params: { treatmentPlanId: id },
    });
  };

  return (
    <div className="flex flex-col gap-5">
      {(isLoading || plans.length > 0) && <TreatmentPlansKpiBand plans={isLoading ? undefined : plans} />}
      <DataPageWithCards
        data={plans}
        columns={columns}
        isLoading={isLoading}
        defaultView="grid"
        renderCard={(plan) => (
          <TreatmentPlanCard
            key={plan.id}
            plan={plan}
            onNavigate={handleNavigate}
            onDelete={requestConfirmation}
          />
        )}
        leftHeaderContent={scopeFilterShown ? <RiskScopeFilter value={riskScope} scopes={scopes} onChange={setRiskScope} /> : undefined}
        // The two modes keep their column preferences apart, so a column hidden inside a scope does
        // not disappear from the list that spans every scope.
        storageKey={organizationId === undefined ? 'treatmentPlansGlobal' : 'treatmentPlans'}
        initialSorting={[{ id: 'return', desc: true }]}
        onCreate={() => setCreateOpen(true)}
        onClickRow={(row) => handleNavigate(row.original.id)}
        onDeleteItems={(ids) => deletePlans.mutate(ids)}
        emptyState={(
          <ListEmptyCard
            title={<Trans>Start with a treatment plan</Trans>}
            body={(
              <Trans>
                A treatment plan is the set of controls you would fund, each aimed at a posture. The simulation
                re-prices the scope's scenarios against that posture, so the loss it removes is read against what
                the plan costs.
              </Trans>
            )}
            actions={(
              <Button onClick={() => setCreateOpen(true)}>
                <Trans>Create a risk treatment plan</Trans>
              </Button>
            )}
          />
        )}
      />
      <TreatmentPlanCreateDrawer
        open={isCreateOpen}
        onOpenChange={setCreateOpen}
        organizationId={organizationId}
        onCreated={handleNavigate}
      />
      <DeleteConfirmDialog
        open={confirmationDialog.isOpen}
        onOpenChange={(open) => {
          if (!open) {
            confirmationDialog.cancel();
          }
        }}
        onConfirm={handleDeleteConfirm}
        title={<Trans>Delete treatment plan</Trans>}
        description={<Trans>This will permanently delete this risk treatment plan and the control targets it holds. This action cannot be undone.</Trans>}
      />
    </div>
  );
};
