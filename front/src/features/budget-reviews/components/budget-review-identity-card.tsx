import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import type { inferRouterOutputs } from '@trpc/server';
import type { FunctionComponent } from 'react';
import { CardField, DescriptionField, InfoField, SectionCard } from '../../../components/shared';
import { formatDate, formatDateTime } from '../../../utils';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;
type Review = NonNullable<RouterOutputs['budgetReviews']['getBudgetReview']>;

type IdentityReview = Pick<Review, 'organizationId' | 'organization' | 'owner' | 'periodStart' | 'periodEnd' | 'closedAt' | 'context'>;

export const BudgetReviewIdentityCard: FunctionComponent<{ review: IdentityReview, pricedAt: string | null }> = ({ review, pricedAt }) => {
  const from = formatDate(review.periodStart);
  const to = formatDate(review.periodEnd);
  return (
    <SectionCard
      titleVariant="inside"
      title={<Trans>Identity</Trans>}
      className="h-full"
      cardClassName="h-full"
      contentClassName="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-x-5 gap-y-4"
    >
      <CardField title={t`Risk scope`}>
        <Link
          from="/$tenantId/{-$organizationId}"
          to="."
          params={(previous) => ({ ...previous, organizationId: review.organizationId })}
          className="text-primary underline-offset-4 hover:underline"
        >
          {review.organization.name}
        </Link>
      </CardField>
      <InfoField title={t`Owner`} value={review.owner?.name} />
      <InfoField title={t`Period`} value={t`${from} to ${to}`} />
      {review.closedAt === null
        ? <InfoField title={t`Priced on`} value={pricedAt === null ? null : formatDateTime(pricedAt)} />
        : <InfoField title={t`Closed on`} value={formatDate(review.closedAt)} />}
      <DescriptionField title={t`Context`} value={review.context} className="col-span-2" />
    </SectionCard>
  );
};
