import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Card, CardHeader, CardTitle, Text } from '@filigran/design-system';
import { Skeleton } from '@filigran/ui';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent, ReactNode } from 'react';
import type { AggregateRiskMetric, AggregateRiskReading } from '../aggregate-risk-utils';
import { DashboardGroup, Lifeline, MetricInfo } from '../../../components/shared';
import { EmptyValue } from '../../../components/ui/empty-value';
import { useTRPC } from '../../../lib';
import { formatDollar, formatDollarChange, formatFractionAsPercent } from '../../../utils';
import { AGGREGATE_RISK_WINDOW_DAYS, aggregateRiskWindow, aggregateRiskWindowStartDay, readAggregateRisk } from '../aggregate-risk-utils';
import { changeTitleSince, formatPointsChange, formatTrendMonth, TrendChangeChip } from '../components/trend-change-chip';

interface TileDefinition {
  metric: AggregateRiskMetric,
  label: string,
  info: ReactNode,
  formatValue: (value: number) => string,
  formatChange: (change: number) => string,
}

const AggregateRiskTile: FunctionComponent<{
  definition: TileDefinition,
  reading: AggregateRiskReading | undefined,
  windowStart: string | null,
  axis: { start: string, end: string } | null,
}> = ({ definition, reading, windowStart, axis }) => {
  const { label } = definition;
  return (
    <Card elevation={2} gap={16}>
      <CardHeader>
        <CardTitle as="h3" endAdornment={definition.info}>{label}</CardTitle>
      </CardHeader>
      {reading === undefined
        ? <Skeleton className="h-36 w-full" />
        : (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <Text as="span" variant="title-xl" className="tabular-nums">
                {reading.current === null ? <EmptyValue /> : definition.formatValue(reading.current)}
              </Text>
              <TrendChangeChip
                reading={reading}
                formatChange={definition.formatChange}
                title={windowStart === null ? undefined : changeTitleSince(reading.firstDate, windowStart)}
              />
            </div>
            <Lifeline
              values={reading.values}
              rise="bad"
              curve="monotone"
              className="h-20"
              ariaLabel={i18n._({ id: '{label} over 12 months', message: '{label} over 12 months', values: { label } })}
            />
            {axis !== null && (
              <div className="flex justify-between font-content-compact text-content-compact text-default-secondary">
                <span>{axis.start}</span>
                <span>{axis.end}</span>
              </div>
            )}
          </div>
        )}
    </Card>
  );
};

interface AggregateRiskGroupProps {
  organizationId?: string,
}

export const AggregateRiskGroup: FunctionComponent<AggregateRiskGroupProps> = ({ organizationId }) => {
  const trpc = useTRPC();
  const { data } = useQuery(trpc.dashboard.getExposureTrend.queryOptions({ organizationId, windowDays: AGGREGATE_RISK_WINDOW_DAYS }));

  const span = data === undefined ? null : aggregateRiskWindow(data);
  const axis = span === null ? null : { start: formatTrendMonth(span.start), end: formatTrendMonth(span.end) };

  const tiles: Array<TileDefinition> = [
    {
      metric: 'likelihood',
      label: t`Likelihood`,
      info: (
        <MetricInfo
          title={t`Likelihood`}
          what={<Trans>The probability of at least one loss event in the year, across the scope's scenarios.</Trans>}
          how={<Trans>1 − e^−LEF, where LEF sums the loss event frequency of each scenario's latest simulation on that day.</Trans>}
        />
      ),
      formatValue: (value) => formatFractionAsPercent(value, 0),
      formatChange: formatPointsChange,
    },
    {
      metric: 'magnitude',
      label: t`Loss magnitude`,
      info: (
        <MetricInfo
          title={t`Loss magnitude`}
          what={<Trans>The mean loss per loss event.</Trans>}
          how={<Trans>The scope's annual loss exposure divided by its loss event frequency, both summed over its scenarios.</Trans>}
        />
      ),
      formatValue: formatDollar,
      formatChange: formatDollarChange,
    },
    {
      metric: 'ale',
      label: t`Annual loss exposure`,
      info: (
        <MetricInfo
          title={t`Annual loss exposure`}
          what={<Trans>The loss to expect on average over a year: the loss event frequency times the loss magnitude.</Trans>}
          how={<Trans>The sum of the mean annual loss exposure of each scenario's latest simulation on that day.</Trans>}
          caveat={<Trans>No P10 to P90 band at this level: adding up the scenarios' bands would assume they all have their worst year at once.</Trans>}
        />
      ),
      formatValue: formatDollar,
      formatChange: formatDollarChange,
    },
  ];

  return (
    <DashboardGroup icon="activity" title={t`Aggregate risk`}>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[repeat(3,minmax(0,1fr))]">
        {tiles.map((definition) => (
          <AggregateRiskTile
            key={definition.metric}
            definition={definition}
            reading={data === undefined ? undefined : readAggregateRisk(data, definition.metric)}
            windowStart={data === undefined ? null : aggregateRiskWindowStartDay(data)}
            axis={axis}
          />
        ))}
      </div>
    </DashboardGroup>
  );
};
