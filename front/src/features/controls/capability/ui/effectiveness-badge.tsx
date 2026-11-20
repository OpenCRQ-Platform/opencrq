import { Chip } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import type { EffectivenessBand } from '../utils/capability-effectiveness';
import { formatEffectivenessPercent } from '../utils/capability-effectiveness';

type ChipSeverity = 'neutral' | 'critical' | 'high' | 'low' | 'info';

const EFFECTIVENESS_SEVERITY: Record<EffectivenessBand, ChipSeverity> = {
  'not-deployed': 'neutral',
  none: 'neutral',
  marginal: 'critical',
  moderate: 'high',
  solid: 'low',
  strong: 'info',
};

// The chip's own foreground and wash per severity, so a figure or a grid cell painted by band
// reads as the same colour as the chip beside it.
const SEVERITY_TEXT_CLASS: Record<ChipSeverity, string> = {
  neutral: 'text-feedback-neutral-primary',
  critical: 'text-icon-error',
  high: 'text-icon-warning',
  low: 'text-icon-success',
  info: 'text-icon-info',
};

const SEVERITY_WASH_CLASS: Record<ChipSeverity, string> = {
  neutral: 'bg-feedback-neutral-secondary-transparency-30',
  critical: 'bg-feedback-error-secondary-transparency-30',
  high: 'bg-feedback-warning-secondary-transparency-30',
  low: 'bg-feedback-success-secondary-transparency-30',
  info: 'bg-feedback-info-secondary-transparency-30',
};

export const effectivenessTextClass = (band: EffectivenessBand): string => SEVERITY_TEXT_CLASS[EFFECTIVENESS_SEVERITY[band]];

export const effectivenessWashClass = (band: EffectivenessBand): string => SEVERITY_WASH_CLASS[EFFECTIVENESS_SEVERITY[band]];

/** A band that scores zero reads as its declaration, never as "0%". */
export const isScoredBand = (band: EffectivenessBand): boolean => band !== 'not-deployed' && band !== 'none';

export const effectivenessLabel = (band: EffectivenessBand): string => {
  switch (band) {
    case 'not-deployed': return t`Not deployed`;
    case 'none': return t`Inactive`;
    case 'marginal': return t`Marginal`;
    case 'moderate': return t`Moderate`;
    case 'solid': return t`Solid`;
    case 'strong': return t`Strong`;
    default: return band;
  }
};

export const effectivenessText = (band: EffectivenessBand, score: number): string => (isScoredBand(band)
  ? `${effectivenessLabel(band)} · ${formatEffectivenessPercent(score)}`
  : effectivenessLabel(band));

interface EffectivenessBadgeProps {
  band: EffectivenessBand,
  score: number,
}

export const EffectivenessBadge: FunctionComponent<EffectivenessBadgeProps> = ({ band, score }) => (
  <Chip severity={EFFECTIVENESS_SEVERITY[band]} label={effectivenessText(band, score)} />
);

export const EffectivenessBandChip: FunctionComponent<{ band: EffectivenessBand }> = ({ band }) => (
  <Chip severity={EFFECTIVENESS_SEVERITY[band]} label={effectivenessLabel(band)} />
);
