import { Chip } from '@filigran/design-system';
import type { EffectiveEdgeState } from '@app/module/client';
import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';

// A recommendation the tenant has not touched carries no flag: only a departure from the
// catalogue is worth naming, and a removed line stays visible so the departure is legible.
export const edgeStateLabel = (state: EffectiveEdgeState): string => {
  switch (state) {
    case 'added': return t`Linked`;
    case 'removed': return t`Unlinked`;
    case 'recommended': return '';
    default: return '';
  }
};

interface EdgeStateBadgeProps {
  value: EffectiveEdgeState,
}

export const EdgeStateBadge: FunctionComponent<EdgeStateBadgeProps> = ({ value }) => {
  if (value === 'recommended') {
    return null;
  }
  return (
    <Chip severity={value === 'removed' ? 'critical' : 'low'} label={edgeStateLabel(value)} />
  );
};
