import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import { EmptyValue } from '../../../components/ui/empty-value';
import { cn } from '../../../utils';
import { GAIN_SCORE_MAX } from '../treatment-plan-utils';

const SLOTS = Array.from({ length: GAIN_SCORE_MAX }, (_, index) => index + 1);

/**
 * A candidate's gain as a rating instead of an amount.
 *
 * The amounts behind it are what one control is worth moved alone, and two controls covering the
 * same technique return less together than apart, so a column of them invites a total that
 * overstates. A rating answers the only question the column is there for, which move to look at
 * first, without offering a figure to add up.
 */
export const GainScore: FunctionComponent<{ score: number | null }> = ({ score }) => {
  if (score === null) {
    return <EmptyValue />;
  }
  const filled = Math.ceil(score);

  return (
    <span role="img" aria-label={t`Gain rated ${filled} out of ${GAIN_SCORE_MAX}`} className="whitespace-nowrap font-medium">
      {SLOTS.map((slot) => (
        <span
          key={slot}
          aria-hidden="true"
          className={cn(slot <= filled ? 'text-green-600' : 'text-default-secondary opacity-30')}
        >
          $
        </span>
      ))}
    </span>
  );
};
