import { createFileRoute, stripSearchParams } from '@tanstack/react-router';
import { RUNS_LIST_SEARCH_DEFAULTS, runsListSearchSchema } from '../../../../../../../features/jobs/runs-list-search';
import { JobsTabs, RunsPage } from '../../../../../../../features/jobs';

const RouteComponent = () => (
  <div className="flex flex-col gap-6">
    <JobsTabs />
    <RunsPage />
  </div>
);

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/jobs/runs/')({
  validateSearch: runsListSearchSchema,
  search: { middlewares: [stripSearchParams(RUNS_LIST_SEARCH_DEFAULTS)] },
  component: RouteComponent,
});
