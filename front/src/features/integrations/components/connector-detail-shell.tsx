import { t } from '@lingui/core/macro';
import { CONNECTOR_INVENTORY } from '@app/module/client';
import type { ConnectorSource } from '@app/module/client';
import { linkOptions } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent, ReactNode } from 'react';
import type { ConnectorDetail } from '../connector-detail-types';
import type { RouteTab } from '../../../components/shared';
import { Loader } from '../../../components';
import { RouteTabs, TooltipHintProvider } from '../../../components/shared';
import { useTRPC } from '../../../lib';
import { middleTabKey } from '../connector-route-utils';
import { ConnectorBanner } from './connector-banner';
import { ConnectorHeader } from './connector-header';
import { OpenctiStreamWarningBanner } from './opencti-stream-warning-banner';
import { OpenctiThreatVisibilityBanner } from './opencti-threat-visibility';

const CONNECTOR_ROUTE = '/$tenantId/{-$organizationId}/integrations/connectors/$connectorSlug';

/** Says why nothing on this page can be made to run, on the tenant surface that shows the controls. */
const NotInDeploymentBanner: FunctionComponent = () => (
  <ConnectorBanner severity="warning">
    {t`Add this connector to your deployment configuration to use it.`}
  </ConnectorBanner>
);

const middleTab = (source: ConnectorSource): RouteTab =>
  middleTabKey(CONNECTOR_INVENTORY[source].mechanism) === 'stream'
    ? { key: 'stream', label: t`Stream`, linkOption: linkOptions({ from: CONNECTOR_ROUTE, to: 'stream' }) }
    : { key: 'works', label: t`Works`, linkOption: linkOptions({ from: CONNECTOR_ROUTE, to: 'works' }) };

export const ConnectorDetailShell: FunctionComponent<{
  source: ConnectorSource,
  initialConnector: ConnectorDetail,
  children: ReactNode,
}> = ({ source, initialConnector, children }) => {
  const trpc = useTRPC();
  const { data: connector } = useQuery(trpc.connectors.getConnector.queryOptions(
    { source },
    { initialData: initialConnector },
  ));

  const tabs: Array<RouteTab> = [
    { key: 'overview', label: t`Overview`, linkOption: linkOptions({ from: CONNECTOR_ROUTE, to: 'overview' }) },
    middleTab(source),
    { key: 'logs', label: t`Logs`, linkOption: linkOptions({ from: CONNECTOR_ROUTE, to: 'logs' }) },
  ];

  if (!connector) {
    return <Loader />;
  }

  return (
    <TooltipHintProvider>
      <div className="flex flex-col gap-6">
        <ConnectorHeader connector={connector} />
        {!connector.platformConfigured && <NotInDeploymentBanner />}
        {connector.source === 'opencti' && connector.platformConfigured && <OpenctiStreamWarningBanner />}
        {connector.source === 'opencti' && connector.platformConfigured && <OpenctiThreatVisibilityBanner />}
        <RouteTabs tabs={tabs} />
        {children}
      </div>
    </TooltipHintProvider>
  );
};
