import type { CoverageBucket } from '@app/module/client';
import type { FunctionComponent } from 'react';
import { CoverageBadge } from './coverage-badge';

interface CoverageChangeBadgesProps {
  oldValue: CoverageBucket | null,
  newValue: CoverageBucket | null,
}

export const CoverageChangeBadges: FunctionComponent<CoverageChangeBadgesProps> = ({ oldValue, newValue }) => (
  <div className="flex items-center gap-x-2">
    <CoverageBadge value={oldValue ?? 'L0'} />
    <span className="text-muted-foreground txt-sub-content">→</span>
    <CoverageBadge value={newValue ?? 'L0'} />
  </div>
);
