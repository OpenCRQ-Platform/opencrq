import { Chip } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import type { CapabilityFunction } from '@app/module/client';
import type { FunctionComponent } from 'react';
import type { PostureTone } from '../utils/validation-summary-utils';
import { formatBoundedRate, resolvePostureTone } from '../utils/validation-summary-utils';

const TONE_SEVERITY: Record<PostureTone, 'low' | 'high' | 'critical'> = {
  positive: 'low',
  warning: 'high',
  destructive: 'critical',
};

/**
 * The verdict word of one function, in the vocabulary the simulation product uses. Prevention and
 * detection do not share a word, and the stored `validated` / `contradicted` pair is a storage
 * concern that never reaches a label.
 */
export const verdictLabel = (capabilityFunction: CapabilityFunction, held: boolean): string => {
  if (capabilityFunction === 'prevent') {
    return held ? t`Prevented` : t`Not prevented`;
  }
  return held ? t`Detected` : t`Not detected`;
};

// One translatable unit per sentence: composing the verdict word into a template would hand the
// translator a fragment they cannot reorder or inflect.
const ratedVerdictLabel = (capabilityFunction: CapabilityFunction, held: boolean, rate: string): string => {
  if (capabilityFunction === 'prevent') {
    return held ? t`Prevented, ${rate} success rate` : t`Not prevented, ${rate} success rate`;
  }
  return held ? t`Detected, ${rate} success rate` : t`Not detected, ${rate} success rate`;
};

interface ValidationStateBadgeProps {
  capabilityFunction: CapabilityFunction,
  /** Share of the scenarios that held; null when nothing has tested the expectation. */
  successRate: number | null,
  /** Off when the surface prints the rate beside the badge, so the figure is never stated twice. */
  withRate?: boolean,
}

/**
 * What the simulations proved about one expectation.
 *
 * The verdict follows the tone, not the first miss: an expectation missed under the threshold keeps
 * its positive word and lets the rate account for the amber.
 */
export const ValidationStateBadge: FunctionComponent<ValidationStateBadgeProps> = ({
  capabilityFunction,
  successRate,
  withRate,
}) => {
  if (successRate === null) {
    return <Chip label={t`Never tested`} />;
  }

  const tone = resolvePostureTone(1 - successRate);
  const held = tone !== 'destructive';
  // The rate rides the label only where the verdict word alone would misstate it. At nothing missed
  // and at nothing held the word is already the whole truth.
  const isUnanimous = successRate >= 1 || successRate <= 0;

  return (
    <Chip
      severity={TONE_SEVERITY[tone]}
      label={isUnanimous || withRate === false
        ? verdictLabel(capabilityFunction, held)
        : ratedVerdictLabel(capabilityFunction, held, formatBoundedRate(successRate))}
    />
  );
};
