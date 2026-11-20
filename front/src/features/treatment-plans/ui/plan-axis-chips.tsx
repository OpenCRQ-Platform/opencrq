import type { FunctionComponent } from 'react';
import type { PlanMoveAxis, PlanScopeRow } from '../treatment-plan-utils';
import { CoverageBadge } from '../../controls/capability/ui/coverage-badge';
import { StrengthBadge } from '../../controls/capability/ui/strength-badge';

export const PlanAxisCurrent: FunctionComponent<{ row: PlanScopeRow, axis: PlanMoveAxis }> = ({ row, axis }) => {
  switch (axis) {
    case 'strength': return <StrengthBadge value={row.currentStrengthRung} />;
    case 'coverage': return <CoverageBadge value={row.currentCoverageBucket} />;
  }
};
