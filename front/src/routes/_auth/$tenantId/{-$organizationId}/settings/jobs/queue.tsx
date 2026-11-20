import { createFileRoute } from '@tanstack/react-router';
import { JobsTabs, QueuePage } from '../../../../../../features/jobs';

const RouteComponent = () => (
  <div className="flex flex-col gap-6">
    <JobsTabs />
    <QueuePage />
  </div>
);

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/jobs/queue')({
  component: RouteComponent,
});
