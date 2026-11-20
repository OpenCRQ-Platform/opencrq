import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import { Button, Paper } from '@filigran/design-system';
import { Skeleton } from '@filigran/ui';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import type { inferRouterOutputs } from '@trpc/server';
import type { ExceedanceReading } from '@app/module/client';
import type { FunctionComponent, ReactElement, ReactNode } from 'react';
import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import type { AssessedScenario } from '../budget-review-tolerance-utils';
import { CardField, MetricInfo } from '../../../components/shared';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { EmptyValue } from '../../../components/ui/empty-value';
import { cn } from '../../../utils';
import { formatDollar } from '../../../utils/format-currency';
import { formatExceedance } from '../../dashboard/components/loss-exceedance-chart';
import { OlderThanAleChip } from '../../treatment-plans/ui/plan-chips';
import { ToleranceVerdictChip } from '../../risk-tolerance';
import { formatToleranceProbability } from '../../risk-tolerance/risk-tolerance-utils';
import { hasAppliedTolerance, reviewToleranceSummary } from '../budget-review-tolerance-utils';
import { FigureStateChip } from '../ui/review-chips';
import { ReviewSection } from '../ui/review-section';
import { outsideAtReferenceLabel, probabilityAtReferenceLabel } from '../ui/tolerance-reference';
import { BudgetReviewToleranceChart } from './budget-review-tolerance-chart';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;
type ReviewTolerance = NonNullable<RouterOutputs['budgetReviews']['getBudgetReviewTolerance']>;
type ToleranceRow = AssessedScenario & { id: string };

const thresholdLabel = ({ applied }: AssessedScenario): string => {
  const amount = formatDollar(applied.tolerance.annualLoss);
  const probability = formatToleranceProbability(applied.tolerance.maxExceedanceProbability);
  return applied.source === 'scope'
    ? t`${amount}, ${probability} at most · scope`
    : t`${amount}, ${probability} at most · scenario`;
};

const emptyStateMessage = (closed: boolean): ReactNode => (closed
  ? <Trans>The scenarios were not priced against their tolerance at closing.</Trans>
  : <Trans>The scenarios are not priced against their tolerance for this review yet: re-simulate them.</Trans>);

const ReadingCell: FunctionComponent<{ reading: ExceedanceReading, outside: boolean }> = ({ reading, outside }) => (
  <span className="flex items-center gap-2 whitespace-nowrap">
    <span className="tabular-nums">{formatExceedance(reading)}</span>
    <ToleranceVerdictChip outside={outside} />
  </span>
);

interface FigureProps {
  heading: string,
  value: number,
  assessed: number,
  className?: string,
}

const Figure: FunctionComponent<FigureProps> = ({ heading, value, assessed, className }) => (
  <Paper elevation={2} padding={16}>
    <CardField title={heading}>
      <span className="flex flex-col">
        <p className={cn('txt-title font-semibold', className)}>{assessed === 0 ? <EmptyValue /> : value}</p>
        <span className="txt-sub-content text-default-secondary">{plural(assessed, { one: 'out of # scenario', other: 'out of # scenarios' })}</span>
      </span>
    </CardField>
  </Paper>
);

const FiguresGrid: FunctionComponent<{ children: ReactNode }> = ({ children }) => (
  <div className="grid grid-cols-1 gap-4 md:grid-cols-[repeat(3,minmax(0,1fr))]">{children}</div>
);

const ToleranceInfo: FunctionComponent = () => (
  <MetricInfo
    title={t`Risk tolerance`}
    what={t`Per scenario, the probability that the year's loss exceeds the scenario's tolerance amount, at the review's reference posture and with the build lines' controls set back to the fiscal year start.`}
    how={t`Both distributions come from the latest simulation that priced the review, with shared random draws. On an open review, a scenario that changed since then reads Older than the ALE until it is simulated again. The tolerance is the scenario's own, else the scope's, read now for an open review and as it stood at closing for a closed one.`}
    caveat={t`A tolerance applies to each scenario on its own, never to the sum of the scope's scenarios.`}
  />
);

const ToleranceSectionFrame: FunctionComponent<{ number: number, chip?: ReactNode, children: ReactNode }> = ({ number, chip, children }) => (
  <ReviewSection
    number={number}
    title={<Trans>Are we within our risk tolerance?</Trans>}
    adornment={(
      <span className="inline-flex items-center gap-2">
        <ToleranceInfo />
        {chip}
      </span>
    )}
    contentClassName="gap-4"
  >
    {children}
  </ReviewSection>
);

interface BudgetReviewToleranceSectionProps {
  number: number,
  /** Undefined while it loads, null once the review is gone. */
  tolerance: ReviewTolerance | null | undefined,
  closed: boolean,
  /** Offered when no scenario applies a tolerance, on an open review only. */
  onSetTolerance: (() => void) | undefined,
}

