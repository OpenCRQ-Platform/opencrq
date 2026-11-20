import { Button, Paper } from '@filigran/design-system';
import { Skeleton } from '@filigran/ui';
import type { ChangeTab } from '@app/module/client';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Link, linkOptions } from '@tanstack/react-router';
import { ArrowRight } from 'lucide-react';
import type { FunctionComponent, ReactNode } from 'react';
import type { PeriodWindowId } from '../../../../components/shared';
import type { AleDecomposition, FactorReading, RunTimeline, TimeAxis } from './ale-decomposition-utils';
import { directionBetween, Lifeline, LIFELINE_TONE_CLASS, PeriodSelect } from '../../../../components/shared';
import { useDelayedFlag } from '../../../../hooks';
import { cn, formatDate, formatDollar, formatDollarChange, formatSignedNumber } from '../../../../utils';
import { EMPTY_VALUE } from '../../../../utils/empty-value';
import {
  buildAleDecomposition,
  DEFENCES_DIGITS,
  formatDefences,
  formatThreat,
  pointsLabel,
  printedChange,
  THREAT_DIGITS,
} from './ale-decomposition-utils';
import { NoDataOverlay } from './no-data-overlay';

interface AleDecompositionCardProps {
  /** Undefined while loading. */
  timeline: RunTimeline | undefined,
  unavailable: boolean,
  /** The curves on screen belong to the previously selected period, the new ones are on their way. */
  pending: boolean,
  windowId: PeriodWindowId,
  onWindowChange: (windowId: PeriodWindowId) => void,
}

const changesLink = (tab: ChangeTab) => linkOptions({
  from: '/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId',
  to: 'changes',
  search: { tab },
});

const ChangesEntry: FunctionComponent<{ tab: ChangeTab, enabled: boolean, className?: string, children: ReactNode }> = ({ tab, enabled, className, children }) => (
  enabled
    ? <Link {...changesLink(tab)} className={cn('rounded-sm focus-visible:outline-none focus-visible:ring-2 ring-focus', className)}>{children}</Link>
    : children
);

interface CurveEnd {
  value: string,
  date: string,
}

type CurveLabel = (oldest: CurveEnd, latest: CurveEnd) => string;

const lossCurveLabel: CurveLabel = ({ value: oldestValue, date: oldestDate }, { value: latestValue, date: latestDate }) =>
  t`Annual loss exposure over time, from ${oldestValue} on ${oldestDate} to ${latestValue} on ${latestDate}`;
const threatCurveLabel: CurveLabel = ({ value: oldestValue, date: oldestDate }, { value: latestValue, date: latestDate }) =>
  t`Threat event frequency over time, from ${oldestValue} on ${oldestDate} to ${latestValue} on ${latestDate}`;
const defencesCurveLabel: CurveLabel = ({ value: oldestValue, date: oldestDate }, { value: latestValue, date: latestDate }) =>
  t`Effective susceptibility over time, from ${oldestValue} on ${oldestDate} to ${latestValue} on ${latestDate}`;
const businessCurveLabel: CurveLabel = ({ value: oldestValue, date: oldestDate }, { value: latestValue, date: latestDate }) =>
  t`Loss magnitude over time, from ${oldestValue} on ${oldestDate} to ${latestValue} on ${latestDate}`;

/**
 * A rise costs more for every factor, exactly as it does for the loss: the tone follows the same
 * direction call. It reads the change as printed, so a change that rounds to zero stays toneless.
 */
const changeTone = (value: number | null, change: number | null): string => {
  if (value === null || change === null) {
    return LIFELINE_TONE_CLASS.bad.flat;
  }
  return LIFELINE_TONE_CLASS.bad[directionBetween(value - change, value)];
};

const PENDING_DELAY_MS = 250;
const PENDING_MIN_DURATION_MS = 200;
const PENDING_CLASS = 'opacity-40';

const AxisEnds: FunctionComponent<{ axis: TimeAxis, className?: string }> = ({ axis, className }) => (
  <div className={cn('flex justify-between txt-mini text-muted-foreground', className)}>
    <span>{formatDate(axis.start)}</span>
    <span>{formatDate(axis.end)}</span>
  </div>
);

