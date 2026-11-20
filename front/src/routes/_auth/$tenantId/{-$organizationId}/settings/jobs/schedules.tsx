import { createFileRoute } from '@tanstack/react-router';
import { JobsTabs, SchedulesPage } from '../../../../../../features/jobs';

const RouteComponent = () => (
  <div className="flex flex-col gap-6">
    <JobsTabs />
    <SchedulesPage />
  </div>
);

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/jobs/schedules')({
  component: RouteComponent,
});
