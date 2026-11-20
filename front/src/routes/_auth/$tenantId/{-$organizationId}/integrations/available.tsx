import { createFileRoute, stripSearchParams } from '@tanstack/react-router';
import { t } from '@lingui/core/macro';
import { ConnectorsPage, IntegrationsHero } from '../../../../../features/integrations';
import { ConnectorTabs } from '../../../../../features/integrations/components/connector-tabs';
import { CONNECTORS_LIST_SEARCH_DEFAULTS, connectorsListSearchSchema } from '../../../../../features/integrations/connectors-list-search';

const RouteComponent = () => (
  <div className="flex flex-col gap-6">
    <IntegrationsHero />
    <ConnectorTabs />
    <ConnectorsPage tab="available" />
  </div>
);

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/integrations/available')({
  validateSearch: connectorsListSearchSchema,
  search: { middlewares: [stripSearchParams(CONNECTORS_LIST_SEARCH_DEFAULTS)] },
  component: RouteComponent,
  loader: () => ({
    crumb: t`Available`,
  }),
});
