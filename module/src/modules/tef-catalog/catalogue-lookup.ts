import { newError } from '@app/utils';
import type { RevenueBand } from '../organizations/constants';
import type { TefCatalogueSizeShare, TefNotMeasured, TefSizeClass, TefSizeSource } from './catalogue-constants';
import type { TefCatalogue, TefCatalogueRow } from './catalogue-package';
import { revenueBandMidpoint } from '../organizations/constants';
import { sizeClassOfEmployees, TEF_ANY, TEF_EVERY_SIZE, TEF_NOT_MEASURED, TEF_SIZE_CLASSES } from './catalogue-constants';

/**
 * Revenue per employee across economies, from labour-intensive services to capital-intensive
 * manufacturing, utilities and large retail: the employee range a revenue band stands for.
 */
const REVENUE_PER_EMPLOYEE_USD = { low: 100_000, high: 600_000 } as const;

/** The open 5000+ class closed at a million employees, so that it has a width on a log scale. */
const SIZE_EDGES: Readonly<Record<TefSizeClass, readonly [number, number]>> = {
  '0-9': [1, 10],
  '10-49': [10, 50],
  '50-249': [50, 250],
  '250-999': [250, 1000],
  '1000-4999': [1000, 5000],
  '5000+': [5000, 1_000_000],
};

const BAND_EDGES_USD: Readonly<Record<RevenueBand, readonly [number | null, number | null]>> = {
  under_10m: [null, 10_000_000],
  '10m_100m': [10_000_000, 100_000_000],
  '100m_1b': [100_000_000, 1_000_000_000],
  '1b_10b': [1_000_000_000, 10_000_000_000],
  '10b_100b': [10_000_000_000, 100_000_000_000],
  over_100b: [100_000_000_000, null],
};

/**
 * The size classes a revenue band spans: the band's employee range at 100k to 600k USD per employee,
 * each class weighted by its overlap with that range on a log scale. An open band is closed
 * symmetrically around the product's geometric midpoint.
 */
export const revenueBandSizeClasses = (band: RevenueBand): Array<TefCatalogueSizeShare> => {
  const midpoint = revenueBandMidpoint(band);
  const [lower, upper] = BAND_EDGES_USD[band];
  const low = lower ?? (upper === null ? midpoint : (midpoint * midpoint) / upper);
  const high = upper ?? (lower === null ? midpoint : (midpoint * midpoint) / lower);
  const from = Math.max(1, low / REVENUE_PER_EMPLOYEE_USD.high);
  const to = Math.max(2, high / REVENUE_PER_EMPLOYEE_USD.low);
  const overlaps = TEF_SIZE_CLASSES.flatMap((sizeClass) => {
    const [a, b] = SIZE_EDGES[sizeClass];
    const overlap = Math.log(Math.min(b, to)) - Math.log(Math.max(a, from));
    return overlap > 0 ? [{ sizeClass, weight: overlap }] : [];
  });
  const total = overlaps.reduce((sum, share) => sum + share.weight, 0);
  return overlaps.map((share) => ({ sizeClass: share.sizeClass, weight: share.weight / total }));
};

export interface TefCatalogueProfile {
  readonly countryIsoAlpha2: string | null,
  readonly sector: string | null,
  readonly employeeCount: number | null,
  readonly revenueBand: RevenueBand | null,
}

export interface TefCatalogueLookup {
  /** The row read: its country (ISO alpha-2 or `*`) and sector (a name or `*`). */
  readonly country: string,
  readonly sector: string,
  /** One class from the employee count, the classes a revenue band spans, every class without either. */
  readonly sizeClasses: ReadonlyArray<TefCatalogueSizeShare>,
  readonly sizeSource: TefSizeSource,
  readonly low: number,
  readonly likely: number,
  readonly high: number,
  readonly notMeasured: ReadonlyArray<TefNotMeasured>,
  readonly sourceIds: ReadonlyArray<string>,
}