interface CurveProps {
  series: FactorReading['series'],
  axis: TimeAxis,
  ariaLabel: CurveLabel,
  formatValue: (value: number) => string,
  pending: boolean,
  className?: string,
}

const Curve: FunctionComponent<CurveProps> = ({ series, axis, ariaLabel, formatValue, pending, className }) => {
  const oldest = series[0];
  const latest = series[series.length - 1];
  if (oldest === undefined || latest === undefined) {
    return null;
  }
  const label = ariaLabel(
    { value: formatValue(oldest.value), date: formatDate(oldest.at) },
    { value: formatValue(latest.value), date: formatDate(latest.at) },
  );
  return (
    <>
      <Lifeline
        values={series.map((point) => point.value)}
        xs={series.map((point) => point.x)}
        rise="bad"
        ariaLabel={label}
        className={cn('transition-opacity', pending && PENDING_CLASS, className)}
      />
      <AxisEnds axis={axis} className={cn('transition-opacity', pending && PENDING_CLASS)} />
    </>
  );
};

interface FactorPaperProps {
  tab: ChangeTab,
  explainChanges: boolean,
  title: ReactNode,
  displayValue: ReactNode,
  reading: FactorReading,
  axis: TimeAxis | null,
  shownChange: number | null,
  changeLabel: string | null,
  ariaLabel: CurveLabel,
  formatValue: (value: number) => string,
  pending: boolean,
}

const FactorPaper: FunctionComponent<FactorPaperProps> = ({ tab, explainChanges, title, displayValue, reading, axis, shownChange, changeLabel, ariaLabel, formatValue, pending }) => (
  <ChangesEntry tab={tab} enabled={explainChanges} className="flex [&>*]:flex-1 [&>*]:hover:border-primary/60">
    <Paper elevation={2} className="flex flex-col gap-2">
      <span className="txt-category">{title}</span>
      <div className="flex items-baseline gap-2">
        <span className="txt-subtitle2 font-bold">{reading.value === null ? EMPTY_VALUE : displayValue}</span>
        {changeLabel !== null && (
          <span className={cn('txt-body2 font-medium', changeTone(reading.value, shownChange))}>{changeLabel}</span>
        )}
      </div>
      {axis !== null && <Curve series={reading.series} axis={axis} ariaLabel={ariaLabel} formatValue={formatValue} pending={pending} />}
    </Paper>
  </ChangesEntry>
);

const LoadingCard: FunctionComponent = () => (
  <Paper className="flex flex-col gap-4">
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-4 w-64" />
      </div>
      <Skeleton className="h-9 w-32" />
    </div>
    <Skeleton className="h-24 w-full" />
    <div className="grid grid-cols-[1fr_32px_1fr_32px_1fr] gap-2">
      <Skeleton className="h-32" />
      <div />
      <Skeleton className="h-32" />
      <div />
      <Skeleton className="h-32" />
    </div>
  </Paper>
);

