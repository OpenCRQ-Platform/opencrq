import { Chip, ProgressBar } from '@filigran/design-system';
import { i18n } from '@lingui/core';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { CONNECTOR_INVENTORY } from '@app/module/client';
import type { ConnectorSource } from '@app/module/client';
import { TriangleAlert } from 'lucide-react';
import type { FunctionComponent, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { StreamReadRate, StreamReadSample } from '../connector-stream-utils';
import { Loader } from '../../../components';
import { CardField, SectionCard } from '../../../components/shared';
import { EmptyValue } from '../../../components/ui/empty-value';
import { useHasManageSecurity } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { formatCompactCount, formatDateTime } from '../../../utils';
import { isStreamReadStale, msUntilStreamReadStale, streamReadRate } from '../connector-stream-utils';
import { STREAM_CONNECTION_SEVERITY, streamConnectionLabel } from '../connector-vocabulary';
import { OpenctiConfiguredStream } from './opencti-configured-stream';

const DateField: FunctionComponent<{ title: string, instant: string | null }> = ({ title, instant }) => (
  <CardField title={title}>
    {instant === null ? <EmptyValue /> : formatDateTime(instant)}
  </CardField>
);

// The region stays mounted and the notice appears inside it: a container that arrives with its own text
// is not reliably announced. `status` not `alert`, the panel repainting on every position written.
const CatchingUpNotice: FunctionComponent<{ shown: boolean }> = ({ shown }) => (
  <div role="status">
    {shown && (
      <div
        className="flex items-center gap-2.5 rounded-[var(--fds-radius-sm)] px-5 py-3"
        style={{ background: 'var(--fds-color-feedback-warning-secondary-transparency-30)' }}
      >
        <TriangleAlert className="size-[18px] shrink-0" style={{ color: 'var(--fds-color-feedback-warning-primary)' }} />
        <span className="font-content-base text-content-base">
          {t`This stream is still replaying its history. What it has received so far is imported in batches, so this platform's threat intelligence is behind the stream.`}
        </span>
      </div>
    )}
  </div>
);

const Figure: FunctionComponent<{ value: ReactNode, label: string }> = ({ value, label }) => (
  <div className="flex flex-col gap-0.5">
    <span className="txt-title font-bold tabular-nums">{value}</span>
    <span className="txt-sub-content text-muted-foreground">{label}</span>
  </div>
);

/**
 * Null as soon as the newest sample stops standing for the present. The timer is armed for that instant
 * alone: it issues no read and re-arms only when the connector reports progress.
 */
const useStreamReadRate = (objectsRead: number, objectsReadAt: string | null, receivedAt: number): StreamReadRate | null => {
  // One state, never two: a rate outliving the sample it was measured from is what would leave a
  // retired stream's throughput on screen.
  const [sample, setSample] = useState<{ current: StreamReadSample, rate: StreamReadRate | null, receivedAt: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Guarded adjust-during-render, not an effect, which `react-hooks/set-state-in-effect` rejects.
  // `receivedAt` is the query's own stamp because the compiler refuses `Date.now()` during a render.
  if (objectsReadAt === null) {
    // A reset or a reconfigure throws this stamp away with the counters, so the next sample must be
    // a first sample again rather than a reading of the stream that is gone.
    if (sample !== null) {
      setSample(null);
    }
  } else if (sample === null || sample.current.objectsReadAt !== objectsReadAt) {
    const current = { objectsRead, objectsReadAt };
    setSample({ current, rate: sample === null ? null : streamReadRate(sample.current, current), receivedAt });
  }

  useEffect(() => {
    const remaining = msUntilStreamReadStale(sample?.receivedAt ?? null);
    if (remaining === null) {
      return undefined;
    }
    const timer = setTimeout(() => setNow(Date.now()), remaining);
    return () => clearTimeout(timer);
  }, [sample]);

  if (objectsReadAt === null || sample === null || isStreamReadStale(sample.receivedAt, now)) {
    return null;
  }
  return sample.rate;
};

const ThroughputFigures: FunctionComponent<{
  objectsRead: number,
  objectsReadAt: string | null,
  objectsHeld: number,
  receivedAt: number,
}> = ({ objectsRead, objectsReadAt, objectsHeld, receivedAt }) => {
  const rate = useStreamReadRate(objectsRead, objectsReadAt, receivedAt);
  // Absolute, not relative: nothing schedules a render once the rate is gone, so a relative age would
  // freeze on whatever it read at the last one.
  const lastRead = objectsReadAt === null ? null : formatDateTime(objectsReadAt);
  const rateValue = rate?.value ?? 0;
  return (
    <div className="flex flex-wrap items-baseline gap-x-10 gap-y-3">
      <Figure value={formatCompactCount(objectsRead)} label={t`Read from the stream`} />
      <Figure value={formatCompactCount(objectsHeld)} label={t`Held`} />
      {rate === null ? (
        <Figure
          value={<EmptyValue />}
          label={lastRead === null
            ? t`Nothing read yet`
            : i18n._({ id: 'Last read {lastRead}', message: 'Last read {lastRead}', values: { lastRead } })}
        />
      ) : (
        <Figure
          value={rate.unit === 'per-second'
            ? plural(rateValue, { one: '# object/s', other: '# objects/s' })
            : plural(rateValue, { one: '# object/min', other: '# objects/min' })}
          label={t`Reading`}
        />
      )}
    </div>
  );
};

/**
 * No refetch interval: every position the consumer persists rings the change doorbell the client already
 * listens to. Positions are written on an idle pause, not on each event, so a panel that has not moved
 * for a few seconds is not a stalled one.
 */
export const ConnectorStreamPanel: FunctionComponent<{ source: ConnectorSource }> = ({ source }) => {
  const trpc = useTRPC();
  // The reader refuses a connector backed by the queue, which reaches this tab only by address.
  const isStream = CONNECTOR_INVENTORY[source].jobKind === null;
  const hasManageSecurity = useHasManageSecurity();
  const { data: stream, dataUpdatedAt, isPending, error } = useQuery(trpc.connectors.getStreamState.queryOptions(
    { source },
    { enabled: isStream },
  ));
  if (!isStream) {
    return (
      <p className="txt-sub-content text-muted-foreground">
        <Trans>This connector runs as a job, and its work is listed on its Works tab.</Trans>
      </p>
    );
  }

  if (isPending) {
    return <Loader />;
  }

  if (error || !stream) {
    return (
      <p role="alert" className="txt-sub-content text-muted-foreground">
        <Trans>This stream's state could not be read.</Trans>
      </p>
    );
  }

  // Not `connection === 'not_configured'`, which also covers a stream this tenant did bind but whose
  // deployment credentials are missing: there, the state card is what the reader needs.
  if (stream.streamId === null && stream.missingCapability !== null) {
    const capability = stream.missingCapability;
    return (
      <p role="alert" className="txt-sub-content text-muted-foreground">
        {hasManageSecurity
          ? <Trans>OpenCRQ could not create its Live Stream in OpenCTI: the deployment's token lacks the {capability} capability. Grant it to that token's user and restart OpenCRQ, or press Configure to choose a stream.</Trans>
          : <Trans>OpenCRQ could not create its Live Stream in OpenCTI: the deployment's token lacks the {capability} capability.</Trans>}
      </p>
    );
  }

  if (stream.streamId === null) {
    return (
      <p className="txt-sub-content text-muted-foreground">
        {hasManageSecurity
          ? <Trans>No Live Stream is bound to this tenant yet. Press Configure to choose one.</Trans>
          : <Trans>No Live Stream is bound to this tenant yet.</Trans>}
      </p>
    );
  }

  const { backfillPercent, historyStartAt, backfillTargetAt } = stream;
  const hasBackfill = backfillPercent !== null && historyStartAt !== null && backfillTargetAt !== null;

  return (
    <div className="flex flex-col gap-6">
      <CatchingUpNotice shown={stream.connection === 'connected' && !stream.reachedLiveTail} />
      <SectionCard title={<Trans>Stream state</Trans>} contentClassName="grid grid-cols-2 gap-x-6 gap-y-5">
        <CardField title={t`Connection`}>
          <Chip
            severity={STREAM_CONNECTION_SEVERITY[stream.connection]}
            label={streamConnectionLabel(stream.connection)}
          />
        </CardField>
        {/* The stored id, not the stream's name: resolving the name means asking OpenCTI, and a
            panel that exists to say whether OpenCTI is reachable cannot depend on reaching it. */}
        <CardField title={t`Live Stream`}>
          {stream.streamId === null ? <EmptyValue /> : <span className="tabular-nums">{stream.streamId}</span>}
        </CardField>
        <CardField title={t`Cursor`}>
          {stream.cursor === null ? <EmptyValue /> : <span className="tabular-nums">{stream.cursor}</span>}
        </CardField>
        <DateField title={t`Last event`} instant={stream.lastEventAt} />
        <CardField title={t`Live tail`}>
          {stream.reachedLiveTail ? <Trans>Reached</Trans> : <Trans>Not reached</Trans>}
        </CardField>
        <div />
        {source === 'opencti' && (
          <CardField title={t`Stream filter`} className="col-span-2">
            <OpenctiConfiguredStream streamId={stream.streamId} />
          </CardField>
        )}
        <CardField title={hasBackfill ? t`Backfill` : t`Stream throughput`} className="col-span-2">
          <div className="flex flex-col gap-4">
            <ThroughputFigures
              objectsRead={stream.objectsRead}
              objectsReadAt={stream.objectsReadAt}
              objectsHeld={stream.objectsHeld}
              receivedAt={dataUpdatedAt}
            />
            {hasBackfill && (
              <div className="flex items-center gap-3">
                <span className="text-default-secondary">{formatDateTime(historyStartAt)}</span>
                <ProgressBar
                  value={backfillPercent}
                  size="lg"
                  className="flex-1"
                  aria-label={t`Backfill progress of the Live Stream`}
                />
                <span className="text-default-secondary">{formatDateTime(backfillTargetAt)}</span>
              </div>
            )}
          </div>
        </CardField>
      </SectionCard>
    </div>
  );
};
