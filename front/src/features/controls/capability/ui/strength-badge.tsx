import { Chip } from '@filigran/design-system';
import type { StrengthRung } from '@app/module/client';
import type { FunctionComponent } from 'react';
import { strengthLabel } from './strength-label';

const STRENGTH_SEVERITY: Record<StrengthRung, 'neutral' | 'critical' | 'high' | 'low'> = {
  L0: 'neutral',
  L1: 'critical',
  L2: 'high',
  L3: 'low',
};

interface StrengthBadgeProps {
  value: StrengthRung,
}

export const StrengthBadge: FunctionComponent<StrengthBadgeProps> = ({ value }) => (
  <Chip severity={STRENGTH_SEVERITY[value]} label={strengthLabel(value)} />
);
