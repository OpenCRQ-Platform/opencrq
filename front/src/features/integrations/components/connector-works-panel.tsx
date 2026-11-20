import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { CONNECTOR_INVENTORY } from '@app/module/client';
import { useQuery } from '@tanstack/react-query';
import type { ConnectorSource } from '@app/module/client';
import type { FunctionComponent } from 'react';
import { useTRPC } from '../../../lib';
import { RunHistoryPanel } from '../../jobs';

/**
 * No refetch interval: every write to a run rings the change doorbell the client already listens to,
 * so a running handler's progress reaches this panel on its own.
 */
export const ConnectorWorksPanel: FunctionComponent<{ source: ConnectorSource }> = ({ source }) => {
  const trpc = useTRPC();
  // The reader refuses the stream connector, which produces no runs; this tab is reachable for it
  // only by address.
  const { jobKind, runUnit } = CONNECTOR_INVENTORY[source];
  const producesRuns = jobKind !== null;
  const { data, isPending, error, dataUpdatedAt } = useQuery(trpc.connectors.listRuns.queryOptions(
    { source },
    { enabled: producesRuns },
  ));

  if (!producesRuns) {
    return (
      <p className="txt-sub-content text-muted-foreground">
        <Trans>This connector ingests continuously and produces no runs.</Trans>
      </p>
    );
  }

  return (
    <RunHistoryPanel
      data={data}
      isPending={isPending}
      error={error}
      dataUpdatedAt={dataUpdatedAt}
      unit={runUnit}
      neverRanLabel={<Trans>This connector has never run.</Trans>}
      inProgressTitle={(count) => t`In progress works (${count})`}
      completedTitle={(count) => t`Completed works (${count})`}
    />
  );
};
