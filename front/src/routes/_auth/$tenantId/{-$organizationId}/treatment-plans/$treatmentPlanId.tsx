import { t } from '@lingui/core/macro';
import { createFileRoute, linkOptions, notFound, redirect } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { EntityUnavailable } from '../../../../../components/layout';
import { TreatmentPlanPage } from '../../../../../features';
import { trpcClient, useTRPC } from '../../../../../lib';

const TreatmentPlanNotFound = () => (
  <EntityUnavailable
    title={t`Treatment plan unavailable`}
    description={t`This risk treatment plan has been deleted or is no longer accessible.`}
    listLabel={t`See all treatment plans`}
    listLink={linkOptions({ from: '/$tenantId/{-$organizationId}/treatment-plans/$treatmentPlanId', to: '..' })}
  />
);

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/treatment-plans/$treatmentPlanId')({
  loader: async ({ params }) => {
    const treatmentPlan = await trpcClient.treatmentPlans.getTreatmentPlan.query({ id: params.treatmentPlanId });
    if (!treatmentPlan) {
      throw notFound();
    }
    // A plan belongs to one risk scope, so the detail opens inside it whatever scope, or none, the
    // address named.
    if (params.organizationId !== treatmentPlan.organizationId) {
      throw redirect({
        to: '/$tenantId/{-$organizationId}/treatment-plans/$treatmentPlanId',
        params: { ...params, organizationId: treatmentPlan.organizationId },
      });
    }
    return { treatmentPlan, crumb: treatmentPlan.name };
  },
  notFoundComponent: TreatmentPlanNotFound,
  component: function TreatmentPlanRoute() {
    const trpc = useTRPC();
    const { treatmentPlan: initialData } = Route.useLoaderData();
    // The loader only seeds the first paint: read through the query or an edit made on this page
    // would leave the header showing what the loader captured.
    const { data: plan } = useQuery(trpc.treatmentPlans.getTreatmentPlan.queryOptions(
      { id: initialData.id },
      { initialData },
    ));
    if (!plan) {
      throw notFound();
    }
    return <TreatmentPlanPage plan={plan} />;
  },
});
