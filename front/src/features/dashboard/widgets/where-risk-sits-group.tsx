import { Card, CardHeader, CardTitle, Chip, Text } from '@filigran/design-system';
import { DataTable, Skeleton } from '@filigran/ui';
import type { ColumnDefWithOptionsHeader } from '@filigran/ui';
import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Link, useNavigate } from '@tanstack/react-router';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import type { inferRouterOutputs } from '@trpc/server';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent, ReactElement, ReactNode } from 'react';
import type { TopRisksNode, TopRisksScenarioInput } from '../top-risks-flow-utils';
import { DashboardGroup, MetricInfo } from '../../../components/shared';
import { getDataTableI18nKey } from '../../../components/ui/data-table-i18n';
import { useTRPC } from '../../../lib';
import { computePert, formatDollar } from '../../../utils';
import { TopRisksSankey } from '../components/top-risks-sankey';
import { formatTenthsOfPointsChange } from '../components/trend-change-chip';
import { PERFORMERS_WINDOW_DAYS, selectBestLikelihoodMovers, selectWorstLikelihoodMovers } from '../dashboard-utils';
import { buildTopRisksFlow } from '../top-risks-flow-utils';
import { RiskiestRiskScopes } from './riskiest-risk-scopes';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;
type ScenarioSummary = RouterOutputs['dashboard']['getScenarioSummaries'][number];

const nameLinkClassName = 'text-default-primary hover:underline focus-visible:underline';

const TopRisksCard: FunctionComponent<{ organizationId?: string }> = ({ organizationId }) => {
  const trpc = useTRPC();
  const { data } = useQuery(trpc.dashboard.getExposureFlow.queryOptions({ organizationId }));

  const scenarios: Array<TopRisksScenarioInput> = (data?.scenarios ?? []).map((scenario) => ({
    scenarioId: scenario.scenarioId,
    name: scenario.name,
    organizationId: scenario.organizationId,
    outcomeId: scenario.outcomeId,
    outcomeName: scenario.outcomeName,
    ale: scenario.ale,
    aleP10: scenario.aleP10,
    aleP90: scenario.aleP90,
    lefMean: scenario.lefMean,
    primaryAssets: scenario.primaryAssets,
    categoryExpectations: scenario.driverExpectations.map((driver) => ({
      categoryId: driver.lossCategoryId,
      categoryName: driver.lossCategoryName,
      expected: computePert(driver.minValue, driver.likelyValue, driver.maxValue),
    })),
  }));
  const flow = buildTopRisksFlow(scenarios);
  const simulatedCount = (data?.scenarios.length ?? 0) + (data?.unpricedScenarios.length ?? 0);

  const assetScopes = new Map(scenarios.flatMap((scenario) =>
    scenario.primaryAssets.map((asset) => [asset.id, scenario.organizationId] as const)));

  const renderName = (node: TopRisksNode, name: string): ReactNode => {
    if (node.entityId === null) {
      return name;
    }
    const entityId = node.entityId;
    if (node.column === 'scenario') {
      const scopeId = flow.scenarios.get(entityId)?.organizationId;
      return (
        <Link
          to="/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId"
          params={(prev) => ({ ...prev, tenantId: prev.tenantId ?? '', organizationId: scopeId, riskScenarioId: entityId })}
          className={nameLinkClassName}
        >
          {name}
        </Link>
      );
    }
    if (node.column === 'asset') {
      const scopeId = assetScopes.get(entityId);
      return (
        <Link
          to="/$tenantId/{-$organizationId}/primary-assets/$primaryAssetId"
          params={(prev) => ({ ...prev, tenantId: prev.tenantId ?? '', organizationId: scopeId, primaryAssetId: entityId })}
          className={nameLinkClassName}
        >
          {name}
        </Link>
      );
    }
    return name;
  };

  const total = formatDollar(flow.total);

  return (
    <Card elevation={2} gap={16}>
      <CardHeader
        action={(
          <span className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
            {data !== undefined && (
              <Chip
                label={i18n._({
                  id: '{simulatedCount, plural, one {# simulated scenario} other {# simulated scenarios}}',
                  message: '{simulatedCount, plural, one {# simulated scenario} other {# simulated scenarios}}',
                  values: { simulatedCount },
                })}
              />
            )}
            {flow.total > 0 && (
              <span className="font-content-compact text-content-compact text-default-secondary">
                <Trans>Annual loss exposure <span className="font-medium tabular-nums text-default-primary">{total}</span></Trans>
              </span>
            )}
            <Link
              to="/$tenantId/{-$organizationId}/risk-scenarios"
              params={(prev) => ({ ...prev, tenantId: prev.tenantId ?? '' })}
              className="font-content-compact text-content-compact text-filigran-brand-primary hover:underline"
            >
              {t`See all scenarios`}
            </Link>
          </span>
        )}
      >
        <CardTitle
          as="h3"
          endAdornment={(
            <MetricInfo
              title={t`Top risks`}
              what={<Trans>Where the annual loss exposure sits: on which primary assets, through which risk scenarios, attack outcomes and loss categories.</Trans>}
              how={(
                <Trans>
                  Every column splits the same total, the mean annual loss exposure of each scenario's latest simulation.
                  The six largest primary assets and scenarios are shown, the rest folded into one node.
                </Trans>
              )}
              caveat={(
                <Trans>
                  The engine prices a scenario as a whole. A scenario aimed at several primary assets is split between them
                  in equal parts, and across loss categories in proportion to the expected value of its loss estimates: both
                  splits are attributions, not simulated figures.
                </Trans>
              )}
            />
          )}
        >
          {t`Top risks`}
        </CardTitle>
      </CardHeader>
      {data === undefined && <Skeleton className="h-[468px] w-full" />}
      {data !== undefined && flow.total <= 0 && (
        <Text as="p" variant="content-base" className="text-default-secondary">
          <Trans>No simulated scenario carries an annual loss exposure yet.</Trans>
        </Text>
      )}
      {data !== undefined && flow.total > 0 && <TopRisksSankey flow={flow} renderName={renderName} />}
    </Card>
  );
};

