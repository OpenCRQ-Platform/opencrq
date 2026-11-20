import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import { COVERAGE_BUCKETS, STRENGTH_RUNGS } from '@app/module/client';
import { Chip, Paper } from '@filigran/design-system';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { inferRouterOutputs } from '@trpc/server';
import { ArrowRight, ChevronDown, ChevronRight } from 'lucide-react';
import type { FunctionComponent, ReactNode } from 'react';
import { useId, useState } from 'react';
import { ControlIdPill } from '../../../components/shared';
import { cn } from '../../../utils';
import { formatDollar } from '../../../utils/format-currency';
import { coverageLabel } from '../../controls/capability/ui/coverage-label';
import { strengthLabel } from '../../controls/capability/ui/strength-label';
import { AleReduction } from '../../treatment-plans/ui/ale-reduction';
import { PlanReturn } from '../../treatment-plans/ui/plan-return';
import { CSF_FUNCTION_COLORS } from '../budget-review-csf-utils';
import { firstAndMore } from '../budget-review-utils';
import { amortizedReturnLabel } from '../ui/amortized-return';
import { LossAvoidedSpread } from '../ui/loss-avoided-spread';
import { PostureScale } from '../ui/posture-scale';
import { FigureStateChip } from '../ui/review-chips';
import { csfFunctionLabel } from './budget-review-csf-panel';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;
type Review = NonNullable<RouterOutputs['budgetReviews']['getBudgetReview']>;
type ReviewLine = Review['lines'][number];
type ReviewFigures = NonNullable<RouterOutputs['budgetReviews']['getBudgetReviewFigures']>;
type ReviewFigure = ReviewFigures['figures'][number];
type ControlPostures = NonNullable<RouterOutputs['budgetReviews']['getBudgetReviewControlPostures']>;
type ReviewControl = ControlPostures['controls'][number];

const amortizedSpend = (years: number | null): string | null =>
  (years === null || years <= 1 ? null : plural(years, { one: 'amortized over # year', other: 'amortized over # years' }));

const ChainFigure: FunctionComponent<{ label: string, sub: ReactNode, className: string, children: ReactNode }> = ({ label, sub, className, children }) => (
  <div className={className}>
    <dt className="txt-container-title text-default-secondary">{label}</dt>
    <dd className="mt-1 flex flex-col">
      <span className="flex items-center gap-2 txt-subtitle2 font-medium">{children}</span>
      {sub !== null && (typeof sub === 'string' ? <span className="txt-sub-content whitespace-nowrap text-default-secondary">{sub}</span> : sub)}
    </dd>
  </div>
);

const ChainArrow: FunctionComponent = () => <ArrowRight aria-hidden="true" className="mt-6 size-3.5 shrink-0 text-default-secondary" />;

/** Below 48rem the control spans the row and its two scales sit under it, below their own headers. */
const ControlsRow: FunctionComponent<{ className: string, children: ReactNode }> = ({ className, children }) => (
  <div role="row" className={cn('grid grid-cols-[repeat(2,minmax(0,1fr))] items-center gap-x-4 gap-y-2 @[48rem]:grid-cols-[minmax(0,1fr)_11rem_11rem]', className)}>
    {children}
  </div>
);

interface LineControlsProps {
  line: ReviewLine,
  controls: Array<ReviewControl>,
  /** Opens the build line a run control's progress is counted in; absent on a closed review. */
  onOpenBuildLine: ((lineId: string) => void) | undefined,
}

/**
 * A build line's controls show the move it paid for, a run line's the level it is priced at, the
 * posture at the period's start. No amount per control: a line is priced as one basket.
 */
const LineControls: FunctionComponent<LineControlsProps> = ({ line, controls, onOpenBuildLine }) => {
  const moving = line.nature === 'build';
  return (
    <div role="table" className="@container rounded-[var(--fds-radius-sm)] bg-[var(--fds-bg-elevation-default-layer-0-transparency-70)] px-4 py-1 txt-body2">
      <ControlsRow className="py-2 txt-container-title text-default-secondary">
        <span role="columnheader" className="@max-[48rem]:sr-only">{t`Control`}</span>
        <span role="columnheader">{t`Strength`}</span>
        <span role="columnheader">{t`Coverage`}</span>
      </ControlsRow>
      {controls.map((control) => {
        const buildLineName = control.buildLine?.name ?? '';
        const buildLineId = control.buildLine?.id;
        return (
          <ControlsRow key={control.capabilityId} className="border-t border-elevation-subtle py-2.5">
            <div role="cell" className="col-[1/-1] @[48rem]:col-auto">
              <span className="flex items-center gap-2.5">
                <ControlIdPill externalId={control.externalId} size="compact" />
                <span>{control.name}</span>
              </span>
              {!moving && buildLineId !== undefined && (onOpenBuildLine === undefined
                ? <span className="mt-1 block txt-sub-content text-primary"><Trans>Progress counted in “{buildLineName}”</Trans></span>
                : (
                  <button
                    type="button"
                    className="mt-1 block txt-sub-content text-primary underline-offset-4 hover:underline"
                    onClick={() => onOpenBuildLine(buildLineId)}
                  >
                    <Trans>Progress counted in “{buildLineName}”</Trans>
                  </button>
                ))}
            </div>
            <div role="cell">
              <PostureScale levels={STRENGTH_RUNGS} start={control.start.strengthRung} end={moving ? control.end.strengthRung : undefined} label={strengthLabel} />
            </div>
            <div role="cell">
              <PostureScale levels={COVERAGE_BUCKETS} start={control.start.coverageBucket} end={moving ? control.end.coverageBucket : undefined} label={coverageLabel} />
            </div>
          </ControlsRow>
        );
      })}
    </div>
  );
};

