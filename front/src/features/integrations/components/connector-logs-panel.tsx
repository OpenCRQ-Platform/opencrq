import { CONNECTOR_INVENTORY } from '@app/module/client';
import { useQuery } from '@tanstack/react-query';
import type { ConnectorSource } from '@app/module/client';
import type { FunctionComponent } from 'react';
import { useTRPC } from '../../../lib';
import { RunLogsPanel } from '../../jobs';

/**
 * No refetch interval: the store rings the change doorbell once per batch of lines it writes, and the
 * client already listens to it.
 */
export const ConnectorLogsPanel: FunctionComponent<{ source: ConnectorSource }> = ({ source }) => {
  const trpc = useTRPC();
  const { data, isPending, error } = useQuery(trpc.connectors.listLogs.queryOptions({ source }));
  const producesRuns = CONNECTOR_INVENTORY[source].jobKind !== null;

  return (
    <RunLogsPanel
      data={data}
      isPending={isPending}
      error={error}
      retention={producesRuns ? 'runs' : 'lines'}
    />
  );
};
