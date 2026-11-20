import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Card, CardHeader, CardTitle, Tabs, TabsList, TabsTrigger, Text } from '@filigran/design-system';
import { Skeleton } from '@filigran/ui';
import type { SeverityBand } from '@app/module/client';
import { SEVERITY_BANDS } from '@app/module/client';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { FunctionComponent, ReactNode } from 'react';
import { lazy, Suspense, useState } from 'react';
import type { DashboardProps } from './dashboard-registry';
import type { LifelineRise } from '../../components/shared/lifeline-utils';
import type { PaceBandFilter, RemediationPacePayload } from './remediation-pace-utils';
import { DashboardGroup, Lifeline } from '../../components/shared';
import { useTRPC } from '../../lib';
import { cn, formatFractionAsPercent, formatNumber } from '../../utils';
import { severityBandLabel } from '../finding-score/ui/severity-ramp';
import {
  BandName,
  FallingBehindAlert,
  formatDays,
  formatOccupancy,
  formatRate,
  NotEnoughHistory,
  OCCUPANCY_TONE_CLASS,
  OccupancyBar,
  PaceVerdictLabel,
  RemediationPaceInfo,
} from './components/remediation-pace-parts';
import { formatTrendMonth, TrendChangeChip } from './components/trend-change-chip';
import { readChangeChip } from './dashboard-utils';
import { monthStartTimestamp, occupancyLevel, occupancySparkline, openChangeOverMonths, openChangeOverWindow } from './remediation-pace-utils';

const LazyMonthlyFlowChart = lazy(() =>
  import('./components/monthly-flow-chart').then((m) => ({ default: m.MonthlyFlowChart })));

const BAND_TONE_CLASS: Record<SeverityBand, string> = {
  critical: 'text-feedback-error-primary',
  high: 'text-feedback-warning-primary',
  medium: 'text-feedback-alert-primary',
  low: 'text-feedback-success-primary',
};

const CHANGE_TONE_CLASS: Record<-1 | 0 | 1, string> = {
  [-1]: 'text-feedback-success-primary',
  0: 'text-default-secondary',
  1: 'text-feedback-error-primary',
};

const OPEN_CHANGE_MONTHS = 6;
const OCCUPANCY_DOMAIN = { min: 0, max: 1 };

/* eslint-disable lingui/no-unlocalized-strings -- Tailwind classes, not copy */
const TILE_GRID = 'grid grid-cols-[repeat(auto-fit,minmax(min(13.75rem,100%),1fr))] gap-4';
const BAND_GRID = 'grid grid-cols-[repeat(auto-fit,minmax(min(15rem,100%),1fr))] gap-5';
/* eslint-enable lingui/no-unlocalized-strings */

type Axis = { start: string, end: string } | null;

const monthAxis = (months: ReadonlyArray<{ month: string }>): Axis => {
  const first = months.at(0)?.month;
  const last = months.at(-1)?.month;
  return first === undefined || last === undefined
    ? null
    : { start: formatTrendMonth(monthStartTimestamp(first)), end: formatTrendMonth(monthStartTimestamp(last)) };
};

const AxisLabels: FunctionComponent<{ axis: Axis }> = ({ axis }) => (axis === null ? null : (
  <div className="flex justify-between font-content-compact text-content-compact text-default-secondary">
    <span>{axis.start}</span>
    <span>{axis.end}</span>
  </div>
));

const Caption: FunctionComponent<{ children: ReactNode }> = ({ children }) => (
  <Text as="span" variant="content-caption" className="text-default-secondary">{children}</Text>
);

export const RemediationPaceDashboard: FunctionComponent<DashboardProps> = ({ organizationId, windowDays }) => {
  const trpc = useTRPC();
  const { data, isPlaceholderData } = useQuery(trpc.dashboard.getRemediationPace.queryOptions(
    { organizationId, windowDays },
    { placeholderData: keepPreviousData },
  ));

  if (data === undefined) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-80 w-full" />
        <Skeleton className="h-96 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-6 transition-opacity', isPlaceholderData && 'pointer-events-none opacity-50')} aria-busy={isPlaceholderData}>
      {data.measurable ? (
        <>
          <OverviewGroup pace={data} />
          <BySeverityGroup pace={data} />
          <MonthlyFlowGroup pace={data} />
        </>
      ) : (
        <DashboardGroup icon="activity" title={t({ message: 'Overview', context: 'remediation pace dashboard group' })} info={<RemediationPaceInfo />}>
          <NotEnoughHistory measurableFrom={data.measurableFrom} />
        </DashboardGroup>
      )}
    </div>
  );
};

