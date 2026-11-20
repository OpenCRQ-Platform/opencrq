import { t } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { connectorSourceFromSlug, ConnectorStreamPanel } from '../../../../../../../features/integrations';

const RouteComponent = () => {
  const { connectorSlug } = Route.useParams();
  const source = connectorSourceFromSlug(connectorSlug);
  return source === null ? null : <ConnectorStreamPanel source={source} />;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/integrations/connectors/$connectorSlug/stream')({
  loader: () => ({ crumb: t`Stream` }),
  component: RouteComponent,
});
