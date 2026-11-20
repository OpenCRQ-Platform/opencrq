import { Chip } from '@filigran/design-system';
import { plural, t } from '@lingui/core/macro';
import type { ScenarioAleChange } from '@app/module/client';
import { ArrowDown, ArrowUp } from 'lucide-react';
import type { FunctionComponent } from 'react';
import type { LifelineDirection } from '../../../../components/shared';
import { directionOfRelativeChange, LIFELINE_TONE_CLASS } from '../../../../components/shared';
import { EmptyValue } from '../../../../components/ui/empty-value';
import { cn, formatDollar, formatFractionAsPercent } from '../../../../utils';

export type { ScenarioAleChange };

/**
 * Structural rather than the module's own type: the dashboard reads a different trend, over its own
 * declared window, and states that window in its column header instead of in the cell.
 */
interface ScenarioAleChangeValue {
  delta: number,
  deltaPct: number | null,
  /** Omitted where the surface already names the period the figure covers. */
  spanDays?: number,
}

interface ScenarioAleChangeCellProps {
  hasRun: boolean,
  change: ScenarioAleChangeValue | null,
  className?: string,
}

const formatDeltaPct = (deltaPct: number): string => formatFractionAsPercent(Math.abs(deltaPct), 0);

/**
 * A ratio of null means the oldest point priced the scenario at zero, where no relative move exists
 * and any movement at all is a real one rather than one to damp.
 */
const changeDirection = ({ delta, deltaPct }: ScenarioAleChangeValue): LifelineDirection => (
  deltaPct === null ? (delta > 0 ? 'up' : 'down') : directionOfRelativeChange(deltaPct)
);

/**
 * How long the movement took, in the reader's own words. Printed rather than assumed: this figure
 * spans whatever history the series actually holds, which is a different period on every surface
 * that shows it and on every scenario.
 */
export const ScenarioChangeSpan: FunctionComponent<{ spanDays: number | undefined }> = ({ spanDays }) => {
  if (spanDays === undefined || spanDays < 1) {
    return null;
  }
  return (
    <span className="text-muted-foreground">
      {plural(spanDays, { one: 'in # day', other: 'in # days' })}
    </span>
  );
};

/**
 * The movement in exposure across a scenario's lifeline, oldest point to newest — the span the
 * sparkline beside it draws.
 *
 * The arrow carries the sign and the tone carries the verdict, and they can disagree: a move under
 * the flat threshold points somewhere and is tinted as nothing, which is the same reading the line
 * gives. Rising exposure is the bad direction, so the tone is keyed to the sign, not the magnitude.
 */
export const ScenarioAleChangeCell: FunctionComponent<ScenarioAleChangeCellProps> = ({ hasRun, change, className }) => {
  if (!hasRun) {
    return <EmptyValue />;
  }
  if (!change) {
    return <Chip label={t`New`} />;
  }
  if (change.delta === 0) {
    return (
      <span className={cn('flex items-center gap-1 whitespace-nowrap', LIFELINE_TONE_CLASS.bad.flat, className)}>
        {formatDollar(0)}
        <ScenarioChangeSpan spanDays={change.spanDays} />
      </span>
    );
  }
  const rising = change.delta > 0;
  return (
    <span
      className={cn(
        'flex items-center gap-1 whitespace-nowrap',
        LIFELINE_TONE_CLASS.bad[changeDirection(change)],
        className,
      )}
    >
      {rising ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
      {formatDollar(Math.abs(change.delta))}
      {change.deltaPct !== null && ` (${formatDeltaPct(change.deltaPct)})`}
      <ScenarioChangeSpan spanDays={change.spanDays} />
    </span>
  );
};
