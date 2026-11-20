import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import { useTRPC } from '../../../lib';
import { RunLogsPanel } from './run-logs-panel';

/**
 * No refetch interval: the store rings the change doorbell once per batch of lines it writes, and the
 * client already listens to it.
 */
export const JobLogsPanel: FunctionComponent<{ kind: string }> = ({ kind }) => {
  const trpc = useTRPC();
  const { data, isPending, error } = useQuery(trpc.jobs.listLogs.queryOptions({ kind }));

  return (
    <RunLogsPanel
      data={data}
      isPending={isPending}
      error={error}
      retention="runs"
    />
  );
};
