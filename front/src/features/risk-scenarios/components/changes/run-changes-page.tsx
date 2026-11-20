import { Button, Paper, Tabs, TabsList, TabsTrigger } from '@filigran/design-system';
import { Skeleton } from '@filigran/ui';
import type { ChangeCategoryKey, ChangeTab } from '@app/module/client';
import { CHANGE_TABS } from '@app/module/client';
import { i18n } from '@lingui/core';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowRight, ChevronLeft, ZoomIn, ZoomOut } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { useState } from 'react';
import type { ChangePeriod, ChangesRun, CurveRange } from './run-changes-utils';
import { DetailPageLayout, directionBetween, TooltipHintProvider } from '../../../../components/shared';
import { useDelayedFlag, useReaderTimeZone } from '../../../../hooks';
import { useTRPC } from '../../../../lib';
import { cn, formatDateMinute, formatDollar, formatDollarChange, formatRelativeTime, formatSignedNumber } from '../../../../utils';
import { TrendChangeChip } from '../../../dashboard/components/trend-change-chip';
import {
  DEFENCES_DIGITS,
  formatDefences,
  formatThreat,
  pointsLabel,
  printedChange,
  THREAT_DIGITS,
} from '../overview/ale-decomposition-utils';
import { RunChangesChronology } from './run-changes-chronology';
import { RunChangesCurve } from './run-changes-curve';
import { RunChangesDock } from './run-changes-dock';
import { RunFigure, RunValue } from './run-changes-figure';
import { createMarkerStore } from './run-changes-marker-store';
import { RunChangesTiles } from './run-changes-tiles';
import {
  buildChronology,
  buildCurve,
  CHANGE_PERIODS,
  matchingPeriod,
  pairOfChanges,
  periodRange,
  readTiles,
  resolveComparedPair,
  TAB_VALUE,
} from './run-changes-utils';

const DAY_MS = 86_400_000;
const PENDING_DELAY_MS = 250;
const PENDING_MIN_DURATION_MS = 200;

const PERIOD_LABEL: Record<ChangePeriod, () => string> = {
  previous: () => t`Previous run`,
  '7d': () => t`7 days`,
  '30d': () => t`30 days`,
  '90d': () => t`90 days`,
  '1y': () => t`1 year`,
};

interface TabDisplay {
  label: () => string,
  formatValue: (value: number) => string,
  formatChange: (before: number, after: number) => string,
}

const TAB_DISPLAY: Record<ChangeTab, TabDisplay> = {
  ale: {
    label: () => t`Annual Loss Exposure`,
    formatValue: formatDollar,
    formatChange: (before, after) => formatDollarChange(after - before),
  },
  tef: {
    label: () => t`Threat event frequency (TEF)`,
    formatValue: formatThreat,
    formatChange: (before, after) => formatSignedNumber(printedChange(after, after - before, THREAT_DIGITS), THREAT_DIGITS),
  },
  susceptibility: {
    label: () => t`Effective susceptibility`,
    formatValue: formatDefences,
    formatChange: (before, after) => pointsLabel(formatSignedNumber(printedChange(after, after - before, DEFENCES_DIGITS), DEFENCES_DIGITS)),
  },
  magnitude: {
    label: () => t`Loss magnitude (LM)`,
    formatValue: formatDollar,
    formatChange: (before, after) => formatDollarChange(after - before),
  },
};

interface RunChangesPageProps {
  riskScenario: { id: string, name: string },
  firstRunId: string | undefined,
  secondRunId: string | undefined,
  tab: ChangeTab,
  onCompare: (beforeRunId: string, afterRunId: string) => Promise<void>,
  onTabChange: (tab: ChangeTab) => void,
}

const LoadingPage: FunctionComponent = () => (
  <div className="flex flex-col gap-5">
    <Skeleton className="h-80 w-full" />
    <Skeleton className="h-24 w-full" />
    <Skeleton className="h-64 w-full" />
  </div>
);

