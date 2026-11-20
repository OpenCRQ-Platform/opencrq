import { includesFolded } from '@app/utils/text-fold';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import type { RevenueBand, TefSizeClass } from '@app/module/client';
import type { inferRouterOutputs } from '@trpc/server';
import { sizeClassOfEmployees, TEF_SIZE_CLASS_FLOOR, TEF_SIZE_CLASSES } from '@app/module/client';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;
export type TefCatalog = RouterOutputs['crqIndicators']['getTefCatalog'];
export type TefReading = RouterOutputs['crqIndicators']['getTefCatalogReading'];
export type TefOutcomeReading = TefReading['outcomes'][number];
export type TefRead = TefOutcomeReading['read'];
export type TefRange = TefReading['total'];
export type TefScopeReading = RouterOutputs['crqIndicators']['getTefCatalogScopeReadings'][number];
export type ScopeScenarioTef = RouterOutputs['crqIndicators']['getScopeScenarioTefs'][number];

/** A risk scope's profile as the catalogue reads it, each part `null` where the scope leaves it unset. */
export interface FrequencyProfile {
  countryId: string | null,
  sectorId: string | null,
  employeeCount: number | null,
  revenueBand: RevenueBand | null,
}

const PROFILE_FIELDS: ReadonlyArray<keyof FrequencyProfile> = ['countryId', 'sectorId', 'employeeCount', 'revenueBand'];

/** The simulator's start without a risk scope. */
// eslint-disable-next-line lingui/no-unlocalized-strings -- the reference sector's name, the key its row is looked up by
const DEFAULT_SECTOR_NAME = 'Finance';
const DEFAULT_COUNTRY_ISO_ALPHA3 = 'USA';
const DEFAULT_REVENUE_BAND: RevenueBand = '100m_1b';

/** The headcount bounds of a class, `null` above for the open one. */
export const sizeClassBounds = (sizeClass: TefSizeClass): { from: number, to: number | null } => {
  const next = TEF_SIZE_CLASSES[TEF_SIZE_CLASSES.indexOf(sizeClass) + 1];
  return { from: TEF_SIZE_CLASS_FLOOR[sizeClass], to: next === undefined ? null : TEF_SIZE_CLASS_FLOOR[next] - 1 };
};

/** A headcount, 0 included, sizes the profile; without one the revenue band does. */
export const hasEmployeeCount = (profile: Pick<FrequencyProfile, 'employeeCount'>): profile is { employeeCount: number } =>
  profile.employeeCount !== null;

/** A part the tenant no longer has reads as unset, as it does for the catalogue read. */
export const startingProfile = (catalog: TefCatalog, scope: FrequencyProfile | undefined): FrequencyProfile => {
  if (scope === undefined) {
    return {
      countryId: (catalog.countries.find((country) => country.isoAlpha3 === DEFAULT_COUNTRY_ISO_ALPHA3) ?? catalog.countries.at(0))?.id ?? null,
      sectorId: (catalog.sectors.find((sector) => sector.name === DEFAULT_SECTOR_NAME) ?? catalog.sectors.at(0))?.id ?? null,
      employeeCount: null,
      revenueBand: DEFAULT_REVENUE_BAND,
    };
  }
  const known = (id: string | null, entries: ReadonlyArray<{ id: string }>): string | null =>
    (entries.some((entry) => entry.id === id) ? id : null);
  return {
    countryId: known(scope.countryId, catalog.countries),
    sectorId: known(scope.sectorId, catalog.sectors),
    employeeCount: scope.employeeCount,
    revenueBand: scope.revenueBand,
  };
};

/** The simulator's size field: a class, or no headcount, in which case the revenue band sizes the profile. */
export type SizeChoice = TefSizeClass | 'unknown';

/** The parts the reader changed, each absent where it stays the starting profile's. */
export interface ProfileChoices {
  countryId?: string,
  sectorId?: string,
  size?: SizeChoice,
  revenueBand?: RevenueBand,
}

export const sizeChoiceOf = (profile: FrequencyProfile): SizeChoice =>
  (hasEmployeeCount(profile) ? sizeClassOfEmployees(profile.employeeCount) : 'unknown');

/** A sector or country the tenant does not have counts as no choice; a class keeps a headcount already in it. */
export const simulatedProfile = (catalog: TefCatalog, choices: ProfileChoices, start: FrequencyProfile): FrequencyProfile => {
  const employeeCount = (() => {
    if (choices.size === undefined || choices.size === sizeChoiceOf(start)) {
      return start.employeeCount;
    }
    return choices.size === 'unknown' ? null : TEF_SIZE_CLASS_FLOOR[choices.size];
  })();
  return {
    countryId: catalog.countries.some((country) => country.id === choices.countryId) ? choices.countryId ?? null : start.countryId,
    sectorId: catalog.sectors.some((sector) => sector.id === choices.sectorId) ? choices.sectorId ?? null : start.sectorId,
    employeeCount,
    revenueBand: choices.revenueBand ?? start.revenueBand,
  };
};

