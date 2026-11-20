import { Chip } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import type { ControlType } from '../utils/control-type';

// The type is derived from the edge functions, never declared, so it reads as a categorical
// neutral chip: colour meaning stays reserved for the ordinal strength / coverage ladders.
export const controlTypeLabel = (type: ControlType): string => {
  switch (type) {
    case 'preventive': return t`Preventive`;
    case 'detective': return t`Detective`;
    case 'preventive-and-detective': return t`Preventive and detective`;
    default: return '';
  }
};

interface ControlTypeBadgeProps {
  value: ControlType,
}

export const ControlTypeBadge: FunctionComponent<ControlTypeBadgeProps> = ({ value }) => (
  <Chip label={controlTypeLabel(value)} />
);
