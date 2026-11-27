import { t } from '@lingui/core/macro';
import { createFileRoute, linkOptions, notFound, redirect } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { EntityUnavailable } from '../../../../../components/layout';
import { BudgetReviewPage } from '../../../../../features';
import { trpcClient, useTRPC } from '../../../../../lib';

const BudgetReviewNotFound = () => (
  <EntityUnavailable
    title={t`Budget review unavailable`}
    description={t`This budget review has been deleted or is no longer accessible.`}
    listLabel={t`See all budget reviews`}
    listLink={linkOptions({ from: '/$tenantId/{-$organizationId}/budget-reviews/$budgetReviewId', to: '..' })}
  />
);

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/budget-reviews/$budgetReviewId')({
  loader: async ({ params }) => {
    const budgetReview = await trpcClient.budgetReviews.getBudgetReview.query({ id: params.budgetReviewId });
    if (!budgetReview) {
      throw notFound();
    }
    // A review belongs to one risk scope, so its page opens inside it whatever scope, or none, the
    // address named.
    if (params.organizationId !== budgetReview.organizationId) {
      throw redirect({
        to: '/$tenantId/{-$organizationId}/budget-reviews/$budgetReviewId',
        params: { ...params, organizationId: budgetReview.organizationId },
      });
    }
    return { budgetReview, crumb: budgetReview.name };
  },
  notFoundComponent: BudgetReviewNotFound,
  component: function BudgetReviewRoute() {
    const trpc = useTRPC();
    const { budgetReview: initialData } = Route.useLoaderData();
    // The loader only seeds the first paint: an edit made on this page must reach the header.
    const { data: review } = useQuery(trpc.budgetReviews.getBudgetReview.queryOptions(
      { id: initialData.id },
      { initialData },
    ));
    if (!review) {
      throw notFound();
    }
    return <BudgetReviewPage review={review} />;
  },
});
