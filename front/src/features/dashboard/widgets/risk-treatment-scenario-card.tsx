import { Card, CardHeader, CardTitle, Chip, Paper, Text } from '@filigran/design-system';
import { DataTable, Skeleton } from '@filigran/ui';
import type { ColumnDefWithOptionsHeader } from '@filigran/ui';
import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Link, useNavigate } from '@tanstack/react-router';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import type { inferRouterOutputs } from '@trpc/server';
import { ShieldAlert } from 'lucide-react';
import type { FunctionComponent, ReactElement, ReactNode } from 'react';
import { useId } from 'react';
import type { ScenarioTrendReading } from '../risk-treatment-utils';
import { ControlIdPill, Lifeline, MetricInfo } from '../../../components/shared';
import { tileTonePaint } from '../../../components/shared/tile-tone';
import { useSeenOnce } from '../../../hooks';
import { getDataTableI18nKey } from '../../../components/ui/data-table-i18n';
import { EmptyValue } from '../../../components/ui/empty-value';
import { formatDollar, formatDollarChange, formatFractionAsPercent } from '../../../utils';
import { ControlEvolutionBadges } from '../../risk-scenarios/components/control-evolution-badges';
import { leverDimensionLabel } from '../../risk-scenarios/components/lever-dimension-label';
import { AGGREGATE_RISK_WINDOW_DAYS } from '../aggregate-risk-utils';
import { changeTitleSince, formatPointsChange, formatTrendMonth, TrendChangeChip } from '../components/trend-change-chip';
import { readScenarioTrend, scenarioTrendWindow } from '../risk-treatment-utils';
import { useRiskTreatmentSeries } from '../use-risk-treatment-series';
import { LossExceedanceCard } from './loss-exceedance-card';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;
export type RiskTreatmentCardData = RouterOutputs['dashboard']['getRiskTreatment'][number];
export type RiskTreatmentSeriesData = RouterOutputs['dashboard']['getRiskTreatmentSeries'];
type ControlMove = RiskTreatmentCardData['topControlMoves'][number] & { id: string };

/** How far ahead of the viewport a card starts reading its series, so it is drawn by the time it scrolls in. */
const SERIES_PRELOAD_MARGIN = 600;

const SCENARIO_ROUTE = '/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId' as const;
const SCENARIO_CRQ_ROUTE = '/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId/crq' as const;
const SCENARIO_CONTROLS_ROUTE = '/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId/controls' as const;

const formatWholePercent = (fraction: number): string => formatFractionAsPercent(fraction, 0);

interface TrendCardProps {
  label: string,
  info: ReactNode,
  reading: ScenarioTrendReading,
  loading: boolean,
  axis: { start: string, end: string },
  windowStart: string,
  formatValue: (value: number) => string,
  formatChange: (change: number) => string,
  footer?: ReactNode,
}

const TrendCard: FunctionComponent<TrendCardProps> = ({ label, info, reading, loading, axis, windowStart, formatValue, formatChange, footer }) => (
  <Card elevation={2} gap={16}>
    <CardHeader>
      <CardTitle as="h3" endAdornment={info}>{label}</CardTitle>
    </CardHeader>
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        {loading
          ? <Skeleton className="h-8 w-28" />
          : (
            <>
              <Text as="span" variant="title-xl" className="tabular-nums">
                {reading.current === null ? <EmptyValue /> : formatValue(reading.current)}
              </Text>
              <TrendChangeChip reading={reading} formatChange={formatChange} title={changeTitleSince(reading.firstDate, windowStart)} />
            </>
          )}
      </div>
      {loading
        ? <Skeleton className="h-20 w-full" />
        : reading.values.length === 0
          ? <Text as="p" variant="content-compact" className="text-default-secondary"><Trans>No reading over the last 12 months.</Trans></Text>
          : (
            <>
              <Lifeline
                values={reading.values}
                xs={reading.xs}
                rise="bad"
                curve="monotone"
                className="h-20"
                ariaLabel={i18n._({ id: '{label} over 12 months', message: '{label} over 12 months', values: { label } })}
              />
              <div className="flex justify-between font-content-compact text-content-compact text-default-secondary">
                <span>{axis.start}</span>
                <span>{axis.end}</span>
              </div>
            </>
          )}
      {footer}
    </div>
  </Card>
);

