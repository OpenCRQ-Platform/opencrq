import type { AssetCategory, DeclaredEstateAnswer, DeclaredEstateBand, DeclaredEstateComparisonState, DeclaredEstateKind } from '@app/module/client';
import {
  ASSET_CATEGORY_VALUES,
  DECLARED_ESTATE_BANDS,
  DECLARED_ESTATE_KIND_VALUES,
  DECLARED_ESTATE_KINDS,
  DECLARED_ESTATE_MAX_COUNT,
  declaredEstateBandOf,
} from '@app/module/client';

export type DeclaredEstateBounds = NonNullable<DeclaredEstateAnswer['bounds']>;

export type DeclaredEstateChoice = DeclaredEstateBand | 'custom';

export interface DeclaredEstateDraft {
  readonly choice: DeclaredEstateChoice | null,
  readonly mode: 'exact' | 'range',
  readonly low: number | null,
  readonly high: number | null,
  readonly internetFacing: boolean | null,
}

export type DeclaredEstateDraftError = 'MISSING_COUNT' | 'NOT_A_COUNT' | 'LOW_ABOVE_HIGH';

const isCount = (value: number): boolean => Number.isInteger(value) && value >= 0 && value <= DECLARED_ESTATE_MAX_COUNT;

export const EMPTY_DRAFT: DeclaredEstateDraft = { choice: null, mode: 'exact', low: null, high: null, internetFacing: null };

/** Two bounds a band names exactly read as that band, never as a range. */
export const draftOf = (bounds: DeclaredEstateBounds | null, internetFacing: boolean | null): DeclaredEstateDraft => {
  if (bounds === null) {
    return EMPTY_DRAFT;
  }
  const band = declaredEstateBandOf(bounds.low, bounds.high);
  if (band !== null) {
    return { choice: band, mode: 'exact', low: null, high: null, internetFacing };
  }
  return { choice: 'custom', mode: bounds.low === bounds.high ? 'exact' : 'range', low: bounds.low, high: bounds.high, internetFacing };
};

export const draftError = (draft: DeclaredEstateDraft): DeclaredEstateDraftError | null => {
  if (draft.choice !== 'custom') {
    return null;
  }
  if (draft.low === null || (draft.mode === 'range' && draft.high === null)) {
    return 'MISSING_COUNT';
  }
  if (!isCount(draft.low) || (draft.mode === 'range' && draft.high !== null && !isCount(draft.high))) {
    return 'NOT_A_COUNT';
  }
  return draft.mode === 'range' && draft.high !== null && draft.low > draft.high ? 'LOW_ABOVE_HIGH' : null;
};

/** The bounds a draft answers, or null for no answer or one still incomplete. */
export const boundsOf = (draft: DeclaredEstateDraft): DeclaredEstateBounds | null => {
  if (draft.choice === null) {
    return null;
  }
  if (draft.choice !== 'custom') {
    return DECLARED_ESTATE_BANDS[draft.choice];
  }
  if (draftError(draft) !== null || draft.low === null) {
    return null;
  }
  return { low: draft.low, high: draft.mode === 'exact' ? draft.low : draft.high ?? draft.low };
};

export const asksExposure = (kind: DeclaredEstateKind, draft: DeclaredEstateDraft): boolean => {
  const bounds = boundsOf(draft);
  return DECLARED_ESTATE_KINDS[kind].exposable && bounds !== null && bounds.high > 0;
};

export const answerOf = (kind: DeclaredEstateKind, draft: DeclaredEstateDraft): DeclaredEstateAnswer => {
  const bounds = boundsOf(draft);
  return { kind, bounds, internetFacing: bounds !== null && asksExposure(kind, draft) ? draft.internetFacing : null };
};

const sameAnswer = (first: DeclaredEstateAnswer, second: DeclaredEstateAnswer): boolean =>
  first.bounds?.low === second.bounds?.low
  && first.bounds?.high === second.bounds?.high
  && first.internetFacing === second.internetFacing;

/**
 * The answers a save sends: only the kinds whose draft answers something other than what is stored,
 * so a kind nobody touched keeps whatever another writer saved meanwhile.
 */
export const changedAnswers = (
  drafts: Partial<Record<DeclaredEstateKind, DeclaredEstateDraft>>,
  stored: ReadonlyArray<DeclaredEstateAnswer>,
): Array<DeclaredEstateAnswer> => DECLARED_ESTATE_KIND_VALUES.flatMap((kind) => {
  const draft = drafts[kind];
  if (draft === undefined) {
    return [];
  }
  const answer = answerOf(kind, draft);
  const before = stored.find((row) => row.kind === kind) ?? { kind, bounds: null, internetFacing: null };
  return sameAnswer(answer, before) ? [] : [answer];
});

