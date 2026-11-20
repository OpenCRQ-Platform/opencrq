import { createFileRoute } from '@tanstack/react-router';
import { JobsPage, JobsTabs } from '../../../../../../../features/jobs';

const RouteComponent = () => (
  <div className="flex flex-col gap-6">
    <JobsTabs />
    <JobsPage />
  </div>
);

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/jobs/kinds/')({
  component: RouteComponent,
});