/**
 * Counts and rows only take a scenario with an applied tolerance and both readings, so the three
 * figures share one base and the table never shows a scenario the figures leave out.
 */
export const BudgetReviewToleranceSection: FunctionComponent<BudgetReviewToleranceSectionProps> = ({ number, tolerance, closed, onSetTolerance }) => {
  if (tolerance === null) {
    return null;
  }
  if (tolerance === undefined) {
    return (
      <ToleranceSectionFrame number={number}>
        <FiguresGrid>
          {Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-[84px] w-full rounded-sm" />)}
        </FiguresGrid>
        <Skeleton className="h-[120px] w-full rounded-sm" />
      </ToleranceSectionFrame>
    );
  }

  const chip = closed ? undefined : <FigureStateChip state={tolerance.state} />;
  if (!hasAppliedTolerance(tolerance.scenarios)) {
    return (
      <ToleranceSectionFrame number={number} chip={chip}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-default-secondary"><Trans>No risk tolerance is set on this scope.</Trans></p>
          {!closed && onSetTolerance !== undefined && (
            <Button type="button" priority="secondary" size="sm" onClick={onSetTolerance}>{t`Set a risk tolerance`}</Button>
          )}
        </div>
      </ToleranceSectionFrame>
    );
  }

  const { reference } = tolerance;
  const summary = reviewToleranceSummary(tolerance.scenarios);
  const rows: Array<ToleranceRow> = summary.rows.map((row, index) => ({ ...row, id: row.scenarioId ?? String(index) }));

  const columns: Array<ColumnDefWithOptionsHeader<ToleranceRow, unknown>> = [
    {
      id: 'name',
      accessorKey: 'name',
      header: t`Risk scenario`,
      size: 320,
      cell: ({ row }): ReactElement => {
        const { scenarioId, name, olderThanHeadline } = row.original;
        return (
          <span className="flex max-w-full items-center gap-2">
            {scenarioId === null
              ? <span title={name} className="min-w-0 truncate">{name}</span>
              : (
                <Link
                  from="/$tenantId/{-$organizationId}"
                  to="risk-scenarios/$riskScenarioId"
                  params={(previous) => ({ ...previous, riskScenarioId: scenarioId })}
                  title={name}
                  className="min-w-0 truncate text-primary underline-offset-4 hover:underline"
                >
                  {name}
                </Link>
              )}
            {olderThanHeadline && <span className="shrink-0"><OlderThanAleChip /></span>}
          </span>
        );
      },
    },
    {
      id: 'threshold',
      header: t`Threshold`,
      size: 230,
      cell: ({ row }): ReactElement => <span className="whitespace-nowrap tabular-nums">{thresholdLabel(row.original)}</span>,
    },
    {
      id: 'reference',
      header: probabilityAtReferenceLabel(reference),
      size: 230,
      cell: ({ row }): ReactElement => <ReadingCell reading={row.original.reference} outside={row.original.outsideAtReference} />,
    },
    {
      id: 'withoutBuild',
      header: t`Without the period's build work`,
      size: 230,
      cell: ({ row }): ReactElement => <ReadingCell reading={row.original.withoutBuild} outside={row.original.outsideWithoutBuild} />,
    },
  ];

  return (
    <ToleranceSectionFrame number={number} chip={chip}>
      <FiguresGrid>
        <Figure heading={outsideAtReferenceLabel(reference)} value={summary.outsideAtReference} assessed={summary.assessed} />
        <Figure heading={t`Outside tolerance without the period's build work`} value={summary.outsideWithoutBuild} assessed={summary.assessed} />
        <Figure
          heading={t`Brought back within tolerance by the build work`}
          value={summary.broughtBack}
          assessed={summary.assessed}
          className={summary.broughtBack > 0 ? 'text-green-600' : undefined}
        />
      </FiguresGrid>
      <Paper elevation={2} padding={8}>
        <DataPageLayout
          data={rows}
          columns={columns}
          storageKey="budgetReviewTolerance"
          hidePagination
          enableSorting={false}
          expandableRows={{
            canExpand: (row) => row.chart !== null,
            toggleLabel: (row) => {
              const { name } = row;
              return t`Show the loss exceedance curve of ${name}`;
            },
            render: (row) => row.chart !== null && (
              <div className="mb-3 ml-16 rounded-[var(--fds-radius-sm)] bg-[var(--fds-bg-elevation-default-layer-0-transparency-70)] px-4 py-3">
                <BudgetReviewToleranceChart model={row.chart} reference={reference} />
              </div>
            ),
          }}
          emptyState={(
            <p className="txt-sub-content text-default-secondary">
              {emptyStateMessage(closed)}
            </p>
          )}
        />
      </Paper>
    </ToleranceSectionFrame>
  );
};
