import { createFileRoute, notFound } from '@tanstack/react-router';
import { RunDetailPage } from '../../../../../../../features/jobs';
import { trpcClient } from '../../../../../../../lib';

const RouteComponent = () => {
  const { run } = Route.useLoaderData();
  return <RunDetailPage initialRun={run} />;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/jobs/runs/$runId')({
  component: RouteComponent,
  loader: async ({ params }) => {
    const run = await trpcClient.jobs.getRun.query({ id: params.runId });
    if (!run) {
      throw notFound();
    }
    return { run, crumb: params.runId };
  },
});
