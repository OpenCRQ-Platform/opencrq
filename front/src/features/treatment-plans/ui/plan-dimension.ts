import { t } from '@lingui/core/macro';
import type { PlanMoveAxis } from '../treatment-plan-utils';

export const planDimensionLabel = (axis: PlanMoveAxis): string => {
  switch (axis) {
    case 'strength': return t`Strength`;
    case 'coverage': return t`Coverage`;
  }
};
