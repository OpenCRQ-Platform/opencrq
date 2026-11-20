import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import { msg, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Link, useNavigate } from '@tanstack/react-router';
import type { inferRouterOutputs } from '@trpc/server';
import { ArrowLeft } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { BudgetLineNature } from '../budget-review-utils';
import { ConfirmDialog, DetailPageLayout } from '../../../components/shared';
import { DeleteConfirmDialog } from '../../../components/shared/delete-confirm-dialog';
import { useTRPC } from '../../../lib';
import { formatDate } from '../../../utils';
import { toCalendarDate } from '../../../utils/date-utils';
import { resimulationControl } from '../../treatment-plans/treatment-plan-utils';
import { ScopeRiskToleranceDrawer } from '../../risk-tolerance';
import { closeBlocker, figureOf, lineCountByNature } from '../budget-review-utils';
import { closeBlockerHint } from '../ui/close-blocker-hint';
import { BudgetReviewBriefCard } from './budget-review-brief-card';
import { BudgetReviewEditDrawer } from './budget-review-edit-drawer';
import { BudgetReviewFundedSection } from './budget-review-funded-section';
import { BudgetReviewHeaderActions } from './budget-review-header-actions';
import { BudgetReviewIdentityCard } from './budget-review-identity-card';
import { BudgetReviewLineDrawer } from './budget-review-line-drawer';
import { BudgetReviewReturnSection } from './budget-review-return-section';
import { BudgetReviewRiskChart } from './budget-review-risk-chart';
import { BudgetReviewToleranceSection } from './budget-review-tolerance-section';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;
type Review = NonNullable<RouterOutputs['budgetReviews']['getBudgetReview']>;
type ReviewLine = Review['lines'][number];

interface LineEditing {
  line: ReviewLine | null,
  nature: BudgetLineNature,
}

