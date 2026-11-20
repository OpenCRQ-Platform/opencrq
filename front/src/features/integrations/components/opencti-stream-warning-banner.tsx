import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import { configuredStreamAlarm, findConfiguredStream } from '../opencti-stream-filter-utils';
import { useTRPC } from '../../../lib';
import { STREAM_ALARM_SEVERITY, streamAlarmDetail, streamAlarmTitle } from '../connector-vocabulary';
import { ConnectorBanner } from './connector-banner';

/**
 * Raised above the tabs so it reaches the operator on Overview, where a starved connector otherwise
 * reads as healthy. Both reads are optional: an unreachable OpenCTI leaves the page as it was rather
 * than claiming anything about the stream.
 */
export const OpenctiStreamWarningBanner: FunctionComponent = () => {
  const trpc = useTRPC();
  const { data: settings } = useQuery(trpc.opencti.getSettings.queryOptions(undefined, { retry: false }));
  const { data: streams } = useQuery(trpc.opencti.listStreams.queryOptions(undefined, { retry: false }));

  const streamId = settings?.streamId ?? null;
  const alarm = configuredStreamAlarm(streams, streamId);
  if (alarm === null) {
    return null;
  }
  const missing = findConfiguredStream(streams, streamId)?.missingRelationships ?? [];

  return (
    <ConnectorBanner severity={STREAM_ALARM_SEVERITY[alarm]} title={streamAlarmTitle(alarm)}>
      {streamAlarmDetail(alarm, missing)}
    </ConnectorBanner>
  );
};
