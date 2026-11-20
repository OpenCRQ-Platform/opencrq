import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { DismissalReasonCode, DismissalType, EvidenceHistoryOrigin } from '@app/module/client';
import { Pencil, Plus } from 'lucide-react';
import type { FunctionComponent } from 'react';
import type { FlawKind } from '../../finding-detail/dismissal-vocabulary';
import type { CauseFacts } from '../../finding-detail/finding-cause-utils';
import { dismissalReasonLabel, dismissalTypeLabel } from '../../finding-detail/dismissal-vocabulary';
import { causeFacts, dismissalCause } from '../../finding-detail/finding-cause-utils';
import { formatDate } from '../../../utils';

export interface FindingHistoryEntry {
  id: string,
  stateChangedAt: Date | string,
  /** When the test behind a sync row was made, before `stateChangedAt` when its result arrived late. */
  observedAt?: Date | string | null,
  state: string,
  reason: string | null,
  dismissalType?: DismissalType | null,
  dismissalReasonCode?: DismissalReasonCode | null,
  changedByUserId: string | null,
  changedByUserName: string | null,
  /** Why the finding is in that state, which a null author cannot tell: a sync's and a resync's rows share one. */
  origin: EvidenceHistoryOrigin,
}

export interface HistoryRowDescription {
  facts: CauseFacts,
  title: string,
  /** The person or connector the row is credited to. */
  actor: string,
  /** When the test behind the row was made, when a sync delivered its result on a later day. */
  testedAt: Date | null,
}

export const HistoryEntryIcon: FunctionComponent<{ state: string, isFirst: boolean }> = ({ state, isFirst }) => {
  const borderColor = state === 'applicable' ? 'border-green-500' : 'border-destructive';
  const Icon = isFirst ? <Plus className="h-2.5 w-2.5" /> : <Pencil className="h-2.5 w-2.5" />;
  return <div className={`p-2 rounded-full border ${borderColor}`}>{Icon}</div>;
};

/**
 * A sync's row. A connector's first row after a handover confirms the state the person handed back
 * when it agrees, and a CVE a connector reports again after its retirement confirms it, since a CVE
 * reads as no longer reported either way.
 */
const syncTitle = (entry: FindingHistoryEntry, facts: CauseFacts, previousEntry: FindingHistoryEntry | null, kind: FlawKind): string => {
  const previousFacts = previousEntry === null ? null : causeFacts(previousEntry.origin);
  const handedBackAs = previousFacts?.handover ? previousEntry?.state : null;
  if (entry.state === 'applicable') {
    if (previousEntry === null) {
      return t`Finding reported as applicable.`;
    }
    return handedBackAs === 'applicable' ? t`Connector confirmed the state (applicable).` : t`State changed to applicable.`;
  }
  if (facts.retirement) {
    return t`No longer reported by any connector.`;
  }
  const notReported = dismissalCause(kind, entry.origin) === 'no_longer_reported';
  if (handedBackAs === 'dismissed' || (notReported && previousFacts?.retirement)) {
    return notReported ? t`Connector confirmed the state (no longer reported).` : t`Connector confirmed the state (not exposed).`;
  }
  if (notReported) {
    return t`No longer reported by any connector.`;
  }
  return previousEntry === null ? t`Finding reported as not exposed.` : t`State changed to not exposed.`;
};

/**
 * What a transition says. A set-aside row reports the type and the reason it was filed under,
 * because that pair is the whole of what distinguishes an accepted risk from a false positive. A
 * sync's dismissal is no one's decision and never reads as set aside.
 */
const historyTitle = (entry: FindingHistoryEntry, facts: CauseFacts, previousEntry: FindingHistoryEntry | null, kind: FlawKind): string => {
  if (facts.bySync) {
    return syncTitle(entry, facts, previousEntry, kind);
  }
  if (entry.state === 'dismissed' && entry.dismissalType != null) {
    const type = dismissalTypeLabel(entry.dismissalType);
    if (entry.dismissalReasonCode == null) {
      return t`Set aside as ${type}.`;
    }
    const reason = dismissalReasonLabel(entry.dismissalReasonCode);
    return t`Set aside as ${type}: ${reason}.`;
  }
  if (facts.handover) {
    return entry.state === 'applicable'
      ? t`State resynced with the connector (applicable).`
      : t`State resynced with the connector (set aside).`;
  }
  if (previousEntry === null) {
    return entry.state === 'applicable'
      ? t`Finding marked as applicable by user.`
      : t`Finding set aside by user.`;
  }
  return entry.state === 'applicable'
    ? t`State changed to applicable by user.`
    : t`Finding set aside by user.`;
};

/**
 * Who wrote a transition, read off the cause and never off the author: the author FK is cleared
 * when an account is deleted, so a person's decision would otherwise be credited to the connector.
 * A resync taken before the initiator was recorded leaves no name at all.
 */
const historyActor = (entry: FindingHistoryEntry, facts: CauseFacts, connectorName: string): string => {
  if (facts.bySync) {
    return connectorName;
  }
  if (entry.changedByUserName !== null) {
    return entry.changedByUserName;
  }
  return facts.decision ? t`Deleted user` : t`Unknown user`;
};

const calendarDay = (value: Date | string): string => new Date(value).toDateString();

/** A retirement is dated by the run that left the finding out, which tested nothing. */
const historyTestedAt = (entry: FindingHistoryEntry, facts: CauseFacts): Date | null => {
  if (!facts.byTest || entry.observedAt == null || calendarDay(entry.observedAt) === calendarDay(entry.stateChangedAt)) {
    return null;
  }
  return new Date(entry.observedAt);
};

/** Everything a history surface shows of one row, read off its cause in one place. */
export const describeHistoryRow = (
  entry: FindingHistoryEntry,
  previousEntry: FindingHistoryEntry | null,
  { kind, connectorName }: { kind: FlawKind, connectorName: string },
): HistoryRowDescription => {
  const facts = causeFacts(entry.origin);
  return {
    facts,
    title: historyTitle(entry, facts, previousEntry, kind),
    actor: historyActor(entry, facts, connectorName),
    testedAt: historyTestedAt(entry, facts),
  };
};

/** The test date of a late result, under its row; nothing for any other row. */
export const HistoryTestedOn: FunctionComponent<{ testedAt: Date | null, className: string }> = ({ testedAt, className }) => {
  if (testedAt === null) {
    return null;
  }
  const day = formatDate(testedAt);
  return <span className={className}><Trans>Result of the test run on {day}</Trans></span>;
};