const ControlMovesCard: FunctionComponent<{ card: RiskTreatmentCardData }> = ({ card }) => {
  const navigate = useNavigate();
  const columns: Array<ColumnDefWithOptionsHeader<ControlMove, unknown>> = [
    {
      id: 'externalId',
      header: t`ID`,
      size: 80,
      enableSorting: false,
      cell: ({ row }): ReactElement => <ControlIdPill externalId={row.original.externalId} />,
    },
    {
      id: 'name',
      header: t`Control`,
      size: 260,
      enableSorting: false,
      cell: ({ row }): ReactElement => <span className="block truncate font-medium">{row.original.name}</span>,
    },
    {
      id: 'category',
      header: t({ message: 'Change', context: 'kind of control move' }),
      size: 120,
      enableSorting: false,
      cell: ({ row }): ReactElement => <Chip label={leverDimensionLabel(row.original.dimension)} />,
    },
    {
      id: 'step',
      header: t`Step`,
      size: 230,
      enableSorting: false,
      cell: ({ row }): ReactElement => (
        <ControlEvolutionBadges
          dimension={row.original.dimension}
          currentStrength={row.original.currentStrength}
          upgradedStrength={row.original.upgradedStrength}
          currentCoverage={row.original.currentCoverage}
          upgradedCoverage={row.original.upgradedCoverage}
        />
      ),
    },
    {
      id: 'reduction',
      header: t`ALE reduction`,
      size: 150,
      enableSorting: false,
      cell: ({ row }): ReactElement => (
        <span className="whitespace-nowrap font-title-sm text-title-sm font-semibold tabular-nums text-feedback-success-primary">
          −{formatDollar(row.original.totalAleReduction)}
        </span>
      ),
    },
  ];

  return (
    <Card elevation={2} gap={8}>
      <CardHeader
        action={(
          <span className="flex min-h-6 items-center">
            <Link
              to={SCENARIO_CONTROLS_ROUTE}
              params={(prev) => ({ ...prev, tenantId: prev.tenantId ?? '', organizationId: card.organizationId, riskScenarioId: card.scenarioId })}
              className="font-content-compact text-content-compact text-filigran-brand-primary hover:underline"
            >
              {t`See all controls`}
            </Link>
          </span>
        )}
      >
        <CardTitle
          as="h3"
          endAdornment={(
            <MetricInfo
              title={t`Top recommended controls`}
              what={<Trans>The control moves that would cut this scenario's annual loss exposure most, one per control.</Trans>}
              how={(
                <Trans>
                  The scenario's latest simulation prices every one-step move of every control. A row keeps
                  the control's move with the largest reduction.
                </Trans>
              )}
              caveat={(
                <Trans>
                  Do not add the column up. Each figure assumes the others do not happen: controls overlap,
                  so the second move you make will be worth less than it says here.
                </Trans>
              )}
            />
          )}
        >
          {t`Top recommended controls`}
        </CardTitle>
      </CardHeader>
      <div className="scrollbar-discreet overflow-auto [&_.twp]:mt-0 [&_th]:pl-2 [&_td]:px-2">
        <DataTable
          i18nKey={getDataTableI18nKey()}
          data={card.topControlMoves.map((move) => ({ ...move, id: move.controlId }))}
          columns={columns}
          toolbar={<></>}
          onClickRow={(row) => {
            void navigate({
              to: '/$tenantId/{-$organizationId}/controls/$controlId/overview',
              params: (prev) => ({ tenantId: prev.tenantId!, controlId: row.original.controlId }),
            });
          }}
        />
      </div>
    </Card>
  );
};

const NotSimulated: FunctionComponent<{ card: RiskTreatmentCardData }> = ({ card }) => (
  <Card elevation={2}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Text as="p" variant="content-base" className="text-default-secondary">
        {card.noMappedAsset
          ? <Trans>The scope maps no asset, so this scenario's simulations are set aside.</Trans>
          : <Trans>This scenario has not been simulated yet.</Trans>}
      </Text>
      <Link
        to={SCENARIO_CRQ_ROUTE}
        params={(prev) => ({ ...prev, tenantId: prev.tenantId ?? '', organizationId: card.organizationId, riskScenarioId: card.scenarioId })}
        className="font-content-compact text-content-compact text-filigran-brand-primary hover:underline"
      >
        {t`Go to CRQ`}
      </Link>
    </div>
  </Card>
);

interface RiskTreatmentScenarioCardProps {
  card: RiskTreatmentCardData,
  today: string,
}

export const RiskTreatmentScenarioCard: FunctionComponent<RiskTreatmentScenarioCardProps> = ({ card, today }) => {
  const titleId = useId();
  const paint = tileTonePaint('brand');
  const span = scenarioTrendWindow(today, AGGREGATE_RISK_WINDOW_DAYS);
  const axis = { start: formatTrendMonth(span.start), end: formatTrendMonth(span.end) };
  const { ref, seen } = useSeenOnce(SERIES_PRELOAD_MARGIN);
  const { data: history, isPending } = useRiskTreatmentSeries(card.scenarioId, seen && card.simulated);
  const series = history?.series ?? [];
  const windowStart = history?.windowStart ?? today;
  const likelihood = readScenarioTrend(series, 'likelihood', today, AGGREGATE_RISK_WINDOW_DAYS);
  const annualLossExposure = readScenarioTrend(series, 'aleMean', today, AGGREGATE_RISK_WINDOW_DAYS);
  const { currentBand } = likelihood;
  const ale = card.aleMean === null ? null : formatDollar(card.aleMean);

  return (
    <Paper as="section" elevation={1} aria-labelledby={titleId} className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--fds-radius-sm)]"
          style={{ background: paint.fill, color: paint.glyph }}
        >
          <ShieldAlert className="h-5 w-5" />
        </span>
        <Text variant="title-md" as="h2" id={titleId} className="min-w-0">
          <Link
            to={SCENARIO_ROUTE}
            params={(prev) => ({ ...prev, tenantId: prev.tenantId ?? '', organizationId: card.organizationId, riskScenarioId: card.scenarioId })}
            className="hover:underline"
          >
            {card.name}
          </Link>
        </Text>
        <Chip label={card.attackOutcomeName} />
        <span className="grow" />
        <Text as="span" variant="content-compact" className="text-default-secondary">
          {ale === null
            ? <Trans>Annual loss exposure <EmptyValue /></Trans>
            : <Trans>Annual loss exposure <span className="font-semibold text-default-primary tabular-nums">{ale}</span></Trans>}
        </Text>
      </div>
      {!card.simulated
        ? <NotSimulated card={card} />
        : (
          <>
            <div ref={ref} className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[repeat(2,minmax(0,1fr))]">
              <TrendCard
                label={t`Likelihood`}
                info={(
                  <MetricInfo
                    title={t`Likelihood`}
                    what={<Trans>The probability of at least one loss event in the year.</Trans>}
                    how={<Trans>The share of the simulated years holding at least one loss event, read from each day's latest simulation. The band runs from 1 − e^−LEF at the loss event frequency's P10 to the same at its P90.</Trans>}
                  />
                )}
                reading={likelihood}
                loading={isPending}
                axis={axis}
                windowStart={windowStart}
                formatValue={formatWholePercent}
                formatChange={formatPointsChange}
                footer={currentBand !== null && (
                  <Text as="p" variant="content-compact" className="text-default-secondary">
                    {i18n._({
                      id: 'P10 to P90 band {p10} to {p90}',
                      message: 'P10 to P90 band {p10} to {p90}',
                      values: { p10: formatWholePercent(currentBand.p10), p90: formatWholePercent(currentBand.p90) },
                    })}
                  </Text>
                )}
              />
              <TrendCard
                label={t`Annual loss exposure`}
                info={(
                  <MetricInfo
                    title={t`Annual loss exposure`}
                    what={<Trans>The loss to expect on average over a year: the loss event frequency times the loss magnitude.</Trans>}
                    how={<Trans>The mean annual loss exposure of each day's latest simulation.</Trans>}
                  />
                )}
                reading={annualLossExposure}
                loading={isPending}
                axis={axis}
                windowStart={windowStart}
                formatValue={formatDollar}
                formatChange={formatDollarChange}
              />
            </div>
            <LossExceedanceCard card={card} series={history} seriesPending={isPending} today={today} />
            <ControlMovesCard card={card} />
          </>
        )}
    </Paper>
  );
};
