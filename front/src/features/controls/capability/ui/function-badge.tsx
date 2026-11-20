import { Chip } from '@filigran/design-system';
import type { CapabilityFunction } from '@app/module/client';
import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';

// Susceptibility function an edge acts on. `prevent` is scored by the engine; `detect` is
// catalogue data shown in the UI but not yet scored. Functions are categorical (not ordinal),
// so they render as plain neutral chips.
export const functionLabel = (value: CapabilityFunction): string => {
  switch (value) {
    case 'prevent': return t`Prevent`;
    case 'detect': return t`Detect`;
    default: return value;
  }
};

interface FunctionBadgeProps {
  value: CapabilityFunction,
}

export const FunctionBadge: FunctionComponent<FunctionBadgeProps> = ({ value }) => (
  <Chip label={functionLabel(value)} />
);
