import type { IconName } from '@filigran/design-system';
import { Icon, Text } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import type { TrendDirection } from '../../findings-home/findings-panel-utils';
import { cn } from '../../../utils';
import { formatReturnPercent, returnPercentSign } from '../../treatment-plans/treatment-plan-utils';
import { MARK_TONE_CLASSES, PILL_GROUND_CLASSES } from '../../findings-home/ui/trend-pill';

/** Indexed by the sign of the change, shifted by one. */
const TREND_OF_SIGN: ReadonlyArray<{ direction: TrendDirection, arrow: IconName }> = [
  { direction: 'worse', arrow: 'arrow-down' },
  { direction: 'flat', arrow: 'arrow-right' },
  { direction: 'better', arrow: 'arrow-up' },
];

interface ReviewTrendChipProps {
  /** Change of the loss avoided against the previous review. */
  percent: number,
  previousName: string,
}

/** A loss avoided that grew is good news, so the arrow points up in the success tint: the opposite of a finding count's. */
export const ReviewTrendChip: FunctionComponent<ReviewTrendChipProps> = ({ percent, previousName }) => {
  const sign = returnPercentSign(percent);
  const { direction, arrow } = TREND_OF_SIGN[Math.sign(sign) + 1];
  const change = formatReturnPercent(percent);
  const label = t`${change} on ${previousName}`;
  return (
    <Text
      as="span"
      variant="content-compact"
      title={label}
      className={cn('inline-flex min-w-0 items-center self-center rounded-full px-[9px] py-[3px]', PILL_GROUND_CLASSES[direction])}
    >
      <span className={cn('inline-flex min-w-0 items-center gap-1 font-semibold tabular-nums', MARK_TONE_CLASSES[direction])}>
        <Icon name={arrow} size={16} aria-hidden />
        <span className="truncate">{label}</span>
      </span>
    </Text>
  );
};
