import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import { Paper, Text } from '@filigran/design-system';
import { Skeleton } from '@filigran/ui';
import { plural, t } from '@lingui/core/macro';
import { Plural, Trans } from '@lingui/react/macro';
import type { inferRouterOutputs } from '@trpc/server';
import type { FunctionComponent, ReactNode } from 'react';
import type { BriefClauses } from '../budget-review-brief-utils';
import type { BudgetLineNature } from '../budget-review-utils';
import { SectionCard } from '../../../components/shared';
import { EmptyValue } from '../../../components/ui/empty-value';
import { cn, formatDate } from '../../../utils';
import { formatDollar } from '../../../utils/format-currency';
import { AleReduction } from '../../treatment-plans/ui/ale-reduction';
import { briefClauses, spentByNature, toleranceFigure } from '../budget-review-brief-utils';
import { reviewToleranceSummary } from '../budget-review-tolerance-utils';
import { figureOf, lineCountByNature } from '../budget-review-utils';
import { OverallInfo } from '../ui/figure-info';
import { FigureStateChip } from '../ui/review-chips';
import { outsideAtReferenceLabel } from '../ui/tolerance-reference';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;
type ReviewFigures = NonNullable<RouterOutputs['budgetReviews']['getBudgetReviewFigures']>;
type ReviewTolerance = NonNullable<RouterOutputs['budgetReviews']['getBudgetReviewTolerance']>;

interface SentenceProps {
  clauses: BriefClauses,
  periodFrom: string,
  periodTo: string,
  scopeName: string,
  spent: string,
  buildSpent: string,
  /** The build work's loss avoided, unsigned: the clause carries its direction. */
  buildLoss: string,
  broughtBack: number,
  assessed: number,
}

const BuildSentence: FunctionComponent<SentenceProps> = ({ clauses, buildSpent, buildLoss, broughtBack, assessed }) => {
  switch (clauses.build) {
    case 'none': return null;
    case 'unpriced': return <Trans>The build work cost <strong>{buildSpent}</strong>. What it removes awaits a new simulation.</Trans>;
    case 'unchanged': return <Trans>The build work, <strong>{buildSpent}</strong>, leaves the annual loss unchanged.</Trans>;
    case 'raises': return <Trans>The build work, <strong>{buildSpent}</strong>, raises the annual loss by <strong className="text-red">{buildLoss}</strong>.</Trans>;
    case 'removes': return clauses.tolerance
      ? (
        <Trans>
          The build work, <strong>{buildSpent}</strong>, removes <strong className="text-green-600">{buildLoss}</strong> of annual loss and
          brings <strong>{broughtBack} of <Plural value={assessed} one="# scenario" other="# scenarios" /></strong> back within{' '}
          <Plural value={assessed} one="its" other="their" /> risk tolerance.
        </Trans>
      )
      : <Trans>The build work, <strong>{buildSpent}</strong>, removes <strong className="text-green-600">{buildLoss}</strong> of annual loss.</Trans>;
  }
};

const BriefSentence: FunctionComponent<SentenceProps> = (props) => {
  const { clauses, periodFrom, periodTo, scopeName, spent } = props;
  return (
    <p className="txt-subtitle2">
      {clauses.spent
        ? <Trans>From {periodFrom} to {periodTo}, {scopeName} spent <strong>{spent}</strong>.</Trans>
        : <Trans>No budget line is entered for this fiscal year yet.</Trans>}
      {clauses.build !== 'none' && ' '}
      <BuildSentence {...props} />
    </p>
  );
};

const BriefFigure: FunctionComponent<{ label: ReactNode, value: ReactNode, sub?: ReactNode }> = ({ label, value, sub }) => (
  <Paper elevation={2} padding={16} className="flex min-w-0 flex-col gap-1">
    <span className="flex items-center gap-1.5 txt-sub-content text-default-secondary">{label}</span>
    <Text variant="title-xl" as="div" className="flex items-baseline gap-2">{value}</Text>
    {sub !== undefined && <span className="txt-sub-content text-default-secondary">{sub}</span>}
  </Paper>
);

/** The arrow beside an amount, in pixels, sized to the type it stands in: the figure, and the line under it. */
const FIGURE_ARROW_SIZE = 24;
const SUB_ARROW_SIZE = 12;

interface OutsideToleranceFigureProps {
  tolerance: ReviewTolerance | null | undefined,
  closed: boolean,
  hasBuildLine: boolean,
}