/**
 * The platform's one fallback rule: the exact row, else the row for every sector, then for every
 * sector and size, and the same three again for every country (`*`). Absent values are asked as `*`.
 */
export const readTefCatalogueRow = (catalogue: TefCatalogue, outcomeId: string, country: string, sector: string, sizeClass: string): TefCatalogueRow => {
  const countries = country === TEF_ANY ? [TEF_ANY] : [country, TEF_ANY];
  for (const c of countries) {
    for (const [s, z] of [[sector, sizeClass], [TEF_ANY, sizeClass], [TEF_ANY, TEF_ANY]] as const) {
      const row = catalogue.row(outcomeId, c, s, z);
      if (row !== undefined) {
        return row;
      }
    }
  }
  throw newError('The TEF catalogue has no row for this attack outcome', { catalogue: catalogue.id, outcomeId });
};

/**
 * The rows mixed by weight, point by point. A row is a PERT (min, mode, max) whose mean is linear in
 * the three points, so the mixed range keeps the mixture's mean, which is what the ALE follows.
 */
const mixedRange = (rows: ReadonlyArray<TefCatalogueRow>, weights: ReadonlyArray<number>): { low: number, likely: number, high: number } => {
  const mixed = (point: (row: TefCatalogueRow) => number): number => rows.reduce((sum, row, j) => sum + (weights[j] ?? 0) * point(row), 0);
  return { low: mixed((row) => row.low), likely: mixed((row) => row.likely), high: mixed((row) => row.high) };
};

/**
 * An outcome's frequency for a profile. The size class is the employee count's; without one, the
 * classes the revenue band spans are read and mixed by weight (`mixedRange`); without either, every
 * class mixed alike.
 */
export const lookupTefCatalogue = (catalogue: TefCatalogue, profile: TefCatalogueProfile, outcomeId: string): TefCatalogueLookup => {
  const country = profile.countryIsoAlpha2?.toUpperCase() ?? TEF_ANY;
  const sector = profile.sector ?? TEF_ANY;
  const finish = (sizeSource: TefSizeSource, sizeClasses: ReadonlyArray<TefCatalogueSizeShare>, rows: ReadonlyArray<TefCatalogueRow>, range: { low: number, likely: number, high: number }): TefCatalogueLookup => {
    const heaviest = sizeClasses.reduce((best, share, i) => (share.weight > (sizeClasses[best]?.weight ?? 0) ? i : best), 0);
    const main = rows[heaviest] ?? rows[0];
    if (main === undefined) {
      throw newError('The TEF catalogue read no row', { catalogue: catalogue.id, outcomeId });
    }
    return {
      country: main.country,
      sector: main.sector,
      sizeClasses,
      sizeSource,
      low: range.low,
      likely: range.likely,
      high: range.high,
      notMeasured: TEF_NOT_MEASURED.filter((mark) => rows.some((row) => row.notMeasured.includes(mark))),
      sourceIds: [...new Set(rows.flatMap((row) => row.sourceIds))].toSorted(),
    };
  };
  if (profile.employeeCount !== null) {
    const sizeClass = sizeClassOfEmployees(profile.employeeCount);
    const row = readTefCatalogueRow(catalogue, outcomeId, country, sector, sizeClass);
    return finish('employee_count', [{ sizeClass, weight: 1 }], [row], row);
  }
  const mixed = (sizeSource: TefSizeSource, shares: ReadonlyArray<TefCatalogueSizeShare>): TefCatalogueLookup => {
    const rows = shares.map((share) => readTefCatalogueRow(catalogue, outcomeId, country, sector, share.sizeClass));
    return finish(sizeSource, shares, rows, mixedRange(rows, shares.map((share) => share.weight)));
  };
  return profile.revenueBand === null ? mixed('none', TEF_EVERY_SIZE) : mixed('revenue_band', revenueBandSizeClasses(profile.revenueBand));
};