/** A part equal to the start's, or unset, is left out. */
export const choicesFor = (profile: FrequencyProfile, start: FrequencyProfile): ProfileChoices => ({
  countryId: profile.countryId === start.countryId ? undefined : profile.countryId ?? undefined,
  sectorId: profile.sectorId === start.sectorId ? undefined : profile.sectorId ?? undefined,
  size: sizeChoiceOf(profile) === sizeChoiceOf(start) ? undefined : sizeChoiceOf(profile),
  revenueBand: profile.revenueBand === start.revenueBand ? undefined : profile.revenueBand ?? undefined,
});

export const sameProfile = (a: FrequencyProfile, b: FrequencyProfile): boolean =>
  PROFILE_FIELDS.every((field) => a[field] === b[field]);

export type RecurrenceUnit = 'months' | 'years';

/** "Once every N years", in months below a year; `undefined` for a rate of zero, which never recurs. */
export const recurrence = (attemptsPerYear: number): { unit: RecurrenceUnit, value: number } | undefined => {
  if (!(attemptsPerYear > 0)) {
    return undefined;
  }
  const years = 1 / attemptsPerYear;
  return years < 1 ? { unit: 'months', value: 12 * years } : { unit: 'years', value: years };
};

export const RANGE_SCALE_DECADES: ReadonlyArray<number> = [0.01, 0.1, 1, 10, 100];

/** Where a rate sits on the range bar: four decades, 0.01 to 100 attempts per year. */
export const rangePercent = (rate: number): number =>
  (rate > 0 ? Math.max(0, Math.min(100, ((Math.log10(rate) + 2) / 4) * 100)) : 0);

/** Why the figure does not measure the profile's country, `null` when it does. */
export type CountryNote = 'unset' | 'not_covered' | 'pooled';
export type SectorNote = 'unset' | 'every_sector' | 'other_countries';
export type SizeNote =
  | { kind: 'unset' }
  | { kind: 'revenue_band', from: TefSizeClass, to: TefSizeClass }
  | { kind: 'extended', sizeClass: TefSizeClass };

/** How each part of the profile reads, `null` for a part the profile leaves unset. */
export interface ProfileLabels {
  country: string | null,
  sector: string | null,
  size: string | null,
}

export interface ProfileNotes {
  country: CountryNote | null,
  sector: SectorNote | null,
  size: SizeNote | null,
}

const countryNoteOf = (read: TefRead): CountryNote | null => {
  if (read.countryIsoAlpha3 === null) {
    return 'unset';
  }
  if (read.country === '*') {
    return 'not_covered';
  }
  return read.notMeasured.includes('country') ? 'pooled' : null;
};

const sectorNoteOf = (read: TefRead): SectorNote | null => {
  if (read.sectorName === null) {
    return 'unset';
  }
  if (read.sector === null) {
    return 'every_sector';
  }
  return read.notMeasured.includes('sector') ? 'other_countries' : null;
};

const sizeNoteOf = (read: TefRead): SizeNote | null => {
  const [first] = read.sizeClasses;
  const last = read.sizeClasses.at(-1);
  if (read.sizeSource === 'none' || first === undefined || last === undefined) {
    return { kind: 'unset' };
  }
  if (read.sizeSource === 'revenue_band') {
    return { kind: 'revenue_band', from: first.sizeClass, to: last.sizeClass };
  }
  return read.notMeasured.includes('size') ? { kind: 'extended', sizeClass: first.sizeClass } : null;
};

/**
 * What the profile's figures do not measure, across the outcomes read: an outcome may fall back to a
 * wider row than another, and the profile names the widest any of them read.
 */
export const profileNotes = (reads: ReadonlyArray<TefRead>): ProfileNotes => {
  const widest = <Note>(notes: ReadonlyArray<Note | null>, rank: (note: Note) => number): Note | null =>
    notes.filter((note) => note !== null).toSorted((a, b) => rank(a) - rank(b)).at(0) ?? null;
  const countryRank: ReadonlyArray<CountryNote> = ['unset', 'not_covered', 'pooled'];
  const sectorRank: ReadonlyArray<SectorNote> = ['unset', 'every_sector', 'other_countries'];
  const sizeRank: ReadonlyArray<SizeNote['kind']> = ['unset', 'revenue_band', 'extended'];
  return {
    country: widest(reads.map(countryNoteOf), (note) => countryRank.indexOf(note)),
    sector: widest(reads.map(sectorNoteOf), (note) => sectorRank.indexOf(note)),
    size: widest(reads.map(sizeNoteOf), (note) => sizeRank.indexOf(note.kind)),
  };
};

