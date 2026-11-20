import { Trans } from '@lingui/react/macro';
import { OUTCOME_WEIGHT_THRESHOLD } from '@app/module/client';
import type { FunctionComponent, ReactElement } from 'react';
import { formatFractionAsPercent } from '../../../utils/format-number';

/**
 * Which threats weigh on a scenario, stated once for the two surfaces that explain it: the Relevant
 * Threats "nothing matched" empty state and the TTPs tab's paragraph on how the share is read.
 *
 * Exported as a component (not a module-level string) so Lingui resolves it at render time and a
 * locale change re-renders it.
 */
export const WeighingRuleSentence: FunctionComponent = (): ReactElement => {
  const thresholdLabel = formatFractionAsPercent(OUTCOME_WEIGHT_THRESHOLD, 0);
  return (
    <Trans>
      A threat weighs on a scenario once OpenCRQ's internal model gives it a probability above
      {' '}{thresholdLabel} of leading to the outcome. Targeting the risk scope's country or sector
      raises its weight.
    </Trans>
  );
};