interface BudgetReviewLineCardProps {
  line: ReviewLine,
  /** Undefined while the figures load, or for a line the run has not priced. */
  figure: ReviewFigure | undefined,
  /** The line's controls; undefined while their postures load. */
  controls: Array<ReviewControl> | undefined,
  closed: boolean,
  /** Opens the line's drawer; absent on a closed review. */
  onOpen: (() => void) | undefined,
  onOpenBuildLine: ((lineId: string) => void) | undefined,
}

/** A budget line read left to right, from what it cost to what it avoided and returned, unfolding onto its controls. */
export const BudgetReviewLineCard: FunctionComponent<BudgetReviewLineCardProps> = ({ line, figure, controls, closed, onOpen, onOpenBuildLine }) => {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const count = line.capabilityIds.length;
  const canExpand = count > 0 && (controls === undefined || controls.length > 0);
  const { shown, more } = firstAndMore(controls ?? []);
  const expired = figure?.state === 'expired';
  const Chevron = open ? ChevronDown : ChevronRight;
  const csfLabels = line.csfFunctions.map(csfFunctionLabel).join(', ');

  return (
    <Paper as="article" elevation={3} padding={16} aria-label={line.name} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
        <div className="flex min-w-0 flex-col gap-2">
          {onOpen === undefined
            ? <span className="txt-default font-medium">{line.name}</span>
            : (
              <button type="button" className="txt-default text-left font-medium underline-offset-4 hover:underline" onClick={onOpen}>
                {line.name}
              </button>
            )}
          <span className="flex flex-wrap items-center gap-1.5">
            {controls === undefined && count > 0 && <Chip label={String(count)} />}
            {shown.map((control) => <ControlIdPill key={control.capabilityId} externalId={control.externalId} size="compact" />)}
            {more > 0 && <span className="txt-sub-content text-default-secondary">{`+${more}`}</span>}
            {line.csfFunctions.length > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 border-l border-elevation-subtle pl-3" title={csfLabels}>
                {line.csfFunctions.map((csfFunction) => (
                  <span key={csfFunction} aria-hidden="true" className="inline-block size-2 rounded-[2px]" style={{ backgroundColor: CSF_FUNCTION_COLORS[csfFunction] }} />
                ))}
                <span className="sr-only">{csfLabels}</span>
              </span>
            )}
          </span>
        </div>
        <dl className="flex items-start gap-3">
          <ChainFigure label={t`Spent`} sub={amortizedSpend(line.amortizationYears)} className="w-32">
            <span className="whitespace-nowrap">{formatDollar(line.amountSpent)}</span>
          </ChainFigure>
          <ChainArrow />
          <ChainFigure label={t`Loss avoided per year`} sub={<LossAvoidedSpread figure={figure} />} className="w-44">
            <AleReduction value={figure?.aleReductionMean ?? null} expired={expired} />
            {figure !== undefined && !closed && <FigureStateChip state={figure.state} />}
          </ChainFigure>
          <ChainArrow />
          <ChainFigure label={t`Return`} sub={figure === undefined ? null : amortizedReturnLabel(figure)} className="w-36">
            <PlanReturn value={figure?.returnPercent ?? null} expired={expired} />
          </ChainFigure>
        </dl>
      </div>
      {canExpand && (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={() => setOpen((current) => !current)}
          className="inline-flex items-center gap-1.5 self-start txt-body2 font-medium text-primary"
        >
          <Chevron aria-hidden="true" className="size-4" />
          {open
            ? plural(count, { one: 'Hide its control', other: 'Hide its # controls' })
            : plural(count, { one: 'Show its control', other: 'Show its # controls' })}
        </button>
      )}
      {open && (
        <div id={panelId}>
          {controls === undefined
            ? <p className="py-2 txt-sub-content text-default-secondary"><Trans>Loading...</Trans></p>
            : <LineControls line={line} controls={controls} onOpenBuildLine={onOpenBuildLine} />}
        </div>
      )}
    </Paper>
  );
};
