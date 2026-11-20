import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import { t } from '@lingui/core/macro';
import type { inferRouterOutputs } from '@trpc/server';
import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import type { HeldPlanMove, PlanMoveAxis } from '../treatment-plan-utils';
import type { FunctionComponent, ReactElement, ReactNode } from 'react';
import { ControlIdPill } from '../../../components/shared';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { CoverageBadge } from '../../controls/capability/ui/coverage-badge';
import { coverageLabel } from '../../controls/capability/ui/coverage-label';
import { StrengthBadge } from '../../controls/capability/ui/strength-badge';
import { strengthLabel } from '../../controls/capability/ui/strength-label';
import { GainScore } from '../ui/gain-score';
import { PlanAxisCurrent } from '../ui/plan-axis-chips';
import { planDimensionLabel } from '../ui/plan-dimension';
import {
  planAxisGain,
  planGainScore,
  targetCoverageOptions,
  targetStrengthOptions,
} from '../treatment-plan-utils';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;
type PlanCandidate = RouterOutputs['treatmentPlans']['getTreatmentPlanCandidates'][number];
export type CandidateRow = PlanCandidate & { id: string };
export type MoveRow = CandidateRow & { axis: PlanMoveAxis };

/** No item in this application declares an empty value, so the "leave it alone" option needs a name. */
const UNCHANGED = 'unchanged';

export type CandidateTarget = HeldPlanMove;

interface TargetSelectProps {
  row: MoveRow,
  onChange: (capabilityId: string, next: CandidateTarget) => void,
}

interface AxisMenu {
  value: string | null,
  label: string,
  options: Array<{ value: string, text: string, chip: ReactElement }>,
  aimed: (value: string | null) => CandidateTarget,
}

const axisMenu = (row: MoveRow): AxisMenu => {
  const controlName = row.name;
  const targets: CandidateTarget = {
    targetStrengthRung: row.targetStrengthRung,
    targetCoverageBucket: row.targetCoverageBucket,
  };
  switch (row.axis) {
    case 'strength': {
      const options = targetStrengthOptions(row.currentStrengthRung);
      return {
        value: row.targetStrengthRung,
        label: t`Target strength for ${controlName}`,
        options: options.map((rung) => ({ value: rung, text: strengthLabel(rung), chip: <StrengthBadge value={rung} /> })),
        aimed: (value) => ({ ...targets, targetStrengthRung: options.find((rung) => rung === value) ?? null }),
      };
    }
    case 'coverage': {
      const options = targetCoverageOptions(row.currentCoverageBucket);
      return {
        value: row.targetCoverageBucket,
        label: t`Target coverage for ${controlName}`,
        options: options.map((bucket) => ({ value: bucket, text: coverageLabel(bucket), chip: <CoverageBadge value={bucket} /> })),
        aimed: (value) => ({ ...targets, targetCoverageBucket: options.find((bucket) => bucket === value) ?? null }),
      };
    }
  }
};

/** The chips are the vocabulary the rest of the screen states a posture in, so the options wear them. */
const TargetSelect: FunctionComponent<TargetSelectProps> = ({ row, onChange }) => {
  const menu = axisMenu(row);
  return (
    <Select value={menu.value ?? UNCHANGED} onValueChange={(value) => onChange(row.capabilityId, menu.aimed(value))}>
      <SelectTrigger aria-label={menu.label}>
        <SelectValue className={menu.value === null ? 'text-default-secondary' : undefined} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNCHANGED}>{t`Unchanged`}</SelectItem>
        {menu.options.map((option) => (
          // A chip carries no text of its own for the listbox to announce or to type ahead on.
          <SelectItem key={option.value} value={option.value} textValue={option.text}>
            {option.chip}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

export const GAIN_FIRST = [{ id: 'gain', desc: true }];

interface PlanMoveColumnsOptions {
  /** The best gain of the whole scope, which every rating is read against. */
  bestGain: number | null,
  onChange: (capabilityId: string, next: CandidateTarget) => void,
  /** The glyphs set beside a row's target menu. */
  targetHints: (row: MoveRow) => ReactNode,
}

/** The one controls table of a plan: a row per control and per dimension, aimed on the row itself. */
export const planMoveColumns = ({ bestGain, onChange, targetHints }: PlanMoveColumnsOptions): Array<ColumnDefWithOptionsHeader<MoveRow, unknown>> => [
  {
    id: 'name',
    accessorKey: 'name',
    header: t`Control`,
    size: 240,
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
    size: 130,
    cell: ({ row }): ReactElement => <span>{planDimensionLabel(row.original.axis)}</span>,
  },
  {
    id: 'gain',
    header: t`Gain`,
    size: 130,
    // Undefined rather than 0: a lever no run has priced parks at the bottom instead of
    // ranking as the one that buys the least.
    accessorFn: (row) => planAxisGain(row, row.axis) ?? undefined,
    sortUndefined: 'last',
    sortDescFirst: true,
    cell: ({ row }): ReactElement => (
      <GainScore score={planGainScore(planAxisGain(row.original, row.original.axis), bestGain)} />
    ),
  },
  {
    id: 'current',
    header: t`Current`,
    size: 150,
    enableSorting: false,
    cell: ({ row }): ReactElement => <PlanAxisCurrent row={row.original} axis={row.original.axis} />,
  },
  {
    id: 'target',
    header: t`Target`,
    size: 190,
    // The target column never sorts: its value is what the reader is editing, so a row would
    // leave under the pointer that just aimed it.
    enableSorting: false,
    cell: ({ row }): ReactElement => (
      <span className="flex items-center gap-2">
        <TargetSelect row={row.original} onChange={onChange} />
        {targetHints(row.original)}
      </span>
    ),
  },
];