/** Why a scenario's TEF departs from the catalogue's: typed by hand, or not the read the catalogue in force gives today. */
export type ScenarioTefGap = 'manual' | 'stale';

/** Switching to manual hands over the auto value at the three decimals the TEF card shows. */
const atTypedPrecision = (value: number): number => Math.round(value * 1000);

/** The stored estimate and the reading come out of one lookup, so they differ by float noise at most. */
const SAME_TEF_TOLERANCE = 1e-6;

/**
 * `null` when the scenario runs on the catalogue's own value, or has no TEF yet to compare. An auto
 * estimate is current only when it records a read of the catalogue in force giving today's value: a
 * vintage estimate records none, and a profile changed since gives another value.
 */
export const scenarioTefGap = (
  scenario: Pick<ScopeScenarioTef, 'tefMode' | 'likely' | 'read'>,
  current: Pick<TefRead, 'catalogue' | 'likely'>,
): ScenarioTefGap | null => {
  if (scenario.likely === null) {
    return null;
  }
  if (scenario.tefMode === 'manual') {
    return atTypedPrecision(scenario.likely) === atTypedPrecision(current.likely) ? null : 'manual';
  }
  const { read } = scenario;
  const isCurrent = read !== null
    && read.catalogue.id === current.catalogue.id
    && read.catalogue.version === current.catalogue.version
    && Math.abs(read.likely - current.likely) <= SAME_TEF_TOLERANCE * current.likely;
  return isCurrent ? null : 'stale';
};

/** The fewest decimals, three at most, at which a ratio to the catalogue does not read 1, so that a gap never shows as ×1.0. */
export const ratioFractionDigits = (ratio: number): number =>
  [1, 2].find((digits) => Math.round(ratio * 10 ** digits) !== 10 ** digits) ?? 3;

export interface ScopeIdentity extends FrequencyProfile {
  id: string,
  name: string,
}

export interface ScopeFrequencyRow {
  scope: ScopeIdentity,
  reading: TefReading,
}

/**
 * Where a scope sorts by size: its headcount, else the floor of the smallest class its read spans (a
 * revenue band's), and below every size when the read has no size.
 */
export const scopeSizeSortKey = (scope: Pick<FrequencyProfile, 'employeeCount'>, reading: TefReading): number => {
  if (hasEmployeeCount(scope)) {
    return scope.employeeCount;
  }
  const read = reading.outcomes[0]?.read;
  if (read === undefined || read.sizeSource === 'none') {
    return -1;
  }
  return Math.min(...read.sizeClasses.map(({ sizeClass }) => TEF_SIZE_CLASS_FLOOR[sizeClass]));
};

/** One row per risk scope with a reading, most attempts first. */
export const scopeFrequencyRows = (scopes: ReadonlyArray<ScopeIdentity>, readings: ReadonlyArray<TefScopeReading>): Array<ScopeFrequencyRow> => {
  const readingByScope = new Map(readings.map((reading) => [reading.organizationId, reading]));
  return scopes
    .flatMap((scope) => {
      const reading = readingByScope.get(scope.id);
      return reading === undefined ? [] : [{ scope, reading }];
    })
    .toSorted((a, b) => (b.reading.total.likely - a.reading.total.likely) || a.scope.name.localeCompare(b.scope.name));
};

/** The rows whose risk scope name holds the search, whatever its case and accents. */
export const matchingScopes = (rows: ReadonlyArray<ScopeFrequencyRow>, search: string): Array<ScopeFrequencyRow> =>
  rows.filter((row) => includesFolded(row.scope.name, search));

/** The outcomes most frequent first across the scopes shown, so the columns read left to right by weight. */
export const outcomesByFrequency = (rows: ReadonlyArray<ScopeFrequencyRow>): Array<{ id: string, name: string }> => {
  const sums = new Map<string, { id: string, name: string, sum: number }>();
  for (const { reading } of rows) {
    for (const outcome of reading.outcomes) {
      const entry = sums.get(outcome.attackOutcomeId) ?? { id: outcome.attackOutcomeId, name: outcome.name, sum: 0 };
      entry.sum += outcome.read.likely;
      sums.set(outcome.attackOutcomeId, entry);
    }
  }
  return [...sums.values()].toSorted((a, b) => (b.sum - a.sum) || a.name.localeCompare(b.name)).map(({ id, name }) => ({ id, name }));
};

export const readForOutcome = (reading: TefReading, attackOutcomeId: string): TefRead | undefined =>
  reading.outcomes.find((outcome) => outcome.attackOutcomeId === attackOutcomeId)?.read;
