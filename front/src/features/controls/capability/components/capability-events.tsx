import { useState } from 'react';
import type { FunctionComponent, ReactNode } from 'react';
import type { ColumnDefWithOptionsHeader } from '../../../../components/ui/data-table-types';
import { Chip } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { useParams } from '@tanstack/react-router';
import { Trans } from '@lingui/react/macro';
import { Pencil, Plus } from 'lucide-react';
import type { CapabilityEvent } from '../types/capability';
import { COVERAGE_BUCKETS, DERIVATION_WRITER, STRENGTH_RUNGS } from '@app/module/client';
import { useQuery } from '@tanstack/react-query';
import { AuditLogTable, DisplayDrawer } from '../../../../components/shared';
import { useTRPC } from '../../../../lib';
import { formatDateTime } from '../../../../utils';
import { UserAvatar } from '../../../../components/ui/user-avatar';
import { capabilityEventHeadline, capabilityEventSentence } from '../utils/capability-event-sentence';
import { eventAxisMoves } from '../utils/capability-event-utils';
import { AxisMovePill } from '../ui/axis-move-pill';
import { eventSourceNamesByAxis, joinSourceNames } from '../utils/assessment-axes-utils';
import { formatConnectorName } from '../utils/connector-name';
import { CoverageBadge } from '../ui/coverage-badge';
import { StrengthBadge } from '../ui/strength-badge';
import { CoverageChangeBadges } from '../ui/coverage-change-badges';
import { StrengthChangeBadges } from '../ui/strength-change-badges';

interface CapabilityEventsProps {
  capabilityId: string,
}

// A scope line stores null for an axis the scope does not declare, so its type says less than its
// values: the first declaration of one axis is an `assessment_set` that leaves the other null.
const isScopeEvent = (event: CapabilityEvent) => event.organizationId !== null;

const showsStrength = (event: CapabilityEvent) => (isScopeEvent(event)
  ? event.oldStrength !== event.newStrength
  : event.type === 'strength_change' || event.type === 'assessment_set' || event.type === 'assessment_change');
const showsCoverage = (event: CapabilityEvent) => (isScopeEvent(event)
  ? event.oldCoverage !== event.newCoverage
  : event.type === 'coverage_change' || event.type === 'assessment_set' || event.type === 'assessment_change');

const Inherited = () => <span className="txt-sub-content text-muted-foreground"><Trans>Inherited from the tenant</Trans></span>;

const ScopeAxisChange = ({ from, to }: { from: ReactNode, to: ReactNode }) => (
  <div className="flex items-center gap-x-2">
    {from}
    <span className="text-muted-foreground txt-sub-content">→</span>
    {to}
  </div>
);

const EventSources = ({ sources }: { sources: CapabilityEvent['sources'] }) => {
  const byAxis = eventSourceNamesByAxis(sources);
  if (byAxis.length === 0) {
    return null;
  }
  return (
    <div className="space-y-1">
      <p className="txt-sub-content"><Trans>Sources</Trans></p>
      {byAxis.map(({ axis, names: axisNames }) => {
        // In French, joinSourceNames only reads after "de", which "derived from" ends in.
        const names = joinSourceNames(axisNames);
        return (
          <p key={axis}>
            {axis === 'strength' ? <Trans>Strength derived from {names}</Trans> : <Trans>Coverage derived from {names}</Trans>}
          </p>
        );
      })}
    </div>
  );
};

const EventContent = ({ event }: { event: CapabilityEvent }) => (
  <div className="space-y-4">
    {showsStrength(event) && (
      <div className="space-y-2">
        <p className="txt-sub-content"><Trans>Strength</Trans></p>
        {isScopeEvent(event)
          ? (
            <ScopeAxisChange
              from={event.oldStrength === null ? <Inherited /> : <StrengthBadge value={event.oldStrength} />}
              to={event.newStrength === null ? <Inherited /> : <StrengthBadge value={event.newStrength} />}
            />
          )
          : <StrengthChangeBadges oldValue={event.oldStrength} newValue={event.newStrength} />}
      </div>
    )}
    {showsCoverage(event) && (
      <div className="space-y-2">
        <p className="txt-sub-content"><Trans>Coverage</Trans></p>
        {isScopeEvent(event)
          ? (
            <ScopeAxisChange
              from={event.oldCoverage === null ? <Inherited /> : <CoverageBadge value={event.oldCoverage} />}
              to={event.newCoverage === null ? <Inherited /> : <CoverageBadge value={event.newCoverage} />}
            />
          )
          : <CoverageChangeBadges oldValue={event.oldCoverage} newValue={event.newCoverage} />}
      </div>
    )}
    <EventSources sources={event.sources} />
    {event.comment && (
      <div>
        <p className="txt-sub-content"><Trans>Comment</Trans></p>
        <p className="mt-1 italic">"{event.comment}"</p>
      </div>
    )}
  </div>
);

