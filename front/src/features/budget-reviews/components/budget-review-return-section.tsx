import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import { Button, Chip, Paper, Text } from '@filigran/design-system';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { inferRouterOutputs } from '@trpc/server';
import { RefreshCw } from 'lucide-react';
import type { FunctionComponent, ReactNode } from 'react';
import type { ResimulationControl } from '../../treatment-plans/treatment-plan-utils';
import type { BudgetLineNature } from '../budget-review-utils';
import { cn } from '../../../utils';
import { formatDollar } from '../../../utils/format-currency';
import { formatReturnPercent } from '../../treatment-plans/treatment-plan-utils';
import { AleReduction } from '../../treatment-plans/ui/ale-reduction';
import { PlanReturn } from '../../treatment-plans/ui/plan-return';
import { spentByNature } from '../budget-review-brief-utils';
import { figureOf, isAmortized, lineCountByNature, prudentReturnPercent } from '../budget-review-utils';
import { NatureInfo, OverallInfo } from '../ui/figure-info';
import { LossAvoidedSpread } from '../ui/loss-avoided-spread';
import { FigureStateChip, LineNatureChip } from '../ui/review-chips';
import { ReviewSection } from '../ui/review-section';
import { amortizedReturnLabel } from '../ui/amortized-return';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;
type ReviewFigures = NonNullable<RouterOutputs['budgetReviews']['getBudgetReviewFigures']>;
type ReviewFigure = ReviewFigures['figures'][number];

/**
 * Spent, loss avoided and return, each after an arrow column, read left to right as they are computed.
 * Below 48rem the row's heading takes a line of its own above its three figures.
 */
const GridRow: FunctionComponent<{ className?: string, children: ReactNode }> = ({ className, children }) => (
  <div
    role="row"
    className={cn(
      'grid grid-cols-[minmax(0,1fr)_1.5rem_minmax(0,1fr)_1.5rem_minmax(0,1fr)] items-start gap-y-2',
      '@[48rem]:grid-cols-[minmax(0,13rem)_2.5rem_minmax(0,1fr)_2.5rem_minmax(0,1fr)_2.5rem_minmax(0,1fr)] @[48rem]:gap-y-0',
      className,
    )}
  >
    {children}
  </div>
);

const Spacer: FunctionComponent<{ className?: string, children?: ReactNode }> = ({ className, children }) => (
  <span aria-hidden="true" className={cn('text-center', className)}>{children}</span>
);

const HeadingSpacer: FunctionComponent = () => <Spacer className="@max-[48rem]:hidden" />;

type RowWeight = 'lead' | 'second' | 'muted';

/** The arrow of a loss avoided, in pixels, for the type size each row sets its figures in. */
const ARROW_SIZE: Record<RowWeight, number> = { lead: 24, second: 18, muted: 14 };

const Value: FunctionComponent<{ weight: RowWeight, emphasis?: boolean, children: ReactNode }> = ({ weight, emphasis, children }) => {
  if (weight === 'muted') {
    return <span className="txt-subtitle text-default-secondary">{children}</span>;
  }
  const variant = weight === 'lead' ? (emphasis === true ? 'title-2xl' : 'title-xl') : 'title-md';
  return <Text variant={variant} as="span" className="block">{children}</Text>;
};

const Sub: FunctionComponent<{ children: ReactNode }> = ({ children }) => (
  <span className="txt-sub-content text-default-secondary">{children}</span>
);

const spentSub = (figure: ReviewFigure | undefined, lineCount: number): string => {
  if (figure === undefined || !isAmortized(figure)) {
    return plural(lineCount, { one: '# line', other: '# lines' });
  }
  const annual = formatDollar(figure.annualSpent);
  return plural(lineCount, { one: `# line · ${annual} a year amortized`, other: `# lines · ${annual} a year amortized` });
};

const returnSub = (figure: ReviewFigure | undefined): string | null => {
  if (figure === undefined) {
    return null;
  }
  const prudent = prudentReturnPercent(figure);
  const amortized = amortizedReturnLabel(figure);
  if (prudent === null) {
    return amortized;
  }
  const prudentLabel = formatReturnPercent(prudent);
  return amortized === null ? t`Prudent (p10): ${prudentLabel}` : t`Prudent (p10): ${prudentLabel} · ${amortized}`;
};

interface ReturnRowProps {
  heading: ReactNode,
  weight: RowWeight,
  figure: ReviewFigure | undefined,
  spent: number,
  lineCount: number,
}

