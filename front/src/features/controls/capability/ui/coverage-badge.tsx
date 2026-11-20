import { Chip } from '@filigran/design-system';
import type { CoverageBucket } from '@app/module/client';
import type { FunctionComponent } from 'react';
import { coverageLabel } from './coverage-label';

type ChipSeverity = 'neutral' | 'critical' | 'high' | 'low';

// Coverage shares the low->high colour ladder used by strength and effectiveness, so the
// same colour reads as the same level across all three chips. Blue ('info') stays reserved
// for the peak 'Strong' effectiveness band, which only a Master + Full control reaches.
const COVERAGE_SEVERITY: Record<CoverageBucket, ChipSeverity> = {
  L0: 'neutral',
  L1: 'critical',
  L2: 'high',
  L3: 'low',
};

interface CoverageBadgeProps {
  value: CoverageBucket,
}

export const CoverageBadge: FunctionComponent<CoverageBadgeProps> = ({ value }) => (
  <Chip severity={COVERAGE_SEVERITY[value]} label={coverageLabel(value)} />
);