export const hasDraftErrors = (drafts: Partial<Record<DeclaredEstateKind, DeclaredEstateDraft>>): boolean =>
  Object.values(drafts).some((draft) => draft !== undefined && draftError(draft) !== null);

/** An answer still being typed saves nothing yet, but closing the form would lose it. */
export const hasUnsavedDrafts = (
  drafts: Partial<Record<DeclaredEstateKind, DeclaredEstateDraft>>,
  stored: ReadonlyArray<DeclaredEstateAnswer>,
): boolean => changedAnswers(drafts, stored).length > 0 || hasDraftErrors(drafts);

export const pickChoice = (draft: DeclaredEstateDraft, choice: DeclaredEstateChoice | null): DeclaredEstateDraft => {
  if (choice === null) {
    return EMPTY_DRAFT;
  }
  return { ...draft, choice };
};

export const pickMode = (draft: DeclaredEstateDraft, mode: DeclaredEstateDraft['mode']): DeclaredEstateDraft =>
  ({ ...draft, mode, high: mode === 'exact' ? draft.low : draft.high });

export type DeclaredEstateAnswerShape =
  | { readonly type: 'none' }
  | { readonly type: 'band', readonly band: DeclaredEstateBand }
  | { readonly type: 'exact', readonly count: number }
  | { readonly type: 'range', readonly low: number, readonly high: number };

export const answerShapeOf = (bounds: DeclaredEstateBounds | null): DeclaredEstateAnswerShape => {
  if (bounds === null) {
    return { type: 'none' };
  }
  const band = declaredEstateBandOf(bounds.low, bounds.high);
  if (band !== null) {
    return { type: 'band', band };
  }
  return bounds.low === bounds.high ? { type: 'exact', count: bounds.low } : { type: 'range', low: bounds.low, high: bounds.high };
};

export const resolveDrafts = (
  edited: Partial<Record<DeclaredEstateKind, DeclaredEstateDraft>>,
  stored: ReadonlyArray<DeclaredEstateAnswer>,
): ReadonlyMap<DeclaredEstateKind, DeclaredEstateDraft> => new Map(DECLARED_ESTATE_KIND_VALUES.map((kind) => {
  const row = stored.find((candidate) => candidate.kind === kind);
  return [kind, edited[kind] ?? draftOf(row?.bounds ?? null, row?.internetFacing ?? null)];
}));

export interface DeclaredEstateState {
  readonly bounds: DeclaredEstateBounds | null,
  readonly internetFacing: boolean | null,
}

export type DeclaredEstateEventType = 'set' | 'change' | 'clear';

export const eventTypeOf = (before: DeclaredEstateState, after: DeclaredEstateState): DeclaredEstateEventType => {
  if (before.bounds === null) {
    return 'set';
  }
  return after.bounds === null ? 'clear' : 'change';
};

export type DeclaredEstateMove = 'count' | 'exposure';

export const eventMovesOf = (before: DeclaredEstateState, after: DeclaredEstateState): Array<DeclaredEstateMove> => {
  const countMoved = before.bounds?.low !== after.bounds?.low || before.bounds?.high !== after.bounds?.high;
  return [
    ...(countMoved ? ['count' as const] : []),
    ...(before.internetFacing === after.internetFacing ? [] : ['exposure' as const]),
  ];
};

/** The kinds in the order the assets page lists their categories, a split category keeping its kinds in declaration order. */
export const DECLARED_ESTATE_KINDS_IN_ASSET_ORDER: ReadonlyArray<DeclaredEstateKind> = [...DECLARED_ESTATE_KIND_VALUES]
  .sort((first, second) => ASSET_CATEGORY_VALUES.indexOf(DECLARED_ESTATE_KINDS[first].category) - ASSET_CATEGORY_VALUES.indexOf(DECLARED_ESTATE_KINDS[second].category));

/** A range read on a log scale, as the loss midpoint reads it: 1,001 to 5,000 reads 2,237. A range from 0 reads linearly. */
export const representativeCount = (bounds: DeclaredEstateBounds): number => {
  if (bounds.low === bounds.high) {
    return bounds.low;
  }
  return bounds.low === 0 ? bounds.high / 2 : Math.sqrt(bounds.low * bounds.high);
};

