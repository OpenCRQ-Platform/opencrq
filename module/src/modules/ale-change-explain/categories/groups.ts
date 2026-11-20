import type { SeverityBand } from '../../finding-score/bands';
import type { ChangeCategoryKey, ChangeEvent, ChangeGroup, ChangeGroupKind, ChangeGroupRow, ChangeGroupSort, ChangeGroupSortKey, ChangeItemKind } from '../types';
import { SEVERITY_BANDS } from '../../finding-score/bands';

const GROUPED_CATEGORIES = {
  'findings-critical': 'cve-group',
  'findings-high': 'cve-group',
  'findings-other': 'cve-group',
  'assets-critical': 'asset-group',
  'assets-high': 'asset-group',
  'assets-other': 'asset-group',
} as const satisfies Partial<Record<ChangeCategoryKey, ChangeItemKind>>;

type GroupedCategoryKey = keyof typeof GROUPED_CATEGORIES;

export const isGrouped = (category: ChangeCategoryKey): category is GroupedCategoryKey => Object.hasOwn(GROUPED_CATEGORIES, category);

const KIND_OF_SENTENCE: Partial<Record<string, ChangeGroupKind>> = {
  'cve-appeared': 'appeared',
  'cve-left': 'left',
  'cve-no-longer-reported': 'no-longer-reported',
  'cve-band-moved': 'band-moved',
  'posture-first-seen': 'first-measured',
  'posture-band-moved': 'posture-moved',
};

export const changeKindOf = (event: ChangeEvent): ChangeGroupKind | undefined => KIND_OF_SENTENCE[event.sentence.key];

const KIND_ORDER: Record<ChangeGroupKind, number> = { appeared: 0, left: 1, 'no-longer-reported': 2, 'band-moved': 3, 'first-measured': 4, 'posture-moved': 5 };

/** Any other part, `none` included, is no band. */
const bandOf = (part: string | number | undefined): SeverityBand | null => SEVERITY_BANDS.find((band) => band === part) ?? null;

const bandsOf = ({ sentence: { parts } }: ChangeEvent, kind: ChangeGroupKind): { from: SeverityBand | null, to: SeverityBand | null } => {
  switch (kind) {
    case 'appeared':
    case 'first-measured':
      return { from: null, to: bandOf(parts.band) };
    case 'left':
    case 'no-longer-reported':
      return { from: bandOf(parts.band), to: null };
    case 'band-moved':
    case 'posture-moved':
      return { from: bandOf(parts.from), to: bandOf(parts.to) };
    default:
      return kind satisfies never;
  }
};

export const recordedTime = (event: ChangeEvent): number => (event.moment.kind === 'recorded' ? Date.parse(event.moment.at) : Number.NaN);

export interface GroupMember {
  event: ChangeEvent,
  assets: number | null,
}

export const groupRowOf = ({ event, assets }: GroupMember, kind: ChangeGroupKind): ChangeGroupRow => ({
  item: event.item,
  ...bandsOf(event, kind),
  assets,
  at: new Date(recordedTime(event)).toISOString(),
  direction: event.direction,
});

const bandRank = (band: SeverityBand | null): number => (band === null ? SEVERITY_BANDS.length : SEVERITY_BANDS.indexOf(band));

/** Unnamed items last. */
const byName = (a: GroupMember, b: GroupMember): number => {
  const nameA = a.event.item.label;
  const nameB = b.event.item.label;
  return Number(nameA === null) - Number(nameB === null)
    || (nameA ?? '').localeCompare(nameB ?? '')
    || a.event.item.key.localeCompare(b.event.item.key);
};

/**
 * A move ranks by the band reached, then by the band left, so that descending puts the steepest fall
 * into a band first. A one-sided change ranks by the band its row shows: the one left for a CVE no
 * longer applying, the one reached otherwise.
 */
const bandValues = (event: ChangeEvent, kind: ChangeGroupKind): Array<number> => {
  const { from, to } = bandsOf(event, kind);
  switch (kind) {
    case 'band-moved':
    case 'posture-moved':
      return [-bandRank(to), bandRank(from)];
    case 'left':
    case 'no-longer-reported':
      return [-bandRank(from)];
    case 'appeared':
    case 'first-measured':
      return [-bandRank(to)];
    default:
      return kind satisfies never;
  }
};

const SORT_VALUES: Record<Exclude<ChangeGroupSortKey, 'item'>, (member: GroupMember, kind: ChangeGroupKind) => Array<number>> = {
  band: ({ event }, kind) => bandValues(event, kind),
  assets: ({ assets }) => [assets ?? 0],
  time: ({ event }) => [recordedTime(event)],
};

const compareValues = (a: Array<number>, b: Array<number>): number => a.reduce((order, value, index) => order || value - b[index], 0);

/** Ties, and every row under a sort by name, fall back to the name ascending. */
export const sortedBy = (kind: ChangeGroupKind, { by, desc }: ChangeGroupSort) => (a: GroupMember, b: GroupMember): number => {
  const order = by === 'item' ? byName(a, b) : compareValues(SORT_VALUES[by](a, kind), SORT_VALUES[by](b, kind));
  return (desc ? -order : order) || byName(a, b);
};

/**
 * Counted per chronology node, category and change kind, a node being a calendar day of `timeZone`
 * split at each of `splits`, the reading times of the runs drawn between the two compared, where the
 * client would have placed each item.
 */
export const groupEvents = (events: ReadonlyArray<ChangeEvent>, splits: ReadonlyArray<number>, timeZone: string): Array<ChangeEvent> => {
  const groups = new Map<string, { category: GroupedCategoryKey, group: ChangeGroup, first: number, last: number }>();
  const days = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  for (const event of events) {
    const kind = changeKindOf(event);
    const { category } = event;
    if (kind === undefined || !isGrouped(category)) {
      continue;
    }
    const at = recordedTime(event);
    const key = `${days.format(at)}/${splits.filter((split) => split < at).length}/${category}/${kind}`;
    const entry = groups.get(key) ?? { category, group: { kind, from: '', to: '', up: 0, down: 0, bands: [] }, first: at, last: at };
    entry.first = Math.min(entry.first, at);
    entry.last = Math.max(entry.last, at);
    if (event.direction !== 'none') {
      entry.group[event.direction] += 1;
    }
    const { from, to } = bandsOf(event, kind);
    const band = entry.group.bands.find((candidate) => candidate.from === from && candidate.to === to);
    if (band === undefined) {
      entry.group.bands.push({ from, to, count: 1 });
    } else {
      band.count += 1;
    }
    groups.set(key, entry);
  }
  return [...groups.values()]
    .toSorted((a, b) => a.first - b.first || KIND_ORDER[a.group.kind] - KIND_ORDER[b.group.kind])
    .map(({ category, group, first, last }): ChangeEvent => {
      const itemKind = GROUPED_CATEGORIES[category];
      const count = group.bands.reduce((sum, band) => sum + band.count, 0);
      return {
        category,
        moment: { kind: 'recorded', at: new Date(first).toISOString() },
        direction: group.up + group.down === 0 ? 'none' : (group.up >= group.down ? 'up' : 'down'),
        item: { kind: itemKind, key: group.kind, label: null, link: null },
        sentence: { key: itemKind, parts: { count } },
        values: null,
        group: {
          ...group,
          from: new Date(first).toISOString(),
          to: new Date(last).toISOString(),
          bands: group.bands.toSorted((a, b) => b.count - a.count || bandRank(a.to) - bandRank(b.to) || bandRank(a.from) - bandRank(b.from)),
        },
      };
    });
};
