import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import { useTRPC } from '../../../lib';
import { RunHistoryPanel } from './run-history-panel';

/**
 * No refetch interval: every write to a run rings the change doorbell the client already listens to,
 * so a running handler's progress reaches this panel on its own.
 */
export const JobRunsPanel: FunctionComponent<{ kind: string }> = ({ kind }) => {
  const trpc = useTRPC();
  const { data, isPending, error, dataUpdatedAt } = useQuery(trpc.jobs.listRuns.queryOptions({ kind }));

  return (
    <RunHistoryPanel
      data={data}
      isPending={isPending}
      error={error}
      dataUpdatedAt={dataUpdatedAt}
      unit={null}
      neverRanLabel={<Trans>This job has never run.</Trans>}
      inProgressTitle={(count) => t`In progress runs (${count})`}
      completedTitle={(count) => t`Completed runs (${count})`}
    />
  );
};
