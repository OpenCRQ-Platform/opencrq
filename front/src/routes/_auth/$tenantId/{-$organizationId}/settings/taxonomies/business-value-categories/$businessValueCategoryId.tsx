import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { createFileRoute, notFound } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { DescriptionField, DetailPageLayout, SectionCard } from '../../../../../../../components/shared';
import { trpcClient, useTRPC } from '../../../../../../../lib';
import { businessResourceName, businessResourcePickerLine } from '../../../../../../../features/business-value-categories';

const BusinessValueCategoryDetail = () => {
  const trpc = useTRPC();
  const { businessValueCategory: initialData } = Route.useLoaderData();

  const { data: businessValueCategory } = useQuery(trpc.businessValueCategories.getBusinessValueCategory.queryOptions(
    { id: initialData.id },
    { initialData },
  ));

  if (!businessValueCategory) {
    return null;
  }

  return (
    <DetailPageLayout title={businessResourceName(businessValueCategory)}>
      <SectionCard title={t`Details`}>
        <DescriptionField title={t`Description`} value={businessResourcePickerLine(businessValueCategory)} />
      </SectionCard>

      <p className="txt-sub-content text-muted-foreground">
        <Trans>Business resources are platform reference data and cannot be edited.</Trans>
      </p>
    </DetailPageLayout>
  );
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/taxonomies/business-value-categories/$businessValueCategoryId')({
  loader: async ({ params }) => {
    const businessValueCategory = await trpcClient.businessValueCategories.getBusinessValueCategory.query({
      id: params.businessValueCategoryId,
    });
    if (!businessValueCategory) {
      throw notFound();
    }
    return { businessValueCategory, crumb: businessResourceName(businessValueCategory) };
  },
  component: BusinessValueCategoryDetail,
});