export const RunChangesPage: FunctionComponent<RunChangesPageProps> = ({ riskScenario, firstRunId, secondRunId, tab, onCompare, onTabChange }) => {
  const trpc = useTRPC();
  const [filter, setFilter] = useState<ReadonlyArray<ChangeCategoryKey>>([]);
  const [markerStore] = useState(createMarkerStore);
  const [focused, setFocused] = useState(false);

  const { data: runs } = useQuery(trpc.aleChangeExplain.getRunCurve.queryOptions({ riskScenarioId: riskScenario.id }));
  const pair = runs === undefined ? null : resolveComparedPair(runs, firstRunId, secondRunId);
  const comparison = { riskScenarioId: riskScenario.id, firstRunId: pair?.before.id ?? '', secondRunId: pair?.after.id ?? '' };
  const { timeZone, queryOptions, fallBackOn } = useReaderTimeZone();
  // The previous pair's changes hold the page's height while the next pair loads: a shorter page
  // clamps the scroll to the top, which unfolds the docked curve the range was changed from.
  const {
    data: changes,
    error,
    isPlaceholderData,
  } = useQuery(trpc.aleChangeExplain.getRunChanges.queryOptions(
    { ...comparison, timeZone },
    { ...queryOptions, enabled: pair !== null, placeholderData: keepPreviousData },
  ));
  fallBackOn(error);
  const showPending = useDelayedFlag(isPlaceholderData, { delay: PENDING_DELAY_MS, minDuration: PENDING_MIN_DURATION_MS });

  const latest = runs?.[0];
  const display = TAB_DISPLAY[tab];

  const readPair = (shown: { before: ChangesRun, after: ChangesRun }) => {
    const beforeValue = TAB_VALUE[tab](shown.before);
    const afterValue = TAB_VALUE[tab](shown.after);
    return {
      beforeLabel: beforeValue === null ? null : display.formatValue(beforeValue),
      afterLabel: afterValue === null ? null : display.formatValue(afterValue),
      changeChip: beforeValue === null || afterValue === null
        ? null
        : (
          <TrendChangeChip
            reading={{ change: afterValue - beforeValue, direction: directionBetween(beforeValue, afterValue) }}
            formatChange={(change) => display.formatChange(afterValue - change, afterValue)}
            title={t`Change between the two runs`}
          />
        ),
    };
  };

  const body = () => {
    if (runs === undefined) {
      return <LoadingPage />;
    }
    if (pair === null) {
      return (
        <Paper>
          <p className="text-muted-foreground"><Trans>The scenario needs two runs before anything can be compared.</Trans></p>
        </Paper>
      );
    }
    const points = buildCurve(runs, tab);
    const beforeIndex = points.findIndex((point) => point.runId === pair.before.id);
    const afterIndex = points.findIndex((point) => point.runId === pair.after.id);
    const { beforeLabel, afterLabel, changeChip } = readPair(pair);
    const beforeDate = formatDateMinute(pair.before.createdAt);
    const afterDate = formatDateMinute(pair.after.createdAt);

    const range: CurveRange = [beforeIndex, afterIndex];
    const compare = (next: CurveRange) => onCompare(points[next[0]].runId, points[next[1]].runId);
    const activePeriod = matchingPeriod(points, range);
    const dayCount = Math.round((new Date(pair.after.createdAt).getTime() - new Date(pair.before.createdAt).getTime()) / DAY_MS);
    const runCount = afterIndex - beforeIndex + 1;
    const dayLabel = plural(dayCount, { one: '# day', other: '# days' });
    const runLabel = plural(runCount, { one: '# run', other: '# runs' });

    const tiles = changes === undefined || changes === null ? [] : readTiles(changes.categories, changes.events, tab);
    const activeFilter = filter.filter((key) => tiles.some((tile) => tile.key === key));
    const chronology = changes === undefined || changes === null ? null : buildChronology(changes, tiles, activeFilter);
    const chronologyPair = changes === undefined || changes === null ? null : readPair(pairOfChanges(runs, changes, pair));
    const curveLabel = display.label();

    const header = (
      <div className="flex flex-wrap items-end gap-8">
        <RunFigure label={<Trans>Before</Trans>} value={beforeLabel} date={beforeDate} muted />
        <ArrowRight aria-hidden className="mb-6 size-7 text-muted-foreground" />
        <RunFigure label={<Trans>After</Trans>} value={afterLabel} date={afterDate} muted={false} chip={changeChip} />
        <div className="ml-auto flex flex-col items-end gap-2">
          <div className="flex flex-wrap items-center justify-end gap-4">
            <Button
              size="sm"
              priority={focused ? 'secondary' : 'tertiary'}
              startIcon={focused ? <ZoomOut className="size-3" /> : <ZoomIn className="size-3" />}
              onClick={() => setFocused(!focused)}
            >
              {focused ? <Trans>Zoom out</Trans> : <Trans>Zoom in</Trans>}
            </Button>
            <div role="group" aria-label={t`Compared period`} className="flex flex-wrap justify-end gap-1">
              {CHANGE_PERIODS.map((period) => (
                <Button
                  key={period}
                  size="sm"
                  priority={period === activePeriod ? 'secondary' : 'tertiary'}
                  aria-pressed={period === activePeriod}
                  onClick={() => compare(periodRange(points, period))}
                >
                  {PERIOD_LABEL[period]()}
                </Button>
              ))}
            </div>
          </div>
          <span className="txt-sub-content text-muted-foreground"><Trans>{beforeDate} to {afterDate} · {dayLabel} · {runLabel}</Trans></span>
        </div>
      </div>
    );
    const summary = (
      <div className="flex flex-col gap-0.5">
        <span className="txt-sub-content text-muted-foreground">{curveLabel}</span>
        <div className="flex items-center gap-2 whitespace-nowrap">
          <span className="txt-default font-bold text-muted-foreground"><RunValue value={beforeLabel} /></span>
          <ArrowRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="txt-default font-bold"><RunValue value={afterLabel} /></span>
          {changeChip}
        </div>
        <span className="truncate txt-sub-content text-muted-foreground"><Trans>{beforeDate} to {afterDate} · {dayLabel} · {runLabel}</Trans></span>
      </div>
    );

    return (
      <TooltipHintProvider>
        <div className="flex flex-col">
          <RunChangesDock
            header={header}
            summary={summary}
            focused={focused}
            curve={(collapse, zoom) => (
              <RunChangesCurve
                points={points}
                range={range}
                onRangeChange={compare}
                formatValue={display.formatValue}
                formatChange={display.formatChange}
                ariaLabel={i18n._({ id: "{curveLabel} over the scenario's runs", message: "{curveLabel} over the scenario's runs", values: { curveLabel } })}
                markerStore={markerStore}
                collapse={collapse}
                zoom={zoom}
              />
            )}
          />
          <div aria-busy={isPlaceholderData} inert={showPending} className={cn('mt-5 flex flex-col gap-5 transition-opacity', showPending && 'opacity-40')}>
            {chronology === null || chronologyPair === null
              ? <Skeleton className="h-64 w-full" />
              : (
                <>
                  <RunChangesTiles tiles={tiles} selected={activeFilter} onSelect={setFilter} />
                  <RunChangesChronology
                    chronology={chronology}
                    comparison={comparison}
                    beforeValue={<RunValue value={chronologyPair.beforeLabel} />}
                    afterValue={<RunValue value={chronologyPair.afterLabel} />}
                    changeChip={chronologyPair.changeChip}
                    onMarker={markerStore.set}
                  />
                </>
              )}
          </div>
        </div>
      </TooltipHintProvider>
    );
  };

  const latestAge = latest === undefined ? null : formatRelativeTime(latest.createdAt);
  const scenarioName = riskScenario.name;

  return (
    <DetailPageLayout
      title={t`What changed`}
      titleLeading={(
        <Link
          from="/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId"
          to="overview"
          aria-label={i18n._({ id: 'Back to {scenarioName}', message: 'Back to {scenarioName}', values: { scenarioName } })}
          className="inline-flex size-8 items-center justify-center rounded-sm border border-[var(--fds-border-elevation-subtle)] hover:border-primary/60"
        >
          <ChevronLeft className="size-4" />
        </Link>
      )}
      actions={latestAge === null ? undefined : <span className="txt-sub-content text-muted-foreground"><Trans>Latest run {latestAge}</Trans></span>}
    >
      <Tabs
        value={tab}
        onValueChange={(value) => {
          const picked = CHANGE_TABS.find((key) => key === value);
          if (picked !== undefined) {
            onTabChange(picked);
          }
        }}
      >
        <TabsList>
          {CHANGE_TABS.map((key) => (
            <TabsTrigger key={key} value={key}>{TAB_DISPLAY[key].label()}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {body()}
    </DetailPageLayout>
  );
};
