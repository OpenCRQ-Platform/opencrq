import { useQuery } from '@tanstack/react-query';
import type { ConnectorSource } from '@app/module/client';
import type { FunctionComponent } from 'react';
import { Loader } from '../../../components';
import { useTRPC } from '../../../lib';
import { ConnectorOverview } from './connector-overview';

/** The Overview tab's own route panel. Shares the shell's query rather than issuing a second one. */
export const ConnectorOverviewPanel: FunctionComponent<{ source: ConnectorSource }> = ({ source }) => {
  const trpc = useTRPC();
  const { data: connector } = useQuery(trpc.connectors.getConnector.queryOptions({ source }));
  return connector ? <ConnectorOverview connector={connector} /> : <Loader />;
};
