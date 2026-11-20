import { t } from '@lingui/core/macro';
import { createFileRoute, notFound, redirect } from '@tanstack/react-router';
import { FileX2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { ErrorPage } from '../../../../../components/layout';
import { TreatmentPlanPage } from '../../../../../features';
import { trpcClient, useTRPC } from '../../../../../lib';

const TreatmentPlanNotFound = () => (
  <ErrorPage>
    <div className="relative mb-m mx-auto w-fit">
      <div className="absolute inset-0 rounded-full blur-xl bg-red/15" />
      <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-red/10">
        <FileX2 className="h-8 w-8 text-red/80" />
      </div>
    </div>
    <h1 className="mb-s">{t`Treatment plan unavailable`}</h1>
    <p className="txt-sub-content text-muted-foreground">{t`This risk treatment plan has been deleted or is no longer accessible.`}</p>
  </ErrorPage>
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