const EventIcon = ({ event }: { event: CapabilityEvent }) => {
  const { type, oldStrength, newStrength, oldCoverage, newCoverage } = event;
  let Icon = <Pencil className="h-2.5 w-2.5" />;
  let borderColor = 'border-green-500';
  if (type === 'assessment_set') {
    Icon = <Plus className="h-2.5 w-2.5" />;
  } else if (isScopeEvent(event)) {
    // A null side is the tenant's value, not the undeclared default, so only a move between two declared values has a direction.
    const strengthDown = oldStrength !== null && newStrength !== null && STRENGTH_RUNGS.indexOf(newStrength) < STRENGTH_RUNGS.indexOf(oldStrength);
    const coverageDown = oldCoverage !== null && newCoverage !== null && COVERAGE_BUCKETS.indexOf(newCoverage) < COVERAGE_BUCKETS.indexOf(oldCoverage);
    if (strengthDown || coverageDown) {
      borderColor = 'border-destructive';
    }
  } else {
    // Any risk-increasing rollback (strength or coverage lowered) is painted destructive,
    // including a combined change that moves one axis down.
    const strengthDiff = STRENGTH_RUNGS.indexOf(newStrength ?? 'L0') - STRENGTH_RUNGS.indexOf(oldStrength ?? 'L0');
    const coverageDiff = COVERAGE_BUCKETS.indexOf(newCoverage ?? 'L0') - COVERAGE_BUCKETS.indexOf(oldCoverage ?? 'L0');
    if (strengthDiff < 0 || coverageDiff < 0) {
      borderColor = 'border-destructive';
    }
  }
  return (
    <div className={`shrink-0 p-2 rounded-full border ${borderColor}`}>
      {Icon}
    </div>
  );
};

const EventLevelTag = ({ event }: { event: CapabilityEvent }) => (
  (event.organizationId === null
    ? <Chip label={t`tenant`} />
    : <Chip severity="info" label={t`scope`} />)
);

const EventAuthor = ({ event }: { event: CapabilityEvent }) => (
  <>
    {event.userId !== null && <UserAvatar name={event.userName} />}
    {event.connector !== null && <Chip label={event.connector === DERIVATION_WRITER ? t`Derivation` : formatConnectorName(event.connector)} />}
    {/* `user_id` is set null when the user is deleted, and a null connector means a user wrote the line. */}
    {event.userId === null && event.connector === null && <span className="txt-sub-content text-muted-foreground">{t`Deleted user`}</span>}
  </>
);

export const CapabilityEvents: FunctionComponent<CapabilityEventsProps> = ({ capabilityId }) => {
  const trpc = useTRPC();
  const [selectedEvent, setSelectedEvent] = useState<CapabilityEvent | null>(null);
  const { organizationId } = useParams({ strict: false });
  const inScope = organizationId !== undefined;
  const columns: Array<ColumnDefWithOptionsHeader<CapabilityEvent, unknown>> = [
    {
      id: 'name',
      cell: ({ row }) => {
        const event = row.original;
        const moves = eventAxisMoves(event);
        return (
          <div className="flex items-start gap-3 py-3">
            <EventIcon event={event} />
            <div className="flex min-w-0 grow flex-col gap-2">
              <div className="flex min-h-7 flex-wrap items-center gap-2">
                {inScope && <EventAuthor event={event} />}
                <p>{moves.length === 0 ? capabilityEventSentence(event) : capabilityEventHeadline(event)}</p>
                {inScope && <EventLevelTag event={event} />}
              </div>
              {moves.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {moves.map((move) => <AxisMovePill key={move.axis} move={move} inScope={isScopeEvent(event)} />)}
                </div>
              )}
              {event.comment && <p className="txt-sub-content italic text-muted-foreground">"{event.comment}"</p>}
            </div>
          </div>
        );
      },
    },
    {
      id: 'createdAt',
      cell: ({ row }) => {
        const event = row.original;
        return (
          <div className="py-3">
            <p className="flex h-7 items-center justify-end whitespace-nowrap txt-sub-content text-muted-foreground">
              {formatDateTime(event.createdAt)}
            </p>
          </div>
        );
      },
    },
  ];
  const { data: events, isLoading } = useQuery(trpc.controlCapabilities.getCapabilityEvents.queryOptions({
    capabilityId,
    organizationId,
  }));

  if (isLoading) {
    return <p className="text-muted-foreground"><Trans>Loading history…</Trans></p>;
  }

  if (!events || events.length === 0) {
    return <p className="text-muted-foreground"><Trans>No history yet. Changes will appear here after the first save.</Trans></p>;
  }

  return (
    <>
      <div className="[&_td]:align-top!">
        <AuditLogTable
          data={events}
          columns={columns}
          title={<Trans>Events</Trans>}
          onClickRow={(row) => setSelectedEvent(row.original)}
        />
      </div>

      {selectedEvent && (
        <DisplayDrawer
          open
          onClose={() => setSelectedEvent(null)}
          category={<Trans>Event</Trans>}
          title={capabilityEventSentence(selectedEvent)}
        >
          <div className="mt-4 space-y-4 px-1">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <EventAuthor event={selectedEvent} />
                {inScope && <EventLevelTag event={selectedEvent} />}
              </span>
              <p className="txt-sub-content text-muted-foreground">
                {formatDateTime(selectedEvent.createdAt)}
              </p>
            </div>
            <EventContent event={selectedEvent} />
          </div>
        </DisplayDrawer>
      )}
    </>
  );
};
