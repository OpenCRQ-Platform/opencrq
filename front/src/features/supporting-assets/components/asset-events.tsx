import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { explainAssetPosture, postureBandForScore, postureSeverityBand } from '@app/module/client';
import { Link } from '@tanstack/react-router';
import { Ban, CircleDot, TrendingDown, TrendingUp } from 'lucide-react';
import type { FunctionComponent, ReactNode } from 'react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import type { PostureCause } from '../posture-lifeline-utils';
import type { AssetEvent, FindingInCause, FindingInCauseRole, PostureEvent, PostureEventKind } from '../posture-events-utils';
import { AuditLogTable, changePointsLabel, DisplayDrawer } from '../../../components/shared';
import { useTRPC } from '../../../lib';
import { cn, formatDateMinute } from '../../../utils';
import { EMPTY_VALUE } from '../../../utils/empty-value';
import { severityBandFigureColor } from '../../finding-score';
import { buildPostureEvents, findingsInCause, postureEventPoints } from '../posture-events-utils';
import { postureBandLabel } from './posture-band-word';
import { postureCauseDetail } from './posture-cause-sentence';
import { PostureReading } from './posture-reading';

interface AssetEventsProps {
  tenantId: string,
  supportingAssetId: string,
}

/** A higher posture is the safer one. */
const KIND_TONE: Record<PostureEventKind, string> = {
  rise: 'text-feedback-success-primary',
  fall: 'text-feedback-error-primary',
  lost: 'text-muted-foreground',
  first: 'text-feedback-info-primary',
  regained: 'text-feedback-info-primary',
};

const KindIcon: FunctionComponent<{ kind: PostureEventKind }> = ({ kind }) => {
  const icons: Record<PostureEventKind, ReactNode> = {
    rise: <TrendingUp className="size-4" />,
    fall: <TrendingDown className="size-4" />,
    lost: <Ban className="size-4" />,
    first: <CircleDot className="size-4" />,
    regained: <CircleDot className="size-4" />,
  };
  return (
    <span aria-hidden className={cn('flex size-8 shrink-0 items-center justify-center rounded-full bg-current/15', KIND_TONE[kind])}>
      {icons[kind]}
    </span>
  );
};

const postureEventTitle = (event: PostureEvent): string => {
  const { score } = event;
  const from = event.previous?.score ?? null;
  if (score === null) {
    return t`Posture lost.`;
  }
  if (from === null) {
    return event.kind === 'regained' ? t`Posture regained at ${score}.` : t`First posture: ${score}.`;
  }
  return t`Posture changed from ${from} to ${score}.`;
};

const postureEventCause = (event: PostureEvent): string | null => {
  if (event.kind !== 'lost') {
    return postureCauseDetail(event.cause);
  }
  const left = event.previous?.cause?.worstFinding ?? null;
  if (left === null) {
    return t`No applicable finding left.`;
  }
  const { name } = left;
  return t`No applicable finding left: ${name} resolved.`;
};

const PointsChip: FunctionComponent<{ event: PostureEvent }> = ({ event }) => {
  const points = postureEventPoints(event);
  if (points === null) {
    return null;
  }
  return (
    <span className={cn('rounded-sm bg-current/15 px-2 py-px txt-sub-content font-medium', KIND_TONE[event.kind])}>
      {changePointsLabel(points)}
    </span>
  );
};

const EventRow: FunctionComponent<{ event: AssetEvent }> = ({ event }) => {
  const cause = postureEventCause(event);
  return (
    <div className="flex items-center gap-4">
      <KindIcon kind={event.kind} />
      <span className="flex min-w-0 grow flex-col gap-0.5">
        <span className="flex items-center gap-2">
          {postureEventTitle(event)}
          <PointsChip event={event} />
        </span>
        {cause !== null && <span className="txt-sub-content text-muted-foreground">{cause}</span>}
      </span>
    </div>
  );
};

interface PostureSideProps {
  label: ReactNode,
  score: number | null,
  cause: PostureCause | null,
}

const PostureSide: FunctionComponent<PostureSideProps> = ({ label, score, cause }) => {
  const band = score === null ? null : postureBandForScore(score);
  const bandLabel = band === null ? null : postureBandLabel(band);
  const worst = cause?.worstFinding ?? null;
  return (
    <div className="flex flex-1 basis-0 flex-col gap-2 rounded-sm border border-[var(--fds-border-elevation-subtle)] bg-[var(--fds-bg-elevation-default-layer-2)] p-3">
      <span className="txt-sub-content font-semibold uppercase tracking-[var(--fds-tracking-relaxed)] text-muted-foreground">{label}</span>
      <span className="flex items-baseline gap-1.5">
        <span
          className="txt-title font-bold tabular-nums"
          style={band === null ? undefined : { color: severityBandFigureColor(postureSeverityBand(band)) }}
        >
          {score ?? EMPTY_VALUE}
        </span>
        {bandLabel !== null && <span className="txt-sub-content text-muted-foreground"><Trans>out of 100 · {bandLabel}</Trans></span>}
      </span>
      {score !== null && cause !== null && worst !== null && (
        <span className="txt-sub-content">
          <PostureReading
            name={worst.name}
            exploitability={cause.worstExploitability}
            countsByBand={cause.countsByBand}
            tailPoints={explainAssetPosture(cause.worstExploitability, cause.countsByBand).composition.tailPoints}
          />
        </span>
      )}
    </div>
  );
};

