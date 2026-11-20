import type { StrengthRung } from '@app/module/client';
import type { FunctionComponent } from 'react';
import { StrengthBadge } from './strength-badge';

interface StrengthChangeBadgesProps {
  oldValue: StrengthRung | null,
  newValue: StrengthRung | null,
}

export const StrengthChangeBadges: FunctionComponent<StrengthChangeBadgesProps> = ({ oldValue, newValue }) => (
  <div className="flex items-center gap-x-2">
    <StrengthBadge value={oldValue ?? 'L0'} />
    <span className="text-muted-foreground txt-sub-content">→</span>
    <StrengthBadge value={newValue ?? 'L0'} />
  </div>
);
