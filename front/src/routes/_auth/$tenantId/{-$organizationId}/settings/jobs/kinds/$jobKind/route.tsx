import { isDisplayedJobKind } from '@app/module/client';
import { createFileRoute, notFound, Outlet } from '@tanstack/react-router';
import { JobDetailShell } from '../../../../../../../../features/jobs';
import { trpcClient } from '../../../../../../../../lib';

const RouteComponent = () => {
  const { jobKind } = Route.useParams();
  const { job } = Route.useLoaderData();
  return (
    <JobDetailShell kind={jobKind} initialJob={job}>
      <Outlet />
    </JobDetailShell>
  );
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/jobs/kinds/$jobKind')({
  component: RouteComponent,
  beforeLoad: ({ params }) => {
    if (!isDisplayedJobKind(params.jobKind)) {
      throw notFound();
    }
  },
  loader: async ({ params }) => {
    const job = await trpcClient.jobs.getJobKind.query({ kind: params.jobKind });
    return { job, crumb: params.jobKind };
  },
});
