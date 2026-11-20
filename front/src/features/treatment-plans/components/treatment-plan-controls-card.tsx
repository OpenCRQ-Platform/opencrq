import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import { Button } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useNavigate } from '@tanstack/react-router';
import type { inferRouterOutputs } from '@trpc/server';
import { PencilIcon } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent, ReactElement } from 'react';
import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import type { PlanMoveAxis } from '../treatment-plan-utils';
import { ControlIdPill, SectionCard } from '../../../components/shared';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { EmptyValue } from '../../../components/ui/empty-value';
import { CoverageBadge } from '../../controls/capability/ui/coverage-badge';
import { StrengthBadge } from '../../controls/capability/ui/strength-badge';
import { useTRPC } from '../../../lib';
import { PlanAxisCurrent } from '../ui/plan-axis-chips';
import { planDimensionLabel } from '../ui/plan-dimension';
import { PlanMoveWarningHint } from '../ui/plan-move-warning';
import { isAxisAimed, planMoveRows, planMoveWarning } from '../treatment-plan-utils';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;
type PlanCandidate = RouterOutputs['treatmentPlans']['getTreatmentPlanCandidates'][number];
type MoveRow = PlanCandidate & { id: string, axis: PlanMoveAxis };

/** A row is here because its axis is aimed, so the dash is a state the filter already ruled out. */
const AxisTargetBadge: FunctionComponent<{ row: MoveRow }> = ({ row }) => {
  switch (row.axis) {
    case 'strength':
      return row.targetStrengthRung === null ? <EmptyValue /> : <StrengthBadge value={row.targetStrengthRung} />;
    case 'coverage':
      return row.targetCoverageBucket === null ? <EmptyValue /> : <CoverageBadge value={row.targetCoverageBucket} />;
  }
};

const AxisTarget: FunctionComponent<{ row: MoveRow }> = ({ row }) => {
  const warning = planMoveWarning(row, row.axis);
  return (
    <span className="flex items-center gap-2">
      <AxisTargetBadge row={row} />
      {warning !== null && <PlanMoveWarningHint warning={warning} />}
    </span>
  );
};

interface TreatmentPlanControlsCardProps {
  planId: string,
  onEditControls: () => void,
}

/**
 * The moves the plan makes, one row per axis, with no amount.
 *
 * A column per line would invite an addition that overstates: the engine prices the whole posture
 * in one pass, and two controls covering the same technique return less than the sum of their
 * parts. The plan's amount lives in the per-scenario card, and the ranking figure in the drawer.
 */
export const TreatmentPlanControlsCard: FunctionComponent<TreatmentPlanControlsCardProps> = ({ planId, onEditControls }) => {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const { data: candidates, isLoading } = useQuery(trpc.treatmentPlans.getTreatmentPlanCandidates.queryOptions({ planId }));

  const moves: Array<MoveRow> = planMoveRows((candidates ?? []).map((candidate) => ({ ...candidate, id: candidate.capabilityId })))
    .filter((row) => isAxisAimed(row, row.axis));
  const moveCount = moves.length;

  const columns: Array<ColumnDefWithOptionsHeader<MoveRow, unknown>> = [
    {
      id: 'name',
      accessorKey: 'name',
      header: t`Control`,
      size: 300,
      cell: ({ row }): ReactElement => (
        <span className="flex items-center gap-2">
          <ControlIdPill externalId={row.original.externalId} />
          <span className="min-w-0 truncate font-medium">{row.original.name}</span>
        </span>
      ),
    },
    {
      id: 'dimension',
      accessorKey: 'axis',
      header: t`Dimension`,
      size: 140,
      cell: ({ row }): ReactElement => <span>{planDimensionLabel(row.original.axis)}</span>,
    },
    {
      id: 'current',
      header: t`Current`,
      size: 160,
      enableSorting: false,
      cell: ({ row }): ReactElement => <PlanAxisCurrent row={row.original} axis={row.original.axis} />,
    },
    {
      id: 'target',
      header: t`Target`,
      size: 220,
      enableSorting: false,
      cell: ({ row }): ReactElement => <AxisTarget row={row.original} />,
    },
  ];

  return (
    <SectionCard
      title={<Trans>Moves of the plan · {moveCount}</Trans>}
      headerAction={(
        <Button priority="tertiary" size="sm" startIcon={<PencilIcon className="size-3" />} onClick={onEditControls}>
          {moveCount === 0 ? <Trans>Choose the controls</Trans> : <Trans>Edit the controls</Trans>}
        </Button>
      )}
    >
      <DataPageLayout
        data={moves}
        columns={columns}
        isLoading={isLoading}
        storageKey="treatmentPlanControls"
        hideToolbar
        onClickRow={(row) => void navigate({
          from: '/$tenantId/{-$organizationId}',
          to: 'controls/$controlId/overview',
          params: { controlId: row.original.capabilityId },
        })}
        emptyState={(
          <p className="txt-sub-content text-default-secondary">
            <Trans>This plan moves no control yet.</Trans>
          </p>
        )}
      />
    </SectionCard>
  );
};