export interface DeclaredEstateMixKind {
  readonly kind: DeclaredEstateKind,
  readonly bounds: DeclaredEstateBounds,
  readonly size: number,
}

export interface DeclaredEstateMixCategory {
  readonly category: AssetCategory,
  readonly kinds: ReadonlyArray<DeclaredEstateMixKind>,
  readonly low: number,
  readonly high: number,
  readonly size: number,
  readonly internetFacing: boolean,
}

export interface DeclaredEstateMix {
  readonly categories: ReadonlyArray<DeclaredEstateMixCategory>,
  readonly unanswered: ReadonlyArray<DeclaredEstateKind>,
  readonly largest: number,
  readonly low: number,
  readonly high: number,
}

const sum = (values: ReadonlyArray<number>): number => values.reduce((total, value) => total + value, 0);

export const declaredEstateMixOf = (rows: ReadonlyArray<{ kind: DeclaredEstateKind } & DeclaredEstateState>): DeclaredEstateMix => {
  const byKind = new Map(rows.map((row) => [row.kind, row]));
  const answered = DECLARED_ESTATE_KINDS_IN_ASSET_ORDER.flatMap((kind) => {
    const row = byKind.get(kind);
    return row === undefined || row.bounds === null ? [] : [{ kind, bounds: row.bounds, size: representativeCount(row.bounds), internetFacing: row.internetFacing === true }];
  });
  const categories = ASSET_CATEGORY_VALUES.flatMap((category) => {
    const kinds = answered.filter((entry) => DECLARED_ESTATE_KINDS[entry.kind].category === category);
    if (kinds.length === 0) {
      return [];
    }
    return [{
      category,
      kinds: [...kinds].sort((first, second) => second.size - first.size).map(({ kind, bounds, size }) => ({ kind, bounds, size })),
      low: sum(kinds.map((entry) => entry.bounds.low)),
      high: sum(kinds.map((entry) => entry.bounds.high)),
      size: sum(kinds.map((entry) => entry.size)),
      internetFacing: kinds.some((entry) => entry.internetFacing),
    }];
  }).sort((first, second) => second.size - first.size);
  return {
    categories,
    unanswered: DECLARED_ESTATE_KINDS_IN_ASSET_ORDER.filter((kind) => !answered.some((entry) => entry.kind === kind)),
    largest: Math.max(0, ...categories.map((category) => category.size)),
    low: sum(categories.map((category) => category.low)),
    high: sum(categories.map((category) => category.high)),
  };
};

export interface DeclaredEstateComparisonKind {
  readonly kind: DeclaredEstateKind,
  readonly bounds: DeclaredEstateBounds | null,
  readonly measured: number,
  readonly state: DeclaredEstateComparisonState,
}

export interface DeclaredEstateComparisonCategory {
  readonly category: AssetCategory,
  readonly measured: number,
  /** The sum of the bounds of the category's declared kinds, null when none is declared. */
  readonly bounds: DeclaredEstateBounds | null,
  /** Some of the category's kinds are declared and some are not, so the bounds cover only part of what is measured. */
  readonly partial: boolean,
}

export interface DeclaredEstateComparisonChart {
  readonly rows: ReadonlyArray<DeclaredEstateComparisonCategory>,
  readonly largest: number,
  readonly declares: boolean,
}

export const declaredEstateComparisonChartOf = (kinds: ReadonlyArray<DeclaredEstateComparisonKind>): DeclaredEstateComparisonChart => {
  const byCategory = Map.groupBy(kinds, (entry) => DECLARED_ESTATE_KINDS[entry.kind].category);
  const rows = ASSET_CATEGORY_VALUES.flatMap((category) => {
    const entries = byCategory.get(category) ?? [];
    const declared = entries.flatMap((entry) => (entry.bounds === null ? [] : [entry.bounds]));
    const measured = sum(entries.map((entry) => entry.measured));
    if (measured === 0 && declared.length === 0) {
      return [];
    }
    return [{
      category,
      measured,
      bounds: declared.length === 0 ? null : { low: sum(declared.map((bounds) => bounds.low)), high: sum(declared.map((bounds) => bounds.high)) },
      partial: declared.length > 0 && declared.length < entries.length,
    }];
  });
  const sizeOf = (row: DeclaredEstateComparisonCategory): number => Math.max(row.measured, row.bounds?.high ?? 0);
  return {
    rows: rows.toSorted((first, second) => sizeOf(second) - sizeOf(first)),
    largest: Math.max(0, ...rows.map(sizeOf)),
    declares: rows.some((row) => row.bounds !== null),
  };
};