const OutsideToleranceFigure: FunctionComponent<OutsideToleranceFigureProps> = ({ tolerance, closed, hasBuildLine }) => {
  const chip = tolerance === null || tolerance === undefined || closed ? null : <FigureStateChip state={tolerance.state} />;
  const label = <>{tolerance === null || tolerance === undefined ? t`Outside tolerance` : outsideAtReferenceLabel(tolerance.reference)}{chip}</>;
  if (tolerance === undefined) {
    return <BriefFigure label={label} value={<Skeleton className="h-8 w-24 rounded-sm" />} />;
  }
  const figure = tolerance === null ? 'not-assessed' : toleranceFigure(tolerance.scenarios);
  if (tolerance === null || figure === 'not-assessed') {
    return <BriefFigure label={label} value={<EmptyValue />} />;
  }
  if (figure === 'no-tolerance') {
    return <BriefFigure label={label} value={<span className="txt-body2 text-default-secondary"><Trans>No risk tolerance is set on this scope.</Trans></span>} />;
  }
  const { outsideAtReference: outside, outsideWithoutBuild, assessed } = reviewToleranceSummary(tolerance.scenarios);
  return (
    <BriefFigure
      label={label}
      value={(
        <Trans>
          <span className={cn(tolerance.state === 'expired' && 'text-default-secondary')}>{outside}</span>{' '}
          <span className="txt-body2 text-default-secondary">of <Plural value={assessed} one="# scenario" other="# scenarios" /></span>
        </Trans>
      )}
      sub={hasBuildLine ? t`${outsideWithoutBuild} without the period's build work` : undefined}
    />
  );
};

interface BriefReview {
  periodStart: string,
  periodEnd: string,
  status: 'open' | 'closed',
  organization: { name: string | null },
  lines: ReadonlyArray<{ nature: BudgetLineNature, amountSpent: number }>,
}

interface BudgetReviewBriefCardProps {
  review: BriefReview,
  /** Undefined while they load. */
  figures: ReviewFigures | undefined,
  /** Undefined while it loads, null once the review is gone. */
  tolerance: ReviewTolerance | null | undefined,
}

/**
 * The review in one sentence and three figures. The sentence states only priced amounts: a build
 * figure out of date drops its amount, and the tolerance claim with it.
 */
export const BudgetReviewBriefCard: FunctionComponent<BudgetReviewBriefCardProps> = ({ review, figures, tolerance }) => {
  const closed = review.status === 'closed';
  const counts = lineCountByNature(review.lines);
  const spent = spentByNature(review.lines);
  const build = figures === undefined ? undefined : figureOf(figures.figures, 'build');
  const ensemble = figures === undefined ? undefined : figureOf(figures.figures, 'ensemble');
  const summary = tolerance === null || tolerance === undefined ? null : reviewToleranceSummary(tolerance.scenarios);
  const clauses = briefClauses({
    lineCount: review.lines.length,
    buildLineCount: counts.build,
    build,
    tolerance: tolerance === null || tolerance === undefined || summary === null
      ? undefined
      : { figure: toleranceFigure(tolerance.scenarios), state: tolerance.state, broughtBack: summary.broughtBack },
  });
  const buildSpent = formatDollar(spent.build);
  const runSpent = formatDollar(spent.run);
  const bothNatures = counts.build > 0 && counts.run > 0;

  return (
    <SectionCard titleVariant="inside" title={<Trans>In brief</Trans>} className="h-full" cardClassName="h-full" contentClassName="gap-5">
      <BriefSentence
        clauses={clauses}
        periodFrom={formatDate(review.periodStart)}
        periodTo={formatDate(review.periodEnd)}
        scopeName={review.organization.name ?? t`the scope`}
        spent={formatDollar(spent.total)}
        buildSpent={buildSpent}
        buildLoss={formatDollar(Math.abs(build?.aleReductionMean ?? 0))}
        broughtBack={summary?.broughtBack ?? 0}
        assessed={summary?.assessed ?? 0}
      />
      <div className="grid grid-cols-[repeat(3,minmax(0,1fr))] gap-4">
        <BriefFigure
          label={t`Spent`}
          value={formatDollar(spent.total)}
          sub={bothNatures
            ? t`of which ${buildSpent} build, ${runSpent} run`
            : plural(review.lines.length, { one: '# line', other: '# lines' })}
        />
        <BriefFigure
          label={<>{t`Loss avoided per year`}<OverallInfo />{ensemble !== undefined && !closed && <FigureStateChip state={ensemble.state} />}</>}
          value={figures === undefined
            ? <Skeleton className="h-8 w-24 rounded-sm" />
            : <AleReduction value={ensemble?.aleReductionMean ?? null} expired={ensemble?.state === 'expired'} iconSize={FIGURE_ARROW_SIZE} />}
          sub={counts.build > 0 && build !== undefined && build.aleReductionMean !== null
            ? <Trans>of which <AleReduction value={build.aleReductionMean} expired={build.state === 'expired'} iconSize={SUB_ARROW_SIZE} /> by the build work</Trans>
            : undefined}
        />
        <OutsideToleranceFigure tolerance={tolerance} closed={closed} hasBuildLine={counts.build > 0} />
      </div>
    </SectionCard>
  );
};
