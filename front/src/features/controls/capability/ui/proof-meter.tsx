import type { FunctionComponent } from 'react';
import type { PostureTone } from '../utils/validation-summary-utils';
import { cn } from '../../../../utils';

/**
 * `coverage` is not a verdict and never takes a verdict hue: how much was measured says nothing
 * about how well the control held.
 */
export type MeterTone = PostureTone | 'coverage';

const TONE_FILL: Record<MeterTone, string> = {
  positive: 'bg-secondary',
  warning: 'bg-orange',
  destructive: 'bg-destructive',
  coverage: 'bg-primary',
};

interface ProofMeterProps {
  /** Clamped to 0..1; a rate outside that range is a bug upstream, not something to render. */
  ratio: number,
  tone: MeterTone,
}

/** Decorative: every meter on these surfaces sits beside the percentage it draws. */
export const ProofMeter: FunctionComponent<ProofMeterProps> = ({ ratio, tone }) => (
  <div aria-hidden="true" className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
    <div
      className={cn('h-full rounded-full', TONE_FILL[tone])}
      style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }}
    />
  </div>
);
