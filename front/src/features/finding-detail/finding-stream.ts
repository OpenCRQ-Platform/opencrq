import { t } from '@lingui/core/macro';
import type { FindingHistoryEntry } from '../supporting-assets/components/finding-history';
import { describeHistoryRow } from '../supporting-assets/components/finding-history';
import { getConnectorIconBySource, getConnectorNameBySource } from '../integrations';

export interface FindingSourceReport {
  connectorId: string | null,
  source: string | null,
  reportedSeverity: string | null,
  firstSeenAt: Date | string | null,
  lastSeenAt: Date | string | null,
}

export interface FindingStreamEntry {
  id: string,
  at: Date | string,
  text: string,
  /** The reporting connector's own icon; `undefined` when the entry has no connector to show one for. */
  icon?: string | null,
  /** The person or connector the entry is credited to, shown as the avatar's name and tooltip. */
  actorName?: string,
  /** When the test behind a state change was made, on a day before `at` when its result arrived late. */
  testedAt?: Date | null,
}

const toTime = (value: Date | string): number => new Date(value).getTime();

const reportEntries = (source: FindingSourceReport, index: number): Array<FindingStreamEntry> => {
  const name = source.source === null ? t`Unknown source` : (getConnectorNameBySource(source.source) ?? source.source);
  const icon = source.source === null ? null : getConnectorIconBySource(source.source);
  const severity = source.reportedSeverity;
  const key = `${source.connectorId ?? 'none'}-${index}`;

  // Only the source's current severity is stored, never a history of it, so it can only be
  // stated where it is genuinely simultaneous with the entry's own date: the last report, not
  // the first — pairing it with `firstSeenAt` would assert a value the source may not have held
  // that long ago.
  const firstText = t`First reported by ${name}.`;
  const againText = severity === null ? t`Reported again by ${name}.` : t`Reported again by ${name}, severity ${severity}.`;

  const entries: Array<FindingStreamEntry> = [];
  if (source.firstSeenAt !== null) {
    entries.push({ id: `${key}-first`, at: source.firstSeenAt, text: firstText, icon, actorName: name });
  }
  // A source seen only once (first seen === last seen, or no later last seen recorded) produces one entry, not two.
  if (source.lastSeenAt !== null && (source.firstSeenAt === null || toTime(source.lastSeenAt) > toTime(source.firstSeenAt))) {
    entries.push({ id: `${key}-again`, at: source.lastSeenAt, text: againText, icon, actorName: name });
  }
  return entries;
};

/**
 * One CVE finding's chronology, mixing every state transition with every source's own report, oldest first.
 *
 * Severity is stated as it stands at that report, never as a change ("raised to Critical"):
 * that would need a per-source history this table does not keep, and asserting a variation the
 * data cannot support would be wrong from the very next resync. For the same reason it is only
 * ever shown on the last report, the one entry whose date it is actually simultaneous with.
 */
export const getFindingStream = (
  history: ReadonlyArray<FindingHistoryEntry>,
  sources: ReadonlyArray<FindingSourceReport>,
  connectorName: string,
): Array<FindingStreamEntry> => {
  const described = history.map((entry, index) => describeHistoryRow(entry, history[index - 1] ?? null, { kind: 'cve', connectorName }));
  const stateEntries: Array<FindingStreamEntry> = history
    .map((entry, index) => {
      const { facts, title, actor, testedAt } = described[index];
      return {
        id: entry.id,
        at: entry.stateChangedAt,
        // A retirement's reason is the sync's own "No longer reported by <connector>", which the title
        // already says. The quote marks wrap a person's own free text, not translated copy, hence the
        // plain concatenation.
        text: entry.reason === null || facts.retirement ? title : `${title} \u201c${entry.reason}\u201d`,
        actorName: actor,
        testedAt,
      };
    })
    // The opening sync row only restates what that connector's own "First reported" entry says below.
    .filter((_, index) => !(index === 0 && described[0]?.facts.bySync && sources.length > 0));

  const sourceEntries = sources.flatMap((source, index) => reportEntries(source, index));

  return [...stateEntries, ...sourceEntries].sort((a, b) => toTime(a.at) - toTime(b.at));
};
