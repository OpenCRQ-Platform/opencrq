import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import { Button } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useNavigate } from '@tanstack/react-router';
import type { inferRouterOutputs } from '@trpc/server';
import { RefreshCw } from 'lucide-react';
import type { FunctionComponent, ReactElement } from 'react';
import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import type { ResimulationControl } from '../treatment-plan-utils';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { EmptyValue } from '../../../components/ui/empty-value';
import { SectionCard } from '../../../components/shared';
import { cn, formatDateTime, formatFractionAsPercent } from '../../../utils';
import { formatDollar } from '../../../utils/format-currency';
import { AleReductionWithSpread } from '../ui/ale-reduction';
import { ExpiredChip, OlderThanAleChip } from '../ui/plan-chips';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;
type PlanProjection = NonNullable<RouterOutputs['treatmentPlans']['getTreatmentPlanProjection']>;
type PlanScenario = PlanProjection['scenarios'][number];
type ScenarioRow = PlanScenario & { id: string };

const hasFigures = (scenario: PlanScenario): boolean =>
  scenario.state === 'priced' || scenario.state === 'expired';

/** No figure to show, which a dash would leave the reader to read as a zero. */
const NotComputed: FunctionComponent = () => (
  <span className="txt-table font-normal text-default-secondary"><Trans>Not computed</Trans></span>
);

/** What share of the scenario's own exposure the saving is, which the amounts beside it do not state. */
const ReductionShare: FunctionComponent<{ scenario: PlanScenario }> = ({ scenario }) => {
  const { aleMean, aleReductionMean } = scenario;
  if (!hasFigures(scenario) || aleMean === null || aleMean <= 0 || aleReductionMean === null) {
    return null;
  }
  const share = formatFractionAsPercent(Math.abs(aleReductionMean) / aleMean, 1);
  return <span className="txt-sub-content whitespace-nowrap text-default-secondary">{`(${share})`}</span>;
};

interface TreatmentPlanScenariosCardProps {
  projection: PlanProjection,
  resimulation: ResimulationControl,
  onResimulate: () => void,
}

export const TreatmentPlanScenariosCard: FunctionComponent<TreatmentPlanScenariosCardProps> = ({ projection, resimulation, onResimulate }) => {
  const navigate = useNavigate();

  const rows: Array<ScenarioRow> = projection.scenarios.map((scenario) => ({ ...scenario, id: scenario.riskScenarioId }));

  const columns: Array<ColumnDefWithOptionsHeader<ScenarioRow, unknown>> = [
    {
      id: 'name',
      accessorKey: 'name',
      header: t`Scenario`,
      size: 320,
      cell: ({ row }): ReactElement => (
        <span className="flex flex-col">
          <span className={cn('truncate', !hasFigures(row.original) && 'text-default-secondary')}>
            {row.original.name}
          </span>
          {row.original.readinessStatus === 'ready' && row.original.state === 'not-priced' && (
            <span className="txt-sub-content text-default-secondary">
              <Trans>Not simulated since the plan last changed.</Trans>
            </span>
          )}
        </span>
      ),
    },
    {
      id: 'ale',
      header: t`ALE`,
      size: 220,
      accessorFn: (row) => row.aleMean ?? undefined,
      sortUndefined: 'last',
      cell: ({ row }): ReactElement => (
        <span className="txt-default font-semibold whitespace-nowrap">
          {row.original.aleMean === null || row.original.aleTargetMean === null
            ? <NotComputed />
            : (
              <>
                {formatDollar(row.original.aleMean)}
                <span aria-hidden="true" className="px-1 font-normal text-default-secondary">&rarr;</span>
                {formatDollar(row.original.aleTargetMean)}
              </>
            )}
        </span>
      ),
    },
    {
      id: 'aleReduction',
      header: t`ALE reduction`,
      size: 200,
      accessorFn: (row) => (hasFigures(row) ? row.aleReductionMean ?? undefined : undefined),
      sortUndefined: 'last',
      sortDescFirst: true,
      cell: ({ row }): ReactElement => {
        if (!hasFigures(row.original)) {
          return <NotComputed />;
        }
        return (
          <span className="flex items-center gap-1">
            <AleReductionWithSpread
              value={row.original.aleReductionMean}
              p10={row.original.aleReductionP10}
              p90={row.original.aleReductionP90}
              className="txt-default font-semibold"
            />
            <ReductionShare scenario={row.original} />
          </span>
        );
      },
    },
    {
      id: 'runCreatedAt',
      header: t`Last simulation`,
      size: 280,
      accessorFn: (row) => row.runCreatedAt ?? undefined,
      sortUndefined: 'last',
      cell: ({ row }): ReactElement => (
        <span className="flex items-center gap-2 whitespace-nowrap">
          {row.original.runCreatedAt === null ? <EmptyValue /> : formatDateTime(row.original.runCreatedAt)}
          {row.original.state === 'expired' && <ExpiredChip />}
          {row.original.state === 'priced' && row.original.olderThanHeadline && <OlderThanAleChip />}
        </span>
      ),
    },
  ];

  return (
    <SectionCard
      title={t`Per scenario`}
      headerAction={resimulation === 'hidden' ? undefined : (
        <Button
          priority="tertiary"
          size="sm"
          startIcon={<RefreshCw className="size-3" />}
          loading={resimulation === 'running'}
          onClick={onResimulate}
        >
          <Trans>Re-simulate scenarios</Trans>
        </Button>
      )}
    >
      <DataPageLayout
        data={rows}
        columns={columns}
        storageKey="treatmentPlanScenarios"
        hideToolbar
        initialSorting={[{ id: 'aleReduction', desc: true }]}
        onClickRow={(row) => void navigate({
          from: '/$tenantId/{-$organizationId}',
          to: 'risk-scenarios/$riskScenarioId',
          params: { riskScenarioId: row.original.riskScenarioId },
        })}
        emptyState={(
          <p className="txt-sub-content text-default-secondary">
            <Trans>This risk scope holds no scenario to read the plan against.</Trans>
          </p>
        )}
      />
    </SectionCard>
  );
};