export const AleDecompositionCard: FunctionComponent<AleDecompositionCardProps> = ({ timeline, unavailable, pending, windowId, onWindowChange }) => {
  const showPending = useDelayedFlag(pending, { delay: PENDING_DELAY_MS, minDuration: PENDING_MIN_DURATION_MS });
  if (timeline === undefined) {
    return <LoadingCard />;
  }

  const opensChanges = timeline.latest.length >= 2;
  const decomposition: AleDecomposition = buildAleDecomposition(timeline);
  const { loss, threat, defences, business, axis } = decomposition;
  const threatChange = threat.value === null || threat.change === null
    ? null
    : printedChange(threat.value, threat.change, THREAT_DIGITS);
  const defencesChange = defences.value === null || defences.change === null
    ? null
    : printedChange(defences.value, defences.change, DEFENCES_DIGITS);
  const lossP10Label = loss.p10 === null ? EMPTY_VALUE : formatDollar(loss.p10);
  const lossP90Label = loss.p90 === null ? EMPTY_VALUE : formatDollar(loss.p90);
  const previousLossValueLabel = loss.previous === null ? null : formatDollar(loss.previous.value);
  const previousLossDateLabel = loss.previous === null ? null : formatDate(loss.previous.at);

  return (
    <div className="relative">
      {unavailable && <NoDataOverlay />}
      <Paper className="flex flex-col gap-4" inert={unavailable}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="txt-category">{t`Annual Loss Exposure`}</span>
            <div className="flex items-baseline gap-3">
              <ChangesEntry tab="ale" enabled={opensChanges} className="hover:underline">
                <span className="txt-title font-bold">{loss.value === null ? EMPTY_VALUE : formatDollar(loss.value)}</span>
              </ChangesEntry>
              {loss.change !== null && loss.previous !== null && loss.value !== null && (
                <span className={cn('txt-body2 font-medium', LIFELINE_TONE_CLASS.bad[directionBetween(loss.previous.value, loss.value)])}>
                  {formatDollarChange(loss.change)}
                </span>
              )}
            </div>
            {loss.p10 !== null && loss.p90 !== null && (
              <p className="txt-sub-content text-muted-foreground">
                {previousLossValueLabel !== null && previousLossDateLabel !== null
                  ? <Trans>per year on average · {lossP10Label} to {lossP90Label} · {previousLossValueLabel} on {previousLossDateLabel}</Trans>
                  : <Trans>per year on average · {lossP10Label} to {lossP90Label}</Trans>}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {opensChanges && (
              <Button priority="secondary" size="sm" asChild endIcon={<ArrowRight className="size-3.5" />}>
                <Link {...changesLink('ale')}>{t`What changed`}</Link>
              </Button>
            )}
            <span role="status" className="sr-only">{showPending ? t`Loading` : ''}</span>
            <PeriodSelect value={windowId} onChange={onWindowChange} />
          </div>
        </div>

        {axis !== null && (
          <Curve series={loss.series} axis={axis} ariaLabel={lossCurveLabel} formatValue={formatDollar} pending={showPending} className="h-24" />
        )}

        <div className="grid grid-cols-[1fr_32px_1fr_32px_1fr] items-stretch">
          <FactorPaper
            tab="tef"
            explainChanges={opensChanges}
            title={<Trans>Threat event frequency (TEF)</Trans>}
            displayValue={threat.value === null ? EMPTY_VALUE : formatThreat(threat.value)}
            reading={threat}
            axis={axis}
            shownChange={threatChange}
            changeLabel={threatChange === null ? null : formatSignedNumber(threatChange, THREAT_DIGITS)}
            ariaLabel={threatCurveLabel}
            formatValue={formatThreat}
            pending={showPending}
          />
          <div className="flex items-center justify-center txt-title text-muted-foreground">×</div>
          <FactorPaper
            tab="susceptibility"
            explainChanges={opensChanges}
            title={<Trans>Effective susceptibility</Trans>}
            displayValue={defences.value === null ? EMPTY_VALUE : formatDefences(defences.value)}
            reading={defences}
            axis={axis}
            shownChange={defencesChange}
            changeLabel={defencesChange === null ? null : pointsLabel(formatSignedNumber(defencesChange, DEFENCES_DIGITS))}
            ariaLabel={defencesCurveLabel}
            formatValue={formatDefences}
            pending={showPending}
          />
          <div className="flex items-center justify-center txt-title text-muted-foreground">×</div>
          <FactorPaper
            tab="magnitude"
            explainChanges={opensChanges}
            title={<Trans>Loss magnitude (LM)</Trans>}
            displayValue={business.value === null ? EMPTY_VALUE : formatDollar(business.value)}
            reading={business}
            axis={axis}
            shownChange={business.change}
            changeLabel={business.change === null ? null : formatDollarChange(business.change)}
            ariaLabel={businessCurveLabel}
            formatValue={formatDollar}
            pending={showPending}
          />
        </div>
      </Paper>
    </div>
  );
};
