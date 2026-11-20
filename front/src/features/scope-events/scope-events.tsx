import type { AssetMappingChange, EstateMode } from '@app/module/client';
import { Chip } from '@filigran/design-system';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Minus, Pencil, Plus } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDefWithOptionsHeader } from '../../components/ui/data-table-types';
import type { DeclaredEstateMove, DeclaredEstateState } from '../declared-estate/declared-estate-utils';
import type { ScopeEventSource, ScopeEventType } from './scope-events-utils';
import { AuditLogTable, DisplayDrawer } from '../../components/shared';
import { AssetName } from '../../components/shared/asset-name';
import { UserAvatar } from '../../components/ui/user-avatar';
import { useTRPC } from '../../lib';
import { formatDateTime } from '../../utils/date-utils';
import { declaredEstateAnswerLabel, declaredEstateExposureLabel, declaredEstateKindLabel } from '../declared-estate/declared-estate-labels';
import { answerShapeOf, eventMovesOf, eventTypeOf } from '../declared-estate/declared-estate-utils';
import {
  estateModeLabel,
  financialFieldLabel,
  financialValueLabel,
  identityFieldLabel,
  identityValueLabel,
  scopeEventSourceLabel,
} from './scope-event-labels';
import { deletedSinceCount, mappingEventTypeOf, mergeScopeEvents, valueEventTypeOf } from './scope-events-utils';

interface ScopeEventMove {
  label: string,
  from: string,
  to: string,
}

interface ScopeEventRow {
  id: string,
  source: ScopeEventSource,
  type: ScopeEventType,
  title: string,
  moves: Array<ScopeEventMove>,
  counts: Array<string>,
  createdAt: Date | string,
  userName: string | null,
  mapping: { addedCount: number, removedCount: number } | null,
}

const declaredEstateMove = (move: DeclaredEstateMove, before: DeclaredEstateState, after: DeclaredEstateState): ScopeEventMove => (move === 'count'
  ? { label: t`Count`, from: declaredEstateAnswerLabel(answerShapeOf(before.bounds)), to: declaredEstateAnswerLabel(answerShapeOf(after.bounds)) }
  : { label: t`Reachable from the Internet`, from: declaredEstateExposureLabel(before.internetFacing), to: declaredEstateExposureLabel(after.internetFacing) });

const mappingCounts = (addedCount: number, removedCount: number): Array<string> => [
  ...(addedCount > 0 ? [plural(addedCount, { one: '# asset added', other: '# assets added' })] : []),
  ...(removedCount > 0 ? [plural(removedCount, { one: '# asset removed', other: '# assets removed' })] : []),
];

const estateModeMove = (estateMode: { from: EstateMode, to: EstateMode } | null): Array<ScopeEventMove> => (estateMode === null
  ? []
  : [{ label: t`Estate measured`, from: estateModeLabel(estateMode.from), to: estateModeLabel(estateMode.to) }]);

