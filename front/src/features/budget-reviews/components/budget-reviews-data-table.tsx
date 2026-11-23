import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import { Button } from '@filigran/design-system';
import { msg, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useNavigate } from '@tanstack/react-router';
import type { inferRouterOutputs } from '@trpc/server';
import { EllipsisVertical } from 'lucide-react';
import type { FunctionComponent, ReactElement } from 'react';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import { DeleteConfirmDialog } from '../../../components/shared/delete-confirm-dialog';
import { IconActions, IconActionsItem } from '../../../components/shared/icon-actions';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { EmptyValue } from '../../../components/ui/empty-value';
import { ListEmptyCard } from '../../../components/ui/list-empty-card';
import { useConfirmationDialog } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { formatMonthYear } from '../../../utils/date-utils';
import { formatDollar } from '../../../utils/format-currency';
import { RiskScopeFilter } from '../../organizations/components/risk-scope-filter';
import { filterByRiskScope } from '../../organizations/risk-scope-filter-utils';
import { useRiskScopeFilter } from '../../organizations/use-risk-scope-filter';
import { AleReduction } from '../../treatment-plans/ui/ale-reduction';
import { PlanReturn } from '../../treatment-plans/ui/plan-return';
import { FigureStateChip, ReviewStatusChip } from '../ui/review-chips';
import { BudgetReviewCreateDrawer } from './budget-review-create-drawer';
import { BudgetReviewsKpiBand } from './budget-reviews-kpi-band';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;
type BudgetReviewRow = RouterOutputs['budgetReviews']['getBudgetReviews'][number];

interface BudgetReviewsDataTableProps {
  organizationId?: string,
}

export const BudgetReviewsDataTable: FunctionComponent<BudgetReviewsDataTableProps> = ({ organizationId }) => {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const confirmationDialog = useConfirmationDialog();
  const { confirm, requestConfirmation } = confirmationDialog;
  const [isCreateOpen, setCreateOpen] = useState(false);

  const { data, isLoading } = useQuery(trpc.budgetReviews.getBudgetReviews.queryOptions({ organizationId }));
  const scopeFilterShown = organizationId === undefined;
  const { riskScope, scopes, setRiskScope } = useRiskScopeFilter(scopeFilterShown);
  const reviews = filterByRiskScope(data ?? [], riskScope);
  const toleranceCounts = useQuery(trpc.dashboard.getToleranceCounts.queryOptions({ organizationId }, { enabled: reviews.length > 0 }));
  const toleranceScopes = toleranceCounts.isError ? null : toleranceCounts.data && filterByRiskScope(toleranceCounts.data, riskScope);

  const deleteReviews = useMutation(trpc.budgetReviews.deleteBudgetReviews.mutationOptions({
    meta: { successMessage: msg`Budget review deleted successfully.` },
  }));

  const handleDeleteConfirm = () => {
    const id = confirm();
    if (id) {
      deleteReviews.mutate([id]);
    }
  };

  const columns: Array<ColumnDefWithOptionsHeader<BudgetReviewRow, unknown>> = [
    {
      id: 'name',
      accessorKey: 'name',
      header: t`Name`,
      size: 260,
      cell: ({ row }): ReactElement => <span className="font-medium">{row.original.name}</span>,
    },
    ...(organizationId === undefined
      ? [{
        id: 'organization',
        header: t`Risk scope`,
        size: 180,
        accessorFn: (row: BudgetReviewRow) => row.organization.name ?? '',
        cell: ({ row }): ReactElement => (
          <span>{row.original.organization.name ?? <EmptyValue />}</span>
        ),
      } satisfies ColumnDefWithOptionsHeader<BudgetReviewRow, unknown>]
      : []),
    {
      id: 'status',
      header: t`Status`,
      size: 120,
      accessorFn: (row) => row.status,
      cell: ({ row }): ReactElement => <ReviewStatusChip status={row.original.status} />,
    },
    {
      id: 'period',
      accessorKey: 'periodStart',
      header: t`Period`,
      size: 180,
      cell: ({ row }): ReactElement => {
        const fromMonth = formatMonthYear(row.original.periodStart);
        const toMonth = formatMonthYear(row.original.periodEnd);
        return <span className="whitespace-nowrap">{t`${fromMonth} to ${toMonth}`}</span>;
      },
    },
    {
      id: 'owner',
      header: t`Owner`,
      size: 160,
      accessorFn: (row) => row.owner?.name ?? '',
      cell: ({ row }): ReactElement => <span>{row.original.owner?.name ?? <EmptyValue />}</span>,
    },
    {
      id: 'spent',
      accessorKey: 'spent',
      header: t`Spent`,
      size: 120,
      cell: ({ row }): ReactElement => <span className="whitespace-nowrap">{formatDollar(row.original.spent)}</span>,
    },
    {
      id: 'aleReduction',
      header: t`Loss avoided`,
      size: 200,
      accessorFn: (row) => row.aleReductionMean ?? undefined,
      sortUndefined: 'last',
      cell: ({ row }): ReactElement => (
        <span className="flex items-center gap-2 whitespace-nowrap">
          <AleReduction value={row.original.aleReductionMean} expired={row.original.state === 'expired'} />
          <FigureStateChip state={row.original.state} />
        </span>
      ),
    },
    {
      id: 'return',
      header: t`Return`,
      size: 110,
      accessorFn: (row) => row.returnPercent ?? undefined,
      sortUndefined: 'last',
      cell: ({ row }): ReactElement => <PlanReturn value={row.original.returnPercent} className="font-medium" />,
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
      to: 'budget-reviews/$budgetReviewId',
      params: { budgetReviewId: id },
    });
  };

  return (
    <>
      <div className="flex flex-col gap-5">
        {(isLoading || reviews.length > 0) && (
          <BudgetReviewsKpiBand
            reviews={isLoading ? undefined : reviews}
            toleranceCounts={toleranceScopes}
            tenantWide={organizationId === undefined}
          />
        )}
        <DataPageLayout
          data={reviews}
          columns={columns}
          isLoading={isLoading}
          leftHeaderContent={scopeFilterShown ? <RiskScopeFilter value={riskScope} scopes={scopes} onChange={setRiskScope} /> : undefined}
          // Inside a scope and across every scope, the column preferences are kept apart, so a column
          // hidden in one list does not vanish from the other.
          storageKey={organizationId === undefined ? 'budgetReviewsGlobal' : 'budgetReviews'}
          search={{ placeholder: t`Search budget reviews...`, texts: (review) => [review.name, review.owner?.name] }}
          initialSorting={[{ id: 'period', desc: true }]}
          onCreate={() => setCreateOpen(true)}
          onClickRow={(row) => handleNavigate(row.original.id)}
          onDeleteItems={(ids) => deleteReviews.mutate(ids)}
          emptyState={(
            <ListEmptyCard
              title={<Trans>Start with a budget review</Trans>}
              body={(
                <Trans>
                  A budget review sets a fiscal year's security spend against the annual loss it avoided, line by line:
                  build lines for the posture changes it paid for, run lines for the controls it kept running.
                </Trans>
              )}
              actions={(
                <Button onClick={() => setCreateOpen(true)}>
                  <Trans>Create a budget review</Trans>
                </Button>
              )}
            />
          )}
        />
      </div>
      <BudgetReviewCreateDrawer
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
        title={<Trans>Delete budget review</Trans>}
        description={<Trans>This will permanently delete this budget review, its budget lines and its figures. This action cannot be undone.</Trans>}
      />
    </>
  );
};
