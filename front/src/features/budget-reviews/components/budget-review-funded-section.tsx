import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import { Button, Paper } from '@filigran/design-system';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { inferRouterOutputs } from '@trpc/server';
import { Plus } from 'lucide-react';
import type { FunctionComponent } from 'react';
import type { BudgetLineNature } from '../budget-review-utils';
import { formatDate } from '../../../utils';
import { formatDollar } from '../../../utils/format-currency';
import { spentByNature } from '../budget-review-brief-utils';
import { figureOf, lineControls, movedWithoutBuildLine } from '../budget-review-utils';
import { LineNatureChip, lineNatureLabel } from '../ui/review-chips';
import { ReviewNotice } from '../ui/review-notice';
import { ReviewSection } from '../ui/review-section';
import { BudgetReviewCsfPanel } from './budget-review-csf-panel';
import { BudgetReviewLineCard } from './budget-review-line-card';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;
type Review = NonNullable<RouterOutputs['budgetReviews']['getBudgetReview']>;
type ReviewLine = Review['lines'][number];
type ReviewFigures = NonNullable<RouterOutputs['budgetReviews']['getBudgetReviewFigures']>;
type ControlPostures = NonNullable<RouterOutputs['budgetReviews']['getBudgetReviewControlPostures']>;

const NATURES: ReadonlyArray<BudgetLineNature> = ['build', 'run'];

const natureDefinition = (nature: BudgetLineNature): string => {
  switch (nature) {
    case 'build': return t`the period's posture changes`;
    case 'run': return t`the controls kept running, against their absence`;
  }
};

const linesAndSpent = (lineCount: number, spent: number): string => {
  const amount = formatDollar(spent);
  return plural(lineCount, { one: `# line · ${amount}`, other: `# lines · ${amount}` });
};

interface BudgetReviewFundedSectionProps {
  number: number,
  lines: Array<ReviewLine>,
  figures: ReviewFigures | undefined,
  postures: ControlPostures | undefined,
  closed: boolean,
  onAddLine: () => void,
  onOpenLine: (line: ReviewLine) => void,
  onAssignMoved: () => void,
}

/**
 * A nature's header states its spend alone: the loss it avoided is priced as one basket in the
 * return section, and a sum over its lines would contradict it.
 */
export const BudgetReviewFundedSection: FunctionComponent<BudgetReviewFundedSectionProps> = ({
  number,
  lines,
  figures,
  postures,
  closed,
  onAddLine,
  onOpenLine,
  onAssignMoved,
}) => {
  const spent = spentByNature(lines);
  const unassigned = movedWithoutBuildLine(postures?.controls ?? []).length;
  const logStart = postures?.logStartsAt;
  const logStartDate = logStart === null || logStart === undefined ? null : formatDate(logStart);
  const periodStartDate = postures === undefined ? null : formatDate(postures.periodStart);
  const openBuildLine = (lineId: string) => {
    const target = lines.find((line) => line.id === lineId);
    if (target !== undefined) {
      onOpenLine(target);
    }
  };

  return (
    <ReviewSection
      number={number}
      title={<Trans>What was funded</Trans>}
      adornment={<span className="txt-body2 whitespace-nowrap text-default-secondary">{linesAndSpent(lines.length, spent.total)}</span>}
      action={closed ? undefined : (
        <Button priority="tertiary" size="sm" startIcon={<Plus className="size-3" />} onClick={onAddLine}>
          <Trans>Add a line</Trans>
        </Button>
      )}
      contentClassName="gap-4"
    >
      {!closed && unassigned > 0 && (
        <ReviewNotice
          action={(
            <Button priority="secondary" size="sm" onClick={onAssignMoved}>
              <Trans>Assign</Trans>
            </Button>
          )}
        >
          {plural(unassigned, {
            one: '# control moved during the period with no build line.',
            other: '# controls moved during the period with no build line.',
          })}
        </ReviewNotice>
      )}
      {postures?.logCoversPeriodStart === false && logStartDate !== null && periodStartDate !== null && (
        <ReviewNotice tone="info">
          <Trans>Posture changes are recorded only since {logStartDate}: work delivered between {periodStartDate} and that date is not counted.</Trans>
        </ReviewNotice>
      )}
      {lines.length === 0
        ? (
          <p className="txt-sub-content text-default-secondary">
            <Trans>No budget line yet: add one for each project or standing cost this period's budget paid for.</Trans>
          </p>
        )
        : (
          <div className="@container">
            <div className="grid items-start gap-4 @5xl:grid-cols-[minmax(0,1fr)_18.75rem]">
              <div className="flex min-w-0 flex-col gap-4">
                {NATURES.map((nature) => {
                  const natureLines = lines.filter((line) => line.nature === nature);
                  if (natureLines.length === 0) {
                    return null;
                  }
                  return (
                    <Paper key={nature} as="section" elevation={2} padding={16} aria-label={lineNatureLabel(nature)} className="flex flex-col gap-3">
                      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1 pb-1">
                        <span className="flex items-center gap-2.5">
                          <LineNatureChip nature={nature} />
                          <span className="txt-body2 text-default-secondary">{natureDefinition(nature)}</span>
                        </span>
                        <span className="txt-body2 text-default-secondary">{linesAndSpent(natureLines.length, spent[nature])}</span>
                      </div>
                      {natureLines.map((line) => (
                        <BudgetReviewLineCard
                          key={line.id}
                          line={line}
                          figure={figures === undefined ? undefined : figureOf(figures.figures, 'line', line.id)}
                          controls={postures === undefined ? undefined : lineControls(line.capabilityIds, postures.controls)}
                          closed={closed}
                          onOpen={closed ? undefined : () => onOpenLine(line)}
                          onOpenBuildLine={closed ? undefined : openBuildLine}
                        />
                      ))}
                    </Paper>
                  );
                })}
              </div>
              <BudgetReviewCsfPanel lines={lines} />
            </div>
          </div>
        )}
    </ReviewSection>
  );
};
