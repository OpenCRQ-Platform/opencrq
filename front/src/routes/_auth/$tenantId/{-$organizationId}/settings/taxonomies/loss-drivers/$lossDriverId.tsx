import { createFileRoute, notFound } from '@tanstack/react-router';
import { LossDriverDetail } from '../../../../../../../features';
import { trpcClient } from '../../../../../../../lib';

const RouteComponent = () => {
  const { lossDriver: initialData } = Route.useLoaderData();
  return <LossDriverDetail initialData={initialData} />;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/taxonomies/loss-drivers/$lossDriverId')({
  loader: async ({ params }) => {
    const lossDriver = await trpcClient.lossDrivers.getLossDriver.query({ id: params.lossDriverId });
    if (!lossDriver) {
      throw notFound();
    }
    return { lossDriver, crumb: lossDriver.name };
  },
  component: RouteComponent,
});