type Mover = ScenarioSummary & { likelihoodChange: number };

const LikelihoodChangeChip: FunctionComponent<{ change: number }> = ({ change }) => {
  const Arrow = change > 0 ? ArrowUp : ArrowDown;
  return (
    <Chip
      label={formatTenthsOfPointsChange(change)}
      severity={change > 0 ? 'critical' : 'low'}
      startIcon={<Arrow className="h-4 w-4" />}
      className="tabular-nums"
    />
  );
};

const PerformersCard: FunctionComponent<{
  title: string,
  info: ReactNode,
  movers: Array<Mover> | undefined,
  emptyText: string,
}> = ({ title, info, movers, emptyText }) => {
  const navigate = useNavigate();

  const columns: Array<ColumnDefWithOptionsHeader<Mover, unknown>> = [
    {
      id: 'name',
      header: t`Risk scenario`,
      size: 320,
      enableSorting: false,
      cell: ({ row }): ReactElement => <span className="block truncate font-medium">{row.original.name}</span>,
    },
    {
      id: 'likelihood',
      header: t`Likelihood`,
      size: 120,
      enableSorting: false,
      cell: ({ row }): ReactElement => <LikelihoodChangeChip change={row.original.likelihoodChange} />,
    },
  ];

  return (
    <Card elevation={2} gap={8}>
      <CardHeader>
        <CardTitle as="h3" endAdornment={info}>{title}</CardTitle>
      </CardHeader>
      {movers !== undefined && movers.length === 0
        ? <Text as="p" variant="content-base" className="text-default-secondary">{emptyText}</Text>
        : (
          <div className="scrollbar-discreet overflow-auto [&_.twp]:mt-0 [&_th]:pl-2 [&_td]:px-2">
            <DataTable
              i18nKey={getDataTableI18nKey()}
              data={movers ?? []}
              columns={columns}
              toolbar={<></>}
              isLoading={movers === undefined}
              onClickRow={(row) => {
                void navigate({
                  to: '/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId',
                  params: (prev) => ({ tenantId: prev.tenantId!, organizationId: row.original.organizationId, riskScenarioId: row.original.id }),
                });
              }}
            />
          </div>
        )}
    </Card>
  );
};

const toMovers = (summaries: Array<ScenarioSummary>): Array<Mover> =>
  summaries.flatMap((summary) => {
    const change = summary.likelihoodChange;
    return change === null ? [] : [{ ...summary, likelihoodChange: change }];
  });

const PerformersCards: FunctionComponent<{ organizationId?: string }> = ({ organizationId }) => {
  const trpc = useTRPC();
  const { data } = useQuery(trpc.dashboard.getScenarioSummaries.queryOptions({ organizationId, windowDays: PERFORMERS_WINDOW_DAYS }));

  const how = (
    <Trans>
      A scenario's likelihood, 1 − e^−LEF, from its latest simulation against its last simulation before the month.
      A scenario first simulated within the month has nothing to compare with and is left out.
    </Trans>
  );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[repeat(2,minmax(0,1fr))]">
      <PerformersCard
        title={t`Worst performing risk scenarios`}
        info={(
          <MetricInfo
            title={t`Worst performing risk scenarios`}
            what={<Trans>The three scenarios whose likelihood rose most over the last month, in points.</Trans>}
            how={how}
          />
        )}
        movers={data === undefined ? undefined : toMovers(selectWorstLikelihoodMovers(data))}
        emptyText={t`No scenario's likelihood rose over the last month.`}
      />
      <PerformersCard
        title={t`Best performing risk scenarios`}
        info={(
          <MetricInfo
            title={t`Best performing risk scenarios`}
            what={<Trans>The three scenarios whose likelihood fell most over the last month, in points.</Trans>}
            how={how}
          />
        )}
        movers={data === undefined ? undefined : toMovers(selectBestLikelihoodMovers(data))}
        emptyText={t`No scenario's likelihood fell over the last month.`}
      />
    </div>
  );
};

interface WhereRiskSitsGroupProps {
  organizationId?: string,
}

export const WhereRiskSitsGroup: FunctionComponent<WhereRiskSitsGroupProps> = ({ organizationId }) => (
  <DashboardGroup icon="map-pin" title={t`Where the risk sits`}>
    {organizationId === undefined && <RiskiestRiskScopes />}
    <TopRisksCard organizationId={organizationId} />
    <PerformersCards organizationId={organizationId} />
  </DashboardGroup>
);