const useScopeEventRows = (organizationId: string): { rows: Array<ScopeEventRow>, isLoading: boolean } => {
  const trpc = useTRPC();
  const input = { organizationId };
  const declaredEstate = useQuery(trpc.declaredEstate.history.queryOptions(input));
  const financialProfile = useQuery(trpc.financialProfiles.getFinancialProfileHistory.queryOptions(input));
  const identity = useQuery(trpc.organizations.getIdentityHistory.queryOptions(input));
  const assets = useQuery(trpc.organizations.getAssetMappingHistory.queryOptions(input));
  const { data: sectors } = useQuery(trpc.sectors.getSectors.queryOptions());
  const { data: countries } = useQuery(trpc.countries.getCountries.queryOptions());
  const namesById = new Map([...(sectors ?? []), ...(countries ?? [])].map((row) => [row.id, row.name]));

  const rows = mergeScopeEvents<ScopeEventRow>(
    (declaredEstate.data ?? []).map((event) => ({
      id: event.id,
      source: 'declaredEstate',
      type: eventTypeOf(event.before, event.after),
      title: declaredEstateKindLabel(event.kind),
      moves: eventMovesOf(event.before, event.after).map((move) => declaredEstateMove(move, event.before, event.after)),
      counts: [],
      createdAt: event.createdAt,
      userName: event.userName,
      mapping: null,
    })),
    (financialProfile.data ?? []).map((event) => ({
      id: event.id,
      source: 'financialProfile',
      type: valueEventTypeOf(event.before, event.after),
      title: financialFieldLabel(event.field),
      moves: [{ label: t`Answer`, from: financialValueLabel(event.field, event.before), to: financialValueLabel(event.field, event.after) }],
      counts: [],
      createdAt: event.createdAt,
      userName: event.userName,
      mapping: null,
    })),
    (identity.data ?? []).map((event) => ({
      id: event.id,
      source: 'identity',
      type: valueEventTypeOf(event.before, event.after),
      title: identityFieldLabel(event.field),
      moves: [{ label: t`Value`, from: identityValueLabel(event.field, event.before, namesById), to: identityValueLabel(event.field, event.after, namesById) }],
      counts: [],
      createdAt: event.createdAt,
      userName: event.userName,
      mapping: null,
    })),
    (assets.data ?? []).map((event) => ({
      id: event.id,
      source: 'assets',
      type: mappingEventTypeOf(event),
      title: t`Mapped assets`,
      moves: estateModeMove(event.estateMode),
      counts: mappingCounts(event.addedCount, event.removedCount),
      createdAt: event.createdAt,
      userName: event.userName,
      mapping: { addedCount: event.addedCount, removedCount: event.removedCount },
    })),
  );
  return { rows, isLoading: declaredEstate.isLoading || financialProfile.isLoading || identity.isLoading || assets.isLoading };
};

const EventIcon: FunctionComponent<{ type: ScopeEventType }> = ({ type }) => {
  if (type === 'clear') {
    return <div className="shrink-0 rounded-full border border-muted-foreground p-2"><Minus className="h-2.5 w-2.5" /></div>;
  }
  return (
    <div className="shrink-0 rounded-full border border-green-500 p-2">
      {type === 'set' ? <Plus className="h-2.5 w-2.5" /> : <Pencil className="h-2.5 w-2.5" />}
    </div>
  );
};

const EventAuthor: FunctionComponent<{ userName: string | null }> = ({ userName }) => (userName === null
  ? <span className="txt-sub-content text-muted-foreground">{t`Unknown user`}</span>
  : <UserAvatar name={userName} />);

const SourceChip: FunctionComponent<{ source: ScopeEventSource }> = ({ source }) => <Chip severity="info" label={scopeEventSourceLabel(source)} />;

const pillClassName = 'inline-flex flex-wrap items-center gap-1.5 rounded-full border border-elevation-subtle-soft px-2.5 py-0.5 txt-sub-content';

const MovePill: FunctionComponent<{ move: ScopeEventMove }> = ({ move }) => {
  const { label, from, to } = move;
  return (
    <span className={pillClassName}>
      <span className="text-muted-foreground"><Trans>{label}: {from} → <strong>{to}</strong></Trans></span>
    </span>
  );
};

const MoveDetail: FunctionComponent<{ move: ScopeEventMove }> = ({ move }) => (
  <div className="space-y-2">
    <p className="txt-sub-content">{move.label}</p>
    <div className="flex flex-wrap items-center gap-x-2">
      <Chip label={move.from} />
      <span className="txt-sub-content text-muted-foreground">→</span>
      <Chip severity="info" label={move.to} />
    </div>
  </div>
);

const AssetList: FunctionComponent<{ title: string, assets: ReadonlyArray<{ id: string, name: string | null, derivedName: string | null }> }> = ({ title, assets }) => (assets.length === 0
  ? null
  : (
    <div className="space-y-2">
      <p className="txt-sub-content">{title}</p>
      <ul className="space-y-1">
        {assets.map((asset) => <li key={asset.id}><AssetName name={asset.name} derivedName={asset.derivedName} /></li>)}
      </ul>
    </div>
  ));

