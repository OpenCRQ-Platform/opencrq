import type { FunctionComponent } from 'react';
import { TooltipHint, TooltipHintProvider } from '../../../components/shared';
import { cn, formatCompactCount } from '../../../utils';
import { formatNumber } from '../../../utils/format-number';

/** From this value on a count is drawn compact ("1.4K") and its exact value is given on hover and focus. */
export const COMPACT_FROM = 1_000;

/**
 * A count of a run, compact from {@link COMPACT_FROM} as every count of the application is, with the exact
 * figure in the design system's tooltip. Below it the count is exact already and gets no tooltip.
 */
export const RunCount: FunctionComponent<{ value: number, className?: string }> = ({ value, className }) => {
  const classes = cn('tabular-nums', className);
  if (Math.abs(value) < COMPACT_FROM) {
    return <span className={classes}>{formatNumber(value)}</span>;
  }
  return (
    <TooltipHintProvider>
      <TooltipHint hint={formatNumber(value)}>
        <span tabIndex={0} className={cn(classes, 'cursor-default')}>{formatCompactCount(value)}</span>
      </TooltipHint>
    </TooltipHintProvider>
  );
};
