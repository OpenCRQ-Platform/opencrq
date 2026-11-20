import { Chip } from '@filigran/design-system';
import { DataTable } from '@filigran/ui';
import type { ColumnDefWithOptionsHeader } from '@filigran/ui';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent, ReactElement } from 'react';
import { MetricInfo } from '../../../components/shared';
import { EmptyValue } from '../../../components/ui/empty-value';
import { ScenarioAleChangeCell, ScenarioBand } from '../../risk-scenarios/components/list';
import { useTRPC } from '../../../lib';
import { formatDate, formatDollar, formatFixed } from '../../../utils';
import { sortSummariesByAle } from '../dashboard-utils';
import { Panel } from '../components/slick-primitives';
import { getDataTableI18nKey } from '../../../components/ui/data-table-i18n';

const formatLef = (value: number) => {
  const formatted = formatFixed(value, 2);
  return t`${formatted} / y`;
};

interface ScenariosTableWidgetProps {
  organizationId?: string,
}

export const ScenariosTableWidget: FunctionComponent<ScenariosTableWidgetProps> = ({ organizationId }) => {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const { data } = useQuery(trpc.dashboard.getScenarioSummaries.queryOptions({ organizationId }));
  // The run is dropped whole rather than guarded cell by cell: the ALE, the LEF, the trend and the
  // last-run date are all drawn from it, and a retired estate answers for none of them.
  const summaries = sortSummariesByAle(data ?? [])
    .map((summary) => (summary.noMappedAsset ? { ...summary, latestRun: null, trend: null } : summary));
  type Row = (typeof summaries)[number];
  const showOrganization = organizationId === undefined;

  const organizationColumn: Array<ColumnDefWithOptionsHeader<Row, unknown>> = showOrganization
    ? [{
      id: 'organization',
      header: t`Risk scope`,
      size: 150,
      cell: ({ row }): ReactElement => (
        <span>{row.original.organizationName ?? <EmptyValue />}</span>
      ),
    }]
    : [];

  const columns: Array<ColumnDefWithOptionsHeader<Row, unknown>> = [
    {
      id: 'name',
      header: t`Name`,
      size: 250,
      cell: ({ row }): ReactElement => (
        <span className="font-medium">
          {row.original.name}
        </span>
      ),
    },
    ...organizationColumn,
    {
      id: 'outcome',
      header: t`Outcome`,
      size: 150,
      cell: ({ row }): ReactElement => (
        <Chip className="whitespace-nowrap" label={row.original.attackOutcomeName} />
      ),
    },
    {
      id: 'ale',
      header: t`Annual Loss Exposure`,
      size: 170,
      cell: ({ row }): ReactElement => (
        <span className="flex flex-col">
          <span className="font-medium">{formatDollar(row.original.latestRun?.aleMean ?? null)}</span>
          {row.original.latestRun?.aleMean != null && (
            <ScenarioBand p10={row.original.latestRun.aleP10} p90={row.original.latestRun.aleP90} format={formatDollar} />
          )}
        </span>
      ),
    },
    {
      id: 'lef',
      header: t`Loss Event Frequency`,
      size: 150,
      cell: ({ row }): ReactElement => (
        <span className="whitespace-nowrap">
          {row.original.latestRun?.lefMean != null ? formatLef(row.original.latestRun.lefMean) : <EmptyValue />}
        </span>
      ),
    },
    {
      id: 'trend',
      header: t`Trend (90 days)`,
      size: 160,
      cell: ({ row }): ReactElement => (
        <ScenarioAleChangeCell hasRun={row.original.latestRun !== null} change={row.original.trend} />
      ),
    },
    {
      id: 'lastRun',
      header: t`Last simulation`,
      size: 130,
      cell: ({ row }): ReactElement => (
        <span className="whitespace-nowrap">
          {row.original.latestRun ? formatDate(row.original.latestRun.createdAt) : <EmptyValue />}
        </span>
      ),
    },
  ];

  return (
    <Panel
      title={<Trans>Risk scenarios</Trans>}
      info={
        <MetricInfo
          title={t`Risk scenarios`}
          what={<Trans>Every scenario in scope, heaviest first, with the figures its latest simulation produced.</Trans>}
          how={
            <Trans>
              One row per scenario, ordered by annual loss exposure. Each figure is the mean of the
              simulated years, with the p10 to p90 band below it: eight simulated years in ten fall
              inside it. LEF is the expected loss events per year and SLE the loss per event, so
              ALE = LEF × SLE. The trend compares the latest
              run against the one that opened the 90-day window; a scenario with no earlier run is
              marked New rather than shown as no change. Select a row to open the scenario.
            </Trans>
          }
          caveat={
            <Trans>
              A dash means the scenario carries no current figure, not that its exposure is zero:
              either it has never been simulated, or its risk scope is measured over the assets
              mapped into it and now maps none, which retires the figures on file. Either way it is
              unmeasured, and it contributes nothing to any total on this page.
            </Trans>
          }
        />
      }
    >
      <div className="scrollbar-discreet max-h-[410px] overflow-auto [&_.twp]:mt-0 [&_th]:pl-2 [&_td]:px-2">
        <DataTable
          i18nKey={getDataTableI18nKey()}
          data={summaries}
          columns={columns}
          toolbar={<></>}
          isLoading={data === undefined}
          onClickRow={(row) => {
            void navigate({
              to: '/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId',
              params: (prev) => ({
                tenantId: prev.tenantId!,
                riskScenarioId: row.original.id,
              }),
            });
          }}
        />
      </div>
    </Panel>
  );
};