const MappingDetail: FunctionComponent<{ eventId: string, mapping: { addedCount: number, removedCount: number } }> = ({ eventId, mapping }) => {
  const trpc = useTRPC();
  const { data: assets, isLoading } = useQuery(trpc.organizations.getAssetMappingEventAssets.queryOptions({ eventId }));
  if (isLoading || assets === undefined) {
    return <p className="text-muted-foreground"><Trans>Loading assets…</Trans></p>;
  }
  const ofChange = (change: AssetMappingChange) => assets.filter((asset) => asset.change === change);
  const deletedSince = deletedSinceCount(mapping, assets.length);
  return (
    <>
      <AssetList title={t`Assets added`} assets={ofChange('added')} />
      <AssetList title={t`Assets removed`} assets={ofChange('removed')} />
      {deletedSince > 0 && (
        <p className="txt-sub-content text-muted-foreground">
          {plural(deletedSince, { one: '# asset deleted since is no longer listed.', other: '# assets deleted since are no longer listed.' })}
        </p>
      )}
    </>
  );
};

const EventDetail: FunctionComponent<{ event: ScopeEventRow }> = ({ event }) => (
  <div className="mt-4 space-y-4 px-1">
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-2">
        <EventAuthor userName={event.userName} />
        <SourceChip source={event.source} />
      </span>
      <p className="txt-sub-content text-muted-foreground">{formatDateTime(event.createdAt)}</p>
    </div>
    {event.moves.map((move) => <MoveDetail key={move.label} move={move} />)}
    {event.mapping !== null && <MappingDetail eventId={event.id} mapping={event.mapping} />}
  </div>
);

export const ScopeEvents: FunctionComponent<{ organizationId: string }> = ({ organizationId }) => {
  const [selected, setSelected] = useState<ScopeEventRow | null>(null);
  const { rows, isLoading } = useScopeEventRows(organizationId);

  const columns: Array<ColumnDefWithOptionsHeader<ScopeEventRow, unknown>> = [
    {
      id: 'name',
      cell: ({ row }) => {
        const event = row.original;
        return (
          <div className="flex items-start gap-3 py-3">
            <EventIcon type={event.type} />
            <div className="flex min-w-0 grow flex-col gap-2">
              <div className="flex min-h-7 flex-wrap items-center gap-2">
                <EventAuthor userName={event.userName} />
                <p className="font-semibold">{event.title}</p>
                <SourceChip source={event.source} />
              </div>
              <div className="flex flex-wrap gap-2">
                {event.counts.map((count) => <span key={count} className={pillClassName}>{count}</span>)}
                {event.moves.map((move) => <MovePill key={move.label} move={move} />)}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      id: 'createdAt',
      cell: ({ row }) => (
        <div className="py-3">
          <p className="flex h-7 items-center justify-end whitespace-nowrap txt-sub-content text-muted-foreground">
            {formatDateTime(row.original.createdAt)}
          </p>
        </div>
      ),
    },
  ];

  if (isLoading) {
    return <p className="text-muted-foreground"><Trans>Loading history…</Trans></p>;
  }

  if (rows.length === 0) {
    return <p className="text-muted-foreground"><Trans>No history yet. Changes will appear here after the first save.</Trans></p>;
  }

  return (
    <>
      <div className="[&_td]:align-top!">
        <AuditLogTable
          data={rows}
          columns={columns}
          title={<Trans>Events</Trans>}
          onClickRow={(row) => setSelected(row.original)}
        />
      </div>
      {selected && (
        <DisplayDrawer
          open
          onClose={() => setSelected(null)}
          category={<Trans>Event</Trans>}
          title={selected.title}
        >
          <EventDetail event={selected} />
        </DisplayDrawer>
      )}
    </>
  );
};