const ROLE_TONE: Record<FindingInCauseRole, string> = {
  resolved: 'text-feedback-success-primary',
  newWorst: 'text-feedback-warning-primary',
  worst: 'text-muted-foreground',
};

const roleLabel = (role: FindingInCauseRole): string => {
  const labels: Record<FindingInCauseRole, string> = {
    resolved: t`Resolved`,
    newWorst: t`New worst`,
    worst: t`Worst`,
  };
  return labels[role];
};

const FindingInCauseRow: FunctionComponent<{ tenantId: string, finding: FindingInCause }> = ({ tenantId, finding }) => (
  <div className="flex items-center gap-3 py-2.5 not-first:border-t not-first:border-[var(--fds-border-elevation-subtle)]">
    <span className={cn('whitespace-nowrap rounded-sm bg-current/15 px-2 py-px txt-sub-content', ROLE_TONE[finding.role])}>
      {roleLabel(finding.role)}
    </span>
    <Link
      to="/$tenantId/{-$organizationId}/findings/$evidenceId"
      params={{ tenantId, evidenceId: finding.evidenceId }}
      className="min-w-0 grow truncate text-primary underline-offset-4 hover:underline"
    >
      {finding.name}
    </Link>
    <span className="flex flex-col items-end gap-0.5">
      <span className="font-semibold tabular-nums">
        {finding.from === null ? finding.exploitability : `${finding.from} → ${finding.exploitability}`}
      </span>
      <span className="txt-mini text-muted-foreground"><Trans>Exploitability</Trans></span>
    </span>
  </div>
);

const EventDetail: FunctionComponent<{ tenantId: string, event: AssetEvent }> = ({ tenantId, event }) => {
  const findings = findingsInCause(event);
  return (
    <div className="mt-4 flex flex-col gap-6 px-1">
      <div className="flex items-center justify-between">
        <span className="txt-sub-content text-muted-foreground">{formatDateMinute(event.at)}</span>
        <PointsChip event={event} />
      </div>
      <div className="flex gap-3">
        {event.previous !== null && <PostureSide label={<Trans>Before</Trans>} score={event.previous.score} cause={event.previous.cause} />}
        <PostureSide label={<Trans>After</Trans>} score={event.score} cause={event.cause} />
      </div>
      {findings.length > 0 && (
        <section className="flex flex-col gap-1">
          <h3 className="txt-subtitle2"><Trans>Findings in cause</Trans></h3>
          <div className="flex flex-col">
            {findings.map((finding) => <FindingInCauseRow key={`${finding.role}-${finding.evidenceId}`} tenantId={tenantId} finding={finding} />)}
          </div>
        </section>
      )}
    </div>
  );
};

export const AssetEvents: FunctionComponent<AssetEventsProps> = ({ tenantId, supportingAssetId }) => {
  const trpc = useTRPC();
  const [selected, setSelected] = useState<AssetEvent | null>(null);
  // Frozen on mount: reading the clock during render is impure.
  const [now] = useState(() => new Date());
  const { data: lines, isError } = useQuery(trpc.findingScore.getAssetPostureHistory.queryOptions({ supportingAssetId }));

  if (lines === undefined) {
    return isError
      ? <p className="text-muted-foreground"><Trans>The posture history could not be loaded.</Trans></p>
      : <p className="text-muted-foreground"><Trans>Loading history…</Trans></p>;
  }

  const events = buildPostureEvents(lines, now);
  if (events.length === 0) {
    return <p className="text-muted-foreground"><Trans>No history yet.</Trans></p>;
  }

  const columns: Array<ColumnDefWithOptionsHeader<AssetEvent, unknown>> = [
    { id: 'event', cell: ({ row }) => <EventRow event={row.original} /> },
    {
      id: 'at',
      cell: ({ row }) => <p className="whitespace-nowrap txt-sub-content text-right text-muted-foreground">{formatDateMinute(row.original.at)}</p>,
    },
  ];

  return (
    <>
      <AuditLogTable
        data={events}
        columns={columns}
        title={<Trans>Events</Trans>}
        headerActions={(
          <span className="txt-sub-content text-muted-foreground">
            {plural(events.length, { one: '# event', other: '# events' })}
          </span>
        )}
        onClickRow={(row) => setSelected(row.original)}
      />

      {selected !== null && (
        <DisplayDrawer
          open
          onClose={() => setSelected(null)}
          category={<Trans>Event</Trans>}
          title={postureEventTitle(selected)}
        >
          <EventDetail tenantId={tenantId} event={selected} />
        </DisplayDrawer>
      )}
    </>
  );
};
