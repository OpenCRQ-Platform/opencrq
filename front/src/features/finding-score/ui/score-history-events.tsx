import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { CircleDot, MoveRight, TrendingDown, TrendingUp } from 'lucide-react';
import type { FunctionComponent, ReactNode } from 'react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import type { ScoreEvent, ScoreEventKind } from '../score-history-utils';
import { AuditLogTable } from '../../../components/shared/audit-log-table';
import { changePointsLabel } from '../../../components/shared/change-points-label';
import { useTRPC } from '../../../lib';
import { cn, formatDateMinute } from '../../../utils';
import { buildScoreEvents, scoreEventBandMove, scoreEventPoints } from '../score-history-utils';
import { bandMoveSentence } from './score-history-lifeline';
import { severityBandLabel } from './severity-ramp';

/** A higher score is the worse one, the reverse of an asset's posture. */
const KIND_TONE: Record<ScoreEventKind, string> = {
  rise: 'text-feedback-error-primary',
  fall: 'text-feedback-success-primary',
  first: 'text-feedback-info-primary',
  held: 'text-muted-foreground',
};

const KindIcon: FunctionComponent<{ kind: ScoreEventKind }> = ({ kind }) => {
  const icons: Record<ScoreEventKind, ReactNode> = {
    rise: <TrendingUp className="size-4" />,
    fall: <TrendingDown className="size-4" />,
    first: <CircleDot className="size-4" />,
    held: <MoveRight className="size-4" />,
  };
  return (
    <span aria-hidden className={cn('flex size-8 shrink-0 items-center justify-center rounded-full bg-current/15', KIND_TONE[kind])}>
      {icons[kind]}
    </span>
  );
};

const eventTitle = (event: ScoreEvent): string => {
  const { score } = event;
  if (event.previous === null) {
    return t`First score: ${score}.`;
  }
  if (event.kind === 'held') {
    return t`Score held at ${score}.`;
  }
  const from = event.previous.score;
  return t`Score moved from ${from} to ${score}.`;
};

/** Null on a move inside a band: the journal keeps no cause to name. */
const eventDetail = (event: ScoreEvent): string | null => {
  if (event.previous === null) {
    const bandWord = severityBandLabel(event.band);
    return t`Band ${bandWord}.`;
  }
  const bandMove = scoreEventBandMove(event);
  return bandMove === null ? null : bandMoveSentence(bandMove);
};

const PointsChip: FunctionComponent<{ event: ScoreEvent }> = ({ event }) => {
  const points = scoreEventPoints(event);
  if (points === null) {
    return null;
  }
  return (
    <span className={cn('rounded-sm bg-current/15 px-2 py-px txt-sub-content font-medium', KIND_TONE[event.kind])}>
      {changePointsLabel(points)}
    </span>
  );
};

const EventRow: FunctionComponent<{ event: ScoreEvent }> = ({ event }) => {
  const detail = eventDetail(event);
  return (
    <div className="flex items-center gap-4">
      <KindIcon kind={event.kind} />
      <span className="flex min-w-0 grow flex-col gap-0.5">
        <span className="flex items-center gap-2">
          {eventTitle(event)}
          <PointsChip event={event} />
        </span>
        {detail !== null && <span className="txt-sub-content text-muted-foreground">{detail}</span>}
      </span>
    </div>
  );
};

/** Every move of a finding's score over the journal's twelve months. A row opens nothing: it already says it all. */
export const ScoreHistoryEvents: FunctionComponent<{ evidenceId: string }> = ({ evidenceId }) => {
  const trpc = useTRPC();
  // Frozen on mount: reading the clock during render is impure.
  const [now] = useState(() => new Date());
  const { data: lines, isError } = useQuery(trpc.findingScore.getFindingScoreHistory.queryOptions({ evidenceId }));

  if (lines === undefined) {
    return isError
      ? <p className="text-muted-foreground"><Trans>The score history could not be loaded.</Trans></p>
      : <p className="text-muted-foreground"><Trans>Loading history…</Trans></p>;
  }

  const events = buildScoreEvents(lines, now);
  if (events.length === 0) {
    return <p className="text-muted-foreground"><Trans>No history yet.</Trans></p>;
  }

  const columns: Array<ColumnDefWithOptionsHeader<ScoreEvent, unknown>> = [
    { id: 'event', cell: ({ row }) => <EventRow event={row.original} /> },
    {
      id: 'at',
      cell: ({ row }) => <p className="whitespace-nowrap txt-sub-content text-right text-muted-foreground">{formatDateMinute(row.original.at)}</p>,
    },
  ];

  return (
    <AuditLogTable
      data={events}
      columns={columns}
      title={<Trans>Events</Trans>}
      headerActions={(
        <span className="txt-sub-content text-muted-foreground">
          {plural(events.length, { one: '# event', other: '# events' })}
        </span>
      )}
    />
  );
};