const ReturnRow: FunctionComponent<ReturnRowProps> = ({ heading, weight, figure, spent, lineCount }) => {
  const expired = figure?.state === 'expired';
  const sub = returnSub(figure);
  return (
    <GridRow className={cn(weight === 'lead' ? 'py-4' : 'py-3.5', weight !== 'muted' && 'border-b border-elevation-subtle')}>
      <div role="rowheader" className="col-[1/-1] flex flex-col gap-1 pt-1 @[48rem]:col-auto">{heading}</div>
      <HeadingSpacer />
      <div role="cell" className="flex flex-col gap-0.5">
        <Value weight={weight}>{formatDollar(spent)}</Value>
        <Sub>{spentSub(figure, lineCount)}</Sub>
      </div>
      <Spacer />
      <div role="cell" className="flex flex-col gap-0.5">
        <Value weight={weight}><AleReduction value={figure?.aleReductionMean ?? null} expired={expired} iconSize={ARROW_SIZE[weight]} /></Value>
        <LossAvoidedSpread figure={figure} />
      </div>
      <Spacer />
      <div role="cell" className="flex flex-col gap-0.5">
        <Value weight={weight} emphasis><PlanReturn value={figure?.returnPercent ?? null} expired={expired} /></Value>
        {sub !== null && <Sub>{sub}</Sub>}
      </div>
    </GridRow>
  );
};

const NatureHeading: FunctionComponent<{ nature: BudgetLineNature }> = ({ nature }) => (
  <span className="inline-flex items-center gap-1.5">
    <LineNatureChip nature={nature} />
    <NatureInfo nature={nature} />
  </span>
);

interface BudgetReviewReturnSectionProps {
  /** Undefined while it loads. */
  figures: ReviewFigures | undefined,
  lines: ReadonlyArray<{ nature: BudgetLineNature, amountSpent: number }>,
  resimulation: ResimulationControl,
  onResimulate: () => void,
  number: number,
  children?: ReactNode,
}

/**
 * Every figure is the API's, the return included, so this section, the lines table and the list
 * cannot disagree. The overall row is a basket of its own, never the two rows above it added up.
 */
export const BudgetReviewReturnSection: FunctionComponent<BudgetReviewReturnSectionProps> = ({ figures, lines, resimulation, onResimulate, number, children }) => {
  const counts = lineCountByNature(lines);
  const spent = spentByNature(lines);
  const figureFor = (basket: 'build' | 'run' | 'ensemble') => (figures === undefined ? undefined : figureOf(figures.figures, basket));
  const ensemble = figureFor('ensemble');
  const closed = figures?.status === 'closed';
  const natures = (['build', 'run'] as const).filter((nature) => counts[nature] > 0 || lines.length === 0);

  return (
    <ReviewSection
      number={number}
      title={<Trans>What it returned</Trans>}
      adornment={ensemble !== undefined && !closed ? <FigureStateChip state={ensemble.state} /> : undefined}
      action={closed || resimulation === 'hidden' ? undefined : (
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
      contentClassName="gap-4"
    >
      <Paper elevation={2} padding={16} role="table" aria-label={t`What it returned`} className="@container flex flex-col p-[16px_24px]">
        <GridRow className="items-center border-b border-elevation-subtle pb-2 txt-container-title text-default-secondary">
          <span role="columnheader" className="@max-[48rem]:absolute"><span className="sr-only">{t`Nature`}</span></span>
          <HeadingSpacer />
          <span role="columnheader">{t`Spent`}</span>
          <Spacer>→</Spacer>
          <span role="columnheader">{t`Loss avoided per year`}</span>
          <Spacer>→</Spacer>
          <span role="columnheader">{t`Return`}</span>
        </GridRow>
        {natures.map((nature) => (
          <ReturnRow
            key={nature}
            heading={<NatureHeading nature={nature} />}
            weight={nature === 'build' ? 'lead' : 'second'}
            figure={figureFor(nature)}
            spent={spent[nature]}
            lineCount={counts[nature]}
          />
        ))}
        <ReturnRow
          heading={(
            <>
              <span className="inline-flex items-center gap-1.5">
                <Chip severity="neutral" label={t`Overall`} />
                <OverallInfo />
              </span>
              <Sub><Trans>priced as one basket, not the sum</Trans></Sub>
            </>
          )}
          weight="muted"
          figure={ensemble}
          spent={spent.total}
          lineCount={lines.length}
        />
      </Paper>
      {children}
    </ReviewSection>
  );
};
