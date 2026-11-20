import { t } from '@lingui/core/macro';
import { createFileRoute, stripSearchParams } from '@tanstack/react-router';
import { LOGS_LIST_SEARCH_DEFAULTS, logsListSearchSchema } from '../../../../../../../../features/jobs/logs-list-search';
import { JobLogsPanel } from '../../../../../../../../features/jobs';

const RouteComponent = () => {
  const { jobKind } = Route.useParams();
  return <JobLogsPanel kind={jobKind} />;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/jobs/kinds/$jobKind/logs')({
  validateSearch: logsListSearchSchema,
  search: { middlewares: [stripSearchParams(LOGS_LIST_SEARCH_DEFAULTS)] },
  loader: () => ({ crumb: t`Logs` }),
  component: RouteComponent,
});