interface PaceTileProps {
  title: string,
  info?: ReactNode,
  figure: string,
  figureClassName?: string,
  chip?: ReactNode,
  note?: ReactNode,
  values: ReadonlyArray<number | null>,
  rise: LifelineRise,
  domain?: { min: number, max: number },
  axis: Axis,
  ariaLabel: string,
}

const PaceTile: FunctionComponent<PaceTileProps> = ({ title, info, figure, figureClassName, chip, note, values, rise, domain, axis, ariaLabel }) => (
  <Card elevation={2} gap={16}>
    <CardHeader>
      <CardTitle as="h3" endAdornment={info}>{title}</CardTitle>
    </CardHeader>
    <div className="flex flex-col gap-2">
      <div className="flex min-h-9 flex-wrap items-center gap-3">
        <Text as="span" variant="title-xl" className={cn('tabular-nums', figureClassName)}>{figure}</Text>
        {chip}
      </div>
      <Text as="p" variant="content-caption" className="min-h-[1.125rem] text-default-secondary tabular-nums">{note}</Text>
      <Lifeline
        values={values}
        rise={rise}
        curve="monotone"
        domain={domain}
        className="h-20"
        ariaLabel={ariaLabel}
      />
      <AxisLabels axis={axis} />
    </div>
  </Card>
);

const overTwelveMonths = (label: string): string =>
  i18n._({ id: '{label} over 12 months', message: '{label} over 12 months', values: { label } });

const OverviewGroup: FunctionComponent<{ pace: RemediationPacePayload }> = ({ pace }) => {
  const { total, bands } = pace;
  const level = occupancyLevel(total);
  const openChange = openChangeOverWindow(total);
  const occupancyHistory = occupancySparkline(total.occupancyHistory);
  const capacityLabel = formatRate(total.capacityPerMonth);
  return (
    <DashboardGroup icon="activity" title={t({ message: 'Overview', context: 'remediation pace dashboard group' })}>
      <FallingBehindAlert bands={bands} />
      <div className={TILE_GRID}>
        <PaceTile
          title={t`Occupancy`}
          info={<RemediationPaceInfo />}
          figure={formatOccupancy(total)}
          figureClassName={level === 'within' ? undefined : OCCUPANCY_TONE_CLASS[level]}
          note={<PaceVerdictLabel figures={total} windowDays={pace.windowDays} />}
          values={occupancyHistory}
          rise="bad"
          domain={OCCUPANCY_DOMAIN}
          axis={monthAxis(total.months.slice(-occupancyHistory.length))}
          ariaLabel={t`Occupancy over the last 6 months`}
        />
        <PaceTile
          title={t`New / month`}
          figure={formatRate(total.newPerMonth)}
          values={total.months.map((month) => month.newCount)}
          rise="bad"
          axis={monthAxis(total.months)}
          ariaLabel={overTwelveMonths(t`New / month`)}
        />
        <PaceTile
          title={t`Closed / month`}
          figure={formatRate(total.closedPerMonth)}
          note={i18n._({ id: 'Capacity {capacityLabel}', message: 'Capacity {capacityLabel}', values: { capacityLabel } })}
          values={total.months.map((month) => month.closedCount)}
          rise="good"
          axis={monthAxis(total.months)}
          ariaLabel={overTwelveMonths(t`Closed / month`)}
        />
        <PaceTile
          title={t`Open findings`}
          figure={formatNumber(total.openCount)}
          chip={openChange === null || openChange === 0 ? null : (
            <TrendChangeChip
              reading={{ change: openChange, direction: openChange > 0 ? 'up' : 'down' }}
              formatChange={(change) => formatFractionAsPercent(Math.abs(change), 0)}
              title={t`Change over the window`}
            />
          )}
          values={total.months.map((month) => month.openAtEnd)}
          rise="bad"
          axis={monthAxis(total.months)}
          ariaLabel={overTwelveMonths(t`Open findings at month end`)}
        />
      </div>
    </DashboardGroup>
  );
};

