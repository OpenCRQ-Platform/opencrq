import { t } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { connectorSourceFromSlug, ConnectorWorksPanel } from '../../../../../../../features/integrations';

const RouteComponent = () => {
  const { connectorSlug } = Route.useParams();
  const source = connectorSourceFromSlug(connectorSlug);
  return source === null ? null : <ConnectorWorksPanel source={source} />;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/integrations/connectors/$connectorSlug/works')({
  loader: () => ({ crumb: t`Works` }),
  component: RouteComponent,
});
