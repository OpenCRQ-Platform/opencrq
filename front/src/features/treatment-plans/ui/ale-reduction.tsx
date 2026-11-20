import { t } from '@lingui/core/macro';
import { ArrowDown, ArrowUp } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { TooltipHint, TooltipHintProvider } from '../../../components/shared';
import { EmptyValue } from '../../../components/ui/empty-value';
import { cn } from '../../../utils';
import { formatDollar } from '../../../utils/format-currency';
import { formatAleReduction } from '../treatment-plan-utils';

interface AleReductionProps {
  /** Annualised loss the plan removes. The engine can legitimately return a negative one. */
  value: number | null,
  /** Priced against a set of moves the plan has since changed: the figure stays, greyed. */
  expired?: boolean,
  className?: string,
  /** The arrow's side in pixels, for a figure set larger than body text; 16 when left out. */
  iconSize?: number,
}

const DEFAULT_ICON_SIZE = 16;

/**
 * The arrow carries the direction and the colour the verdict, so the amount beside them is
 * absolute: a figure marked with an arrow and with a sign reads as two statements of one fact.
 */
export const AleReduction: FunctionComponent<AleReductionProps> = ({ value, expired, className, iconSize }) => {
  if (value === null) {
    return <EmptyValue />;
  }
  if (value === 0) {
    return <span className={cn('whitespace-nowrap', className)}>{formatDollar(0)}</span>;
  }
  const falls = value > 0;
  const tone = expired === true
    ? 'text-default-secondary'
    : falls ? 'text-green-600' : 'text-red';
  const Arrow = falls ? ArrowDown : ArrowUp;
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap', tone, className)}>
      <Arrow aria-hidden="true" size={iconSize ?? DEFAULT_ICON_SIZE} className="shrink-0" />
      {formatDollar(Math.abs(value))}
    </span>
  );
};

interface AleReductionWithSpreadProps extends AleReductionProps {
  p10: number | null,
  p90: number | null,
}

/**
 * The saving, and on hover the spread it was sampled over. The spread is read against the amount it
 * belongs to rather than beside it, a row of the table having one figure to carry.
 */
export const AleReductionWithSpread: FunctionComponent<AleReductionWithSpreadProps> = ({ value, p10, p90, expired, className }) => {
  const figure = <AleReduction value={value} expired={expired} className={className} />;
  if (value === null) {
    return figure;
  }
  const hasBand = p10 !== null && p90 !== null;
  // `p10 <= p90` always, so a band reaching below zero is a plan that might raise the exposure. The
  // absolute form would print that end as a saving and put the worst outcome above the best, so the
  // whole band takes the signed form as soon as one end of it is a rise.
  const raises = hasBand && p10 < 0;
  const mean = raises || value < 0 ? formatAleReduction(value) : formatDollar(value);
  const low = hasBand ? (raises ? formatAleReduction(p10) : formatDollar(p10)) : null;
  const high = hasBand ? (raises ? formatAleReduction(p90) : formatDollar(p90)) : null;
  const summary = low !== null && high !== null
    ? t`p10 ${low}, mean ${mean}, p90 ${high}`
    : t`Mean ${mean}, band not computed`;
  return (
    <TooltipHintProvider>
      <TooltipHint hint={(
        <span className="flex flex-col">
          {low !== null && <span>{t`p10 ${low}`}</span>}
          <span>{t`Mean ${mean}`}</span>
          {high !== null ? <span>{t`p90 ${high}`}</span> : <span>{t`Band not computed`}</span>}
        </span>
      )}
      >
        <span tabIndex={0} className="inline-flex items-center cursor-default focus-visible:outline-none focus-visible:ring-2 ring-focus">
          {figure}
          <span className="sr-only">{summary}</span>
        </span>
      </TooltipHint>
    </TooltipHintProvider>
  );
};
