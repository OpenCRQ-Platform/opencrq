import { Button, Card, CardHeader, CardTitle, Text } from '@filigran/design-system';
import { Skeleton } from '@filigran/ui';
import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent, ReactNode } from 'react';
import { useState } from 'react';
import type { LossExceedanceThreshold } from '../components/loss-exceedance-chart';
import type { ExceedanceHistory, ToleranceSince } from '../exceedance-history-utils';
import type { RiskTreatmentCardData, RiskTreatmentSeriesData } from './risk-treatment-scenario-card';
import { buildExceedanceCurve, isOutsideTolerance, readExceedance, resolveAppliedTolerance } from '@app/module/client';
import { MetricInfo } from '../../../components/shared';
import { cn, formatDateWith, formatDollar } from '../../../utils';
import { CARD_CONTENT_FILLS } from '../../../components/ui/card-content-fills';
import { formatThreshold, ScenarioRiskToleranceDrawer, ToleranceVerdictChip } from '../../risk-tolerance';
import { formatProbability, formatToleranceProbability } from '../../risk-tolerance/risk-tolerance-utils';
import { AGGREGATE_RISK_WINDOW_DAYS } from '../aggregate-risk-utils';
import { ExceedanceHistoryChart } from '../components/exceedance-history-chart';
import { formatExceedance, LossExceedanceChart } from '../components/loss-exceedance-chart';
import { changeTitleSince, formatTenthsOfPointsChange, formatTrendMonth, TrendChangeChip } from '../components/trend-change-chip';
import { utcDayToTimestamp } from '../dashboard-utils';
import { readExceedanceHistory, sinceNeedsYear } from '../exceedance-history-utils';
import { scenarioTrendWindow } from '../risk-treatment-utils';
import { breachSegment } from '../loss-exceedance-utils';

const formatSinceMonth = (date: string, today: string): string =>
  formatDateWith(utcDayToTimestamp(date), {
    month: 'long',
    year: sinceNeedsYear(date, today) ? 'numeric' : undefined,
    timeZone: 'UTC',
  });

const SinceLine: FunctionComponent<{ since: ToleranceSince, today: string }> = ({ since, today }) => {
  const outside = since.status !== 'back';
  let label: string;
  if (since.status === 'outsideThroughout') {
    label = t`Outside tolerance over the whole 12 months`;
  } else {
    const month = formatSinceMonth(since.date, today);
    label = since.status === 'outside'
      ? i18n._({ id: 'Outside tolerance since {month}', message: 'Outside tolerance since {month}', values: { month } })
      : i18n._({ id: 'Back within tolerance since {month}', message: 'Back within tolerance since {month}', values: { month } });
  }
  return (
    <Text
      as="p"
      variant="content-compact"
      className={cn('flex items-center gap-2 font-medium', outside ? 'text-feedback-error-primary' : 'text-feedback-success-primary')}
    >
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
      {label}
    </Text>
  );
};

interface ExceedanceHistoryPanelProps {
  history: ExceedanceHistory,
  threshold: LossExceedanceThreshold,
  today: string,
  windowStart: string,
}

