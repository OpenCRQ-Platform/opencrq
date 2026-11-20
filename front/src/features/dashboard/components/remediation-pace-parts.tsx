import { i18n } from '@lingui/core';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Alert } from '@filigran/design-system';
import type { SeverityBand } from '@app/module/client';
import { Clock } from 'lucide-react';
import type { FunctionComponent } from 'react';
import type { OccupancyLevel, PaceFiguresLike } from '../remediation-pace-utils';
import { MetricInfo } from '../../../components/shared';
import { ChartSwatch } from '../../../components/ui/chart-segment';
import { cn, formatAtMost, formatDateWith, formatFractionAsPercent, formatList } from '../../../utils';
import { EMPTY_VALUE } from '../../../utils/empty-value';
import { severityBandFillColor, severityBandLabel } from '../../finding-score/ui/severity-ramp';
import { utcDayToTimestamp } from '../dashboard-utils';
import { bandsFallingBehind, occupancyBarRatio, occupancyLevel, paceVerdict, roundDays, roundRate } from '../remediation-pace-utils';

export const OCCUPANCY_FILL_CLASS: Record<OccupancyLevel, string> = {
  over: 'bg-feedback-error-primary',
  near: 'bg-feedback-alert-primary',
  within: 'bg-primary',
};

export const OCCUPANCY_TONE_CLASS: Record<OccupancyLevel, string> = {
  over: 'text-feedback-error-primary',
  near: 'text-feedback-alert-primary',
  within: 'text-primary',
};

export const formatRate = (value: number): string => formatAtMost(roundRate(value), 1);

export const formatDays = (days: number | null): string => {
  const rounded = roundDays(days);
  return rounded === null ? EMPTY_VALUE : plural(rounded, { one: '# day', other: '# days' });
};

/** Past ten times the capacity the exact figure says nothing more, and its width would crowd the row. */
const OCCUPANCY_DISPLAY_CEILING = 9.99;

export const formatOccupancy = ({ occupancy }: Pick<PaceFiguresLike, 'occupancy'>): string => {
  if (occupancy === null) {
    return EMPTY_VALUE;
  }
  if (occupancy > OCCUPANCY_DISPLAY_CEILING) {
    const ceiling = formatFractionAsPercent(OCCUPANCY_DISPLAY_CEILING, 0);
    return i18n._({ id: 'Over {ceiling}', message: '> {ceiling}', values: { ceiling } });
  }
  return formatFractionAsPercent(occupancy, 0);
};

export const BandName: FunctionComponent<{ band: SeverityBand }> = ({ band }) => (
  <span className="inline-flex items-center gap-2">
    <ChartSwatch color={severityBandFillColor(band)} />
    {severityBandLabel(band)}
  </span>
);

export const OccupancyBar: FunctionComponent<{ figures: Pick<PaceFiguresLike, 'occupancy' | 'newPerMonth'> }> = ({ figures }) => (
  <span className="bg-muted block h-2 overflow-hidden rounded-full" aria-hidden>
    <span
      className={cn('block h-full rounded-full', OCCUPANCY_FILL_CLASS[occupancyLevel(figures)])}
      style={{ width: `${occupancyBarRatio(figures) * 100}%` }}
    />
  </span>
);

export const OccupancyMeter: FunctionComponent<{ figures: Pick<PaceFiguresLike, 'occupancy' | 'newPerMonth'>, className?: string }> = ({ figures, className }) => {
  const level = occupancyLevel(figures);
  return (
    <span className={cn('grid grid-cols-[minmax(0,1fr)_3.75rem] items-center gap-3', className)}>
      <OccupancyBar figures={figures} />
      <span className={cn('txt-table whitespace-nowrap text-right font-semibold tabular-nums', level === 'within' ? undefined : OCCUPANCY_TONE_CLASS[level])}>
        {formatOccupancy(figures)}
      </span>
    </span>
  );
};

const bandAdjective = (band: SeverityBand): string => {
  switch (band) {
    case 'critical': return t({ message: 'critical', context: 'severity of findings, in a sentence' });
    case 'high': return t({ message: 'high', context: 'severity of findings, in a sentence' });
    case 'medium': return t({ message: 'medium', context: 'severity of findings, in a sentence' });
    case 'low': return t({ message: 'low', context: 'severity of findings, in a sentence' });
    default: return band;
  }
};

export const FallingBehindAlert: FunctionComponent<{ bands: ReadonlyArray<{ band: SeverityBand } & Pick<PaceFiguresLike, 'occupancy' | 'newPerMonth'>> }> = ({ bands }) => {
  const behind = bandsFallingBehind(bands);
  if (behind.length === 0) {
    return null;
  }
  const bandList = formatList(behind.map(bandAdjective));
  return <Alert severity="error" title={<Trans>Your team is no longer keeping up with {bandList} findings.</Trans>} />;
};

export const PaceVerdictLabel: FunctionComponent<{ figures: Pick<PaceFiguresLike, 'newInWindow' | 'closedInWindow'>, windowDays: number, className?: string }> = ({ figures, windowDays, className }) => {
  const { direction, perWeek } = paceVerdict(figures, windowDays);
  const perWeekLabel = formatRate(perWeek);
  return (
    <span className={cn('whitespace-nowrap font-medium', direction === 'behind' ? 'text-feedback-error-primary' : 'text-muted-foreground', className)}>
      {direction === 'behind'
        ? <Trans>Falling behind by {perWeekLabel} / week</Trans>
        : direction === 'clearing'
          ? <Trans>Clearing {perWeekLabel} / week</Trans>
          : <Trans>Holding level</Trans>}
    </span>
  );
};

export const RemediationPaceInfo: FunctionComponent = () => (
  <MetricInfo
    title={t`Remediation pace`}
    what={<Trans>Whether your team closes findings as fast as they arrive, per severity band.</Trans>}
    how={
      <Trans>
        Occupancy is new findings per month divided by the closing capacity, the best closing rate
        the team held over three consecutive full months within the last twelve, or over the full
        months so far while there are fewer. The wait before a fix
        grows like 1 / (1 − occupancy): twice as long at 50 %, five times at 80 %, ten times at 90 %,
        twenty times at 95 %. Open findings equal new findings per month times the mean time open
        (Little's law). A finding takes its current score band.
      </Trans>
    }
    caveat={
      <Trans>
        Closed means dismissed, not remediated: a finding a connector no longer reports and one a
        person set aside both count as closed. A reopened finding counts as open again.
      </Trans>
    }
  />
);

export const NotEnoughHistory: FunctionComponent<{ measurableFrom: string | null }> = ({ measurableFrom }) => {
  const date = measurableFrom === null
    ? null
    : formatDateWith(utcDayToTimestamp(measurableFrom), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  return (
    <div className="flex min-h-[340px] flex-col items-center justify-center gap-2.5 text-center">
      <Clock className="text-muted-foreground h-7 w-7" aria-hidden />
      <p className="font-medium">
        <Trans>Not enough history yet</Trans>
      </p>
      <p className="txt-sub-content text-muted-foreground">
        {date === null ? <Trans>No finding has arrived in this scope.</Trans> : <Trans>Measurable from {date}.</Trans>}
      </p>
    </div>
  );
};
