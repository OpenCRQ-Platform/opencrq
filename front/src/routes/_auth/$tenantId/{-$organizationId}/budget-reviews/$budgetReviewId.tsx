import { t } from '@lingui/core/macro';
import { createFileRoute, notFound, redirect } from '@tanstack/react-router';
import { FileX2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { ErrorPage } from '../../../../../components/layout';
import { BudgetReviewPage } from '../../../../../features';
import { trpcClient, useTRPC } from '../../../../../lib';

const BudgetReviewNotFound = () => (
  <ErrorPage>
    <div className="relative mb-m mx-auto w-fit">
      <div className="absolute inset-0 rounded-full blur-xl bg-red/15" />
      <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-red/10">
        <FileX2 className="h-8 w-8 text-red/80" />
      </div>
    </div>
    <h1 className="mb-s">{t`Budget review unavailable`}</h1>
    <p className="txt-sub-content text-muted-foreground">{t`This budget review has been deleted or is no longer accessible.`}</p>
  </ErrorPage>
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
