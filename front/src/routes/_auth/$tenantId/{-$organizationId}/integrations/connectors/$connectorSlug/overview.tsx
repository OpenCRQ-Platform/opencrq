import { t } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { ConnectorOverviewPanel, connectorSourceFromSlug } from '../../../../../../../features/integrations';

const RouteComponent = () => {
  const { connectorSlug } = Route.useParams();
  const source = connectorSourceFromSlug(connectorSlug);
  return source === null ? null : <ConnectorOverviewPanel source={source} />;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/integrations/connectors/$connectorSlug/overview')({
  loader: () => ({ crumb: t`Overview` }),
  component: RouteComponent,
});
