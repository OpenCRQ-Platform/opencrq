import { t } from '@lingui/core/macro';
import { createFileRoute, notFound, Outlet } from '@tanstack/react-router';
import { scopePath } from '../../../../../../../components/layout/scope-path-utils';
import { ConnectorDetailShell, connectorSourceFromSlug, getConnectors } from '../../../../../../../features/integrations';
import { trpcClient } from '../../../../../../../lib';

const RouteComponent = () => {
  const { connectorSlug } = Route.useParams();
  const { connector } = Route.useLoaderData();
  const source = connectorSourceFromSlug(connectorSlug);
  if (source === null) {
    return null;
  }
  return (
    <ConnectorDetailShell source={source} initialConnector={connector}>
      <Outlet />
    </ConnectorDetailShell>
  );
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/integrations/connectors/$connectorSlug')({
  component: RouteComponent,
  beforeLoad: ({ params }) => {
    if (connectorSourceFromSlug(params.connectorSlug) === null) {
      throw notFound();
    }
  },
  loader: async ({ params }) => {
    const source = connectorSourceFromSlug(params.connectorSlug)!;
    const connector = await trpcClient.connectors.getConnector.query({ source });
    return {
      connector,
      // Deployment credentials are what split the two tabs, so the trail back lands on the list the
      // reader actually came from rather than on a plausible one.
      ancestorCrumbs: [{
        label: connector.platformConfigured ? t`Deployed` : t`Available`,
        to: scopePath(
          params.tenantId,
          params.organizationId,
          `integrations/${connector.platformConfigured ? 'deployed' : 'available'}`,
        ),
      }],
      crumb: getConnectors()[source].name,
    };
  },
});