/** The sections follow the order a board asks its questions in. A closed review reads the same and loses every edit. */
export const BudgetReviewPage: FunctionComponent<{ review: Review }> = ({ review }) => {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const closed = review.status === 'closed';
  const [editing, setEditing] = useState(false);
  const [lineEditing, setLineEditing] = useState<LineEditing | null>(null);
  const [closing, setClosing] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [settingTolerance, setSettingTolerance] = useState(false);

  const { data: figures } = useQuery(trpc.budgetReviews.getBudgetReviewFigures.queryOptions({ reviewId: review.id }));
  const { data: postures } = useQuery(trpc.budgetReviews.getBudgetReviewControlPostures.queryOptions({ reviewId: review.id }));
  const { data: tolerance } = useQuery(trpc.budgetReviews.getBudgetReviewTolerance.queryOptions({ reviewId: review.id }));
  const { data: simulationState, refetch: refetchSimulationState } = useQuery(trpc.budgetReviews.getBudgetReviewSimulationState.queryOptions(
    { reviewId: review.id },
    { enabled: !closed },
  ));
  const { mutate: resimulate, isPending: isResimulating } = useMutation(trpc.budgetReviews.resimulateBudgetReviewScenarios.mutationOptions({
    meta: { skipSuccessToast: true },
    // An enqueue that queued nothing writes nothing for the doorbell to ring on, so the mutation
    // stays pending until the state it leaves behind has been read.
    onSuccess: () => refetchSimulationState(),
  }));
  const resimulation = resimulationControl(simulationState, isResimulating);

  const closeReview = useMutation(trpc.budgetReviews.closeBudgetReview.mutationOptions({
    meta: { successMessage: msg`Budget review closed successfully.` },
  }));
  const reopenReview = useMutation(trpc.budgetReviews.reopenBudgetReview.mutationOptions({
    meta: { successMessage: msg`Budget review reopened successfully.` },
  }));
  const deleteReview = useMutation(trpc.budgetReviews.deleteBudgetReviews.mutationOptions({
    meta: { successMessage: msg`Budget review deleted successfully.` },
    onSuccess: () => void navigate({ from: '/$tenantId/{-$organizationId}', to: 'budget-reviews' }),
  }));

  const ensemble = figures ? figureOf(figures.figures, 'ensemble') : undefined;
  const build = figures ? figureOf(figures.figures, 'build') : undefined;
  const closeHint = closeBlockerHint(closeBlocker(review.lines.length, figures), figures?.olderThanHeadlineNames ?? []);
  const hasBuildLine = lineCountByNature(review.lines).build > 0;
  const reviewName = review.name;
  const today = formatDate(toCalendarDate(new Date()));
  const closedDate = review.closedAt === null ? '' : formatDate(review.closedAt);

  return (
    <>
      <DetailPageLayout
        title={review.name}
        titleLeading={(
          <Link
            from="/$tenantId/{-$organizationId}"
            to="budget-reviews"
            aria-label={t`Back to the budget reviews`}
            className="inline-flex h-8 w-8 items-center justify-center text-primary"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
        )}
        actions={(
          <BudgetReviewHeaderActions
            status={review.status}
            closeHint={closeHint}
            onEdit={() => setEditing(true)}
            onClose={() => setClosing(true)}
            onReopen={() => setReopening(true)}
            onDelete={() => setDeleting(true)}
          />
        )}
      >
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[380px_minmax(0,1fr)]">
          <BudgetReviewIdentityCard review={review} pricedAt={ensemble?.pricedAt ?? null} />
          <BudgetReviewBriefCard review={review} figures={figures ?? undefined} tolerance={tolerance} />
        </div>
        <BudgetReviewFundedSection
          number={1}
          lines={review.lines}
          figures={figures ?? undefined}
          postures={postures ?? undefined}
          closed={closed}
          onAddLine={() => setLineEditing({ line: null, nature: 'build' })}
          onOpenLine={(line) => setLineEditing({ line, nature: line.nature })}
          onAssignMoved={() => setLineEditing({ line: null, nature: 'build' })}
        />
        <BudgetReviewReturnSection
          number={2}
          figures={figures ?? undefined}
          lines={review.lines}
          resimulation={resimulation}
          onResimulate={() => resimulate({ reviewId: review.id })}
        >
          <BudgetReviewRiskChart
            reviewId={review.id}
            periodStart={review.periodStart}
            periodEnd={review.periodEnd}
            buildFigure={hasBuildLine ? build ?? null : null}
            lines={review.lines}
            controls={postures?.controls ?? []}
          />
        </BudgetReviewReturnSection>
        <BudgetReviewToleranceSection
          number={3}
          tolerance={tolerance}
          closed={closed}
          onSetTolerance={closed ? undefined : () => setSettingTolerance(true)}
        />
      </DetailPageLayout>
      <BudgetReviewEditDrawer open={editing} onOpenChange={setEditing} review={review} />
      <ScopeRiskToleranceDrawer organizationId={review.organizationId} open={settingTolerance} onClose={() => setSettingTolerance(false)} />
      <BudgetReviewLineDrawer
        open={lineEditing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setLineEditing(null);
          }
        }}
        reviewId={review.id}
        organizationId={review.organizationId}
        periodStart={review.periodStart}
        periodEnd={review.periodEnd}
        line={lineEditing?.line ?? null}
        initialNature={lineEditing?.nature ?? 'build'}
        postures={postures ?? undefined}
      />
      <ConfirmDialog
        open={closing}
        onOpenChange={setClosing}
        onConfirm={() => closeReview.mutate({ reviewId: review.id })}
        title={t`Close “${reviewName}”?`}
        description={t`The figures are frozen at ${today}. Later simulations no longer change them, and the budget lines can no longer be edited.`}
        submitButtonText={<Trans>Close the review</Trans>}
      />
      <ConfirmDialog
        open={reopening}
        onOpenChange={setReopening}
        onConfirm={() => reopenReview.mutate({ reviewId: review.id })}
        title={t`Reopen “${reviewName}”?`}
        description={t`The figures frozen on ${closedDate} are dropped and priced again on today's model: they may differ from the ones presented. The budget lines can be edited again.`}
        submitButtonText={<Trans>Reopen</Trans>}
      />
      <DeleteConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        onConfirm={() => deleteReview.mutate([review.id])}
        title={<Trans>Delete budget review</Trans>}
        description={<Trans>This will permanently delete this budget review, its budget lines and its figures. This action cannot be undone.</Trans>}
      />
    </>
  );
};