const ExceedanceHistoryPanel: FunctionComponent<ExceedanceHistoryPanelProps> = ({ history, threshold, today, windowStart }) => {
  const span = scenarioTrendWindow(today, AGGREGATE_RISK_WINDOW_DAYS);
  const { annualLoss, maxExceedanceProbability } = threshold.tolerance;
  const amount = formatDollar(annualLoss);
  const maximum = formatToleranceProbability(maxExceedanceProbability);
  const first = history.points[0];
  const ariaLabel = i18n._({
    id: 'Probability of exceeding {amount} over 12 months, from {first} to {latest}, against a maximum of {maximum}',
    message: 'Probability of exceeding {amount} over 12 months, from {first} to {latest}, against a maximum of {maximum}',
    values: { amount, first: formatProbability(first.probability), latest: formatExceedance(threshold.reading), maximum },
  });

  return (
    <Card elevation={3} gap={8} className={CARD_CONTENT_FILLS}>
      <CardHeader>
        <CardTitle
          as="h4"
          endAdornment={(
            <MetricInfo
              title={t`Last 12 months`}
              what={i18n._({
                id: "The probability that the year's loss exceeds {amount}, day by day over the last 12 months.",
                message: "The probability that the year's loss exceeds {amount}, day by day over the last 12 months.",
                values: { amount },
              })}
              how={<Trans>Read from each day's latest simulation, on its annual loss distribution as the curve reads it. A day whose simulation kept no distribution is skipped.</Trans>}
              caveat={<Trans>Every simulation of the last 12 months is read against the threshold in force today, since the tolerance keeps no history.</Trans>}
            />
          )}
        >
          {t`Last 12 months`}
        </CardTitle>
      </CardHeader>
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-3">
          <Text as="span" variant="title-xl" className="tabular-nums">{formatExceedance(threshold.reading)}</Text>
          <TrendChangeChip reading={history} formatChange={formatTenthsOfPointsChange} title={changeTitleSince(first.date, windowStart)} />
        </div>
        <Text as="span" variant="content-compact" className="text-default-secondary">
          <Trans>Maximum tolerated <span className="text-default-primary tabular-nums">{maximum}</span></Trans>
        </Text>
      </div>
      <ExceedanceHistoryChart
        history={history}
        maxExceedanceProbability={maxExceedanceProbability}
        outside={threshold.outside}
        ariaLabel={ariaLabel}
        axis={{ start: formatTrendMonth(span.start), end: formatTrendMonth(span.end) }}
      />
      {history.since !== null && <SinceLine since={history.since} today={today} />}
    </Card>
  );
};

const NoTolerancePanel: FunctionComponent<{ onSet: () => void }> = ({ onSet }) => (
  <Card elevation={3} gap={8} className={CARD_CONTENT_FILLS}>
    <CardHeader>
      <CardTitle as="h4">{t`Last 12 months`}</CardTitle>
    </CardHeader>
    <div className="flex grow flex-col items-start justify-center gap-4">
      <Text as="p" variant="content-compact" className="text-default-secondary">
        <Trans>Set a risk tolerance to follow the probability of exceeding it over the last 12 months.</Trans>
      </Text>
      <Button type="button" priority="secondary" size="sm" onClick={onSet}>{t`Set a risk tolerance`}</Button>
    </div>
  </Card>
);

interface LossExceedanceCardProps {
  card: RiskTreatmentCardData,
  /** Undefined while the scenario's series is being read, and when the read failed. */
  series: RiskTreatmentSeriesData | undefined,
  seriesPending: boolean,
  today: string,
}

export const LossExceedanceCard: FunctionComponent<LossExceedanceCardProps> = ({ card, series, seriesPending, today }) => {
  const [editing, setEditing] = useState(false);
  const applied = resolveAppliedTolerance(card.scopeTolerance, card.ownTolerance);
  const annualLoss = series?.annualLoss ?? null;
  const curve = annualLoss === null ? null : buildExceedanceCurve(annualLoss);
  let threshold: LossExceedanceThreshold | null = null;
  if (curve !== null && applied !== null) {
    const reading = readExceedance(curve, applied.tolerance.annualLoss);
    threshold = {
      tolerance: applied.tolerance,
      reading,
      outside: isOutsideTolerance(reading, applied.tolerance),
      breach: breachSegment(curve, applied.tolerance),
    };
  }
  const history = threshold === null || series === undefined
    ? null
    : readExceedanceHistory(series.series, threshold.tolerance.maxExceedanceProbability, today, AGGREGATE_RISK_WINDOW_DAYS, series.windowStart);
  const panel = threshold !== null && series !== undefined && history !== null && history.points.length > 0
    ? { threshold, history, windowStart: series.windowStart }
    : null;
  const invitesTolerance = curve !== null && applied === null;

  let body: ReactNode;
  if (seriesPending) {
    body = <Skeleton className="h-64 w-full" />;
  } else if (series === undefined) {
    body = (
      <Text as="p" variant="content-compact" className="text-default-secondary">
        <Trans>The loss exceedance curve could not be read.</Trans>
      </Text>
    );
  } else if (curve === null || annualLoss === null) {
    body = (
      <Text as="p" variant="content-compact" className="text-default-secondary">
        <Trans>The latest simulation kept no annual loss distribution, so there is no curve to draw. Run a simulation to draw it.</Trans>
      </Text>
    );
  } else {
    body = (
      <div className={cn('grid grid-cols-[minmax(0,1fr)] gap-4', (panel !== null || invitesTolerance) && 'lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]')}>
        <Card elevation={3} className={CARD_CONTENT_FILLS}>
          <LossExceedanceChart curve={curve} aleMean={card.aleMean ?? annualLoss.mean} threshold={threshold} />
        </Card>
        {panel !== null && <ExceedanceHistoryPanel {...panel} today={today} />}
        {invitesTolerance && <NoTolerancePanel onSet={() => setEditing(true)} />}
      </div>
    );
  }

  return (
    <Card elevation={2} gap={8}>
      <CardHeader
        action={(
          <span className="flex flex-wrap items-center justify-end gap-3">
            {applied === null
              ? !invitesTolerance && (
                <Button type="button" priority="secondary" size="sm" onClick={() => setEditing(true)}>{t`Set a risk tolerance`}</Button>
              )
              : (
                <>
                  <Text as="span" variant="content-compact" className="text-default-secondary">
                    {applied.source === 'scenario' ? t`Scenario's own threshold` : t`Risk scope threshold`}
                    {' '}
                    <span className="text-default-primary tabular-nums">{formatThreshold(applied.tolerance)}</span>
                  </Text>
                  <Button type="button" priority="tertiary" size="sm" onClick={() => setEditing(true)}>{t`Edit`}</Button>
                  {threshold !== null && <ToleranceVerdictChip outside={threshold.outside} />}
                </>
              )}
          </span>
        )}
      >
        <CardTitle
          as="h3"
          endAdornment={(
            <MetricInfo
              title={t`Loss exceedance curve`}
              what={<Trans>The probability that the year's loss exceeds each amount.</Trans>}
              how={(
                <Trans>
                  Read from the annual loss distribution the scenario's latest simulation kept, from the share of years costing anything
                  down to the 0.1% tail. It starts above the likelihood, the share of years with a loss event, because an attack stopped
                  in time still costs its response.
                </Trans>
              )}
              caveat={<Trans>The tolerance applies to this scenario on its own, never to the sum of the scope's scenarios.</Trans>}
            />
          )}
        >
          {t`Loss exceedance curve`}
        </CardTitle>
      </CardHeader>
      {body}
      <ScenarioRiskToleranceDrawer
        open={editing}
        onClose={() => setEditing(false)}
        scenarioName={card.name}
        riskScenarioId={card.scenarioId}
        organizationId={card.organizationId}
        scopeTolerance={card.scopeTolerance}
        ownTolerance={card.ownTolerance}
      />
    </Card>
  );
};