const BandCard: FunctionComponent<{ band: RemediationPacePayload['bands'][number] }> = ({ band }) => {
  const level = occupancyLevel(band);
  const series = band.months.map((month) => month.openAtEnd);
  const change = openChangeOverMonths(series, OPEN_CHANGE_MONTHS);
  const reading = change === null ? null : readChangeChip({ change, direction: change > 0 ? 'up' : 'down' }, (value) => formatFractionAsPercent(Math.abs(value), 0));
  const changeLabel = reading === null ? null : `${reading.sign > 0 ? '+' : reading.sign < 0 ? '−' : ''}${reading.label}`;
  const quiet = series.every((value) => value === 0);
  const label = severityBandLabel(band.band);
  const figures = [
    { key: 'new', caption: t`New / month`, value: formatRate(band.newPerMonth) },
    { key: 'closed', caption: t`Closed / month`, value: formatRate(band.closedPerMonth) },
    { key: 'capacity', caption: t`Capacity / month`, value: formatRate(band.capacityPerMonth) },
    { key: 'open', caption: t`Open findings`, value: formatNumber(band.openCount) },
    { key: 'median', caption: t`Median time open`, value: formatDays(band.medianDaysOpen) },
  ];
  return (
    <Card elevation={2} gap={16}>
      <CardHeader>
        <CardTitle as="h3"><BandName band={band.band} /></CardTitle>
      </CardHeader>
      <div className="flex flex-col gap-1.5">
        <Caption>{t`Occupancy`}</Caption>
        <Text as="span" variant="title-xl" className={cn('tabular-nums', level === 'within' ? undefined : OCCUPANCY_TONE_CLASS[level])}>
          {formatOccupancy(band)}
        </Text>
        <OccupancyBar figures={band} />
      </div>
      <dl className="m-0 grid grid-cols-[repeat(2,minmax(0,1fr))] gap-x-3 gap-y-3.5">
        {figures.map((figure) => (
          <div key={figure.key} className="flex min-w-0 flex-col gap-1">
            <dt><Caption>{figure.caption}</Caption></dt>
            <dd className="m-0"><Text as="span" variant="content-base" className="font-semibold tabular-nums">{figure.value}</Text></dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-col gap-1.5 border-t border-[var(--fds-border-elevation-subtle)] pt-3.5">
        <Caption>{t`Open findings at month end`}</Caption>
        <Text as="span" variant="content-caption" className={cn('min-h-[1.125rem] font-semibold tabular-nums', reading === null ? undefined : CHANGE_TONE_CLASS[reading.sign])}>
          {reading !== null && <Trans>{changeLabel} over 6 months</Trans>}
        </Text>
        <Lifeline
          values={series}
          rise="bad"
          curve="monotone"
          filled={false}
          toneClassName={quiet ? 'text-default-secondary' : BAND_TONE_CLASS[band.band]}
          className="h-[4.5rem]"
          ariaLabel={i18n._({ id: 'Open {label} findings at the end of each month', message: 'Open {label} findings at the end of each month', values: { label } })}
        />
        <AxisLabels axis={monthAxis(band.months)} />
      </div>
    </Card>
  );
};

const BySeverityGroup: FunctionComponent<{ pace: RemediationPacePayload }> = ({ pace }) => (
  <DashboardGroup icon="layers-2" title={t`By severity`} info={<RemediationPaceInfo />}>
    <div className={BAND_GRID}>
      {pace.bands.map((band) => <BandCard key={band.band} band={band} />)}
    </div>
  </DashboardGroup>
);

const MonthlyFlowGroup: FunctionComponent<{ pace: RemediationPacePayload }> = ({ pace }) => {
  const [bandFilter, setBandFilter] = useState<PaceBandFilter>('all');
  const figures = bandFilter === 'all' ? pace.total : pace.bands.find((band) => band.band === bandFilter) ?? pace.total;
  return (
    <DashboardGroup
      icon="chart-column"
      title={t`New and closed per month`}
      action={(
        <Tabs value={bandFilter} onValueChange={(value) => setBandFilter(value === 'all' ? 'all' : SEVERITY_BANDS.find((band) => band === value) ?? 'all')}>
          <TabsList aria-label={t`Severity`}>
            <TabsTrigger value="all">{t`All`}</TabsTrigger>
            {SEVERITY_BANDS.map((band) => <TabsTrigger key={band} value={band}>{severityBandLabel(band)}</TabsTrigger>)}
          </TabsList>
        </Tabs>
      )}
    >
      <Card elevation={2}>
        <Suspense fallback={<Skeleton className="h-[260px] w-full" />}>
          <LazyMonthlyFlowChart months={figures.months} capacity={figures.capacityPerMonth} />
        </Suspense>
      </Card>
    </DashboardGroup>
  );
};
