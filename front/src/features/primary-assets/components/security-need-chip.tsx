import type { SecurityNeedLevel } from '@app/module/client';
import type { ChipSeverity } from '@filigran/design-system';
import { Chip } from '@filigran/design-system';
import type { FunctionComponent } from 'react';
import { securityNeedLabel } from '../primary-asset-fields-labels';

/** The tones of a supporting asset's criticality, so a level reads the same on both kinds of asset. */
const SECURITY_NEED_SEVERITY: Record<SecurityNeedLevel, ChipSeverity> = {
  very_high: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
};

export const SecurityNeedChip: FunctionComponent<{ level: SecurityNeedLevel }> = ({ level }) => (
  <Chip severity={SECURITY_NEED_SEVERITY[level]} label={securityNeedLabel(level)} />
);
