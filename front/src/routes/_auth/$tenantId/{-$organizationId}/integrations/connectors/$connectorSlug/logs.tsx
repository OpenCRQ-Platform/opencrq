import { t } from '@lingui/core/macro';
import { createFileRoute, stripSearchParams } from '@tanstack/react-router';
import { LOGS_LIST_SEARCH_DEFAULTS, logsListSearchSchema } from '../../../../../../../features/jobs/logs-list-search';
import { ConnectorLogsPanel, connectorSourceFromSlug } from '../../../../../../../features/integrations';

const RouteComponent = () => {
  const { connectorSlug } = Route.useParams();
  const source = connectorSourceFromSlug(connectorSlug);
  return source === null ? null : <ConnectorLogsPanel source={source} />;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/integrations/connectors/$connectorSlug/logs')({
  validateSearch: logsListSearchSchema,
  search: { middlewares: [stripSearchParams(LOGS_LIST_SEARCH_DEFAULTS)] },
  loader: () => ({ crumb: t`Logs` }),
  component: RouteComponent,
});
