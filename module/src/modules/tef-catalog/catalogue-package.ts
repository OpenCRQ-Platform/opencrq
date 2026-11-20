import { createHash } from 'node:crypto';
import { StructuredError } from '@app/utils';
import { z } from 'zod';
import type { TefNotMeasured } from './catalogue-constants';
import { TEF_ANY, TEF_CATALOGUE_SCHEMA, TEF_NOT_MEASURED, TEF_OUTCOME_BY_KEY, TEF_SIZE_CLASSES } from './catalogue-constants';

/**
 * A threat event frequency catalogue package: `catalogue.json` (the manifest) and `rows.csv`, in the
 * format the catalogue builder documents (`format/FORMAT.md` in the tools repository).
 */
export interface TefCataloguePackageFiles {
  readonly catalogue: unknown,
  readonly rowsCsv: string,
}

export interface TefCatalogueSource {
  readonly id: string,
  readonly title: string,
  readonly publisher: string,
  readonly url: string | null,
  readonly licence: string | null,
  /** The text the source's licence requires to be shown with figures derived from it. */
  readonly attribution: string | null,
  /** The year, or first and last years, the source's data describe. */
  readonly referencePeriod: string | null,
}

export interface TefCatalogueRow {
  /** The platform's catalogue attack outcome id. */
  readonly outcomeId: string,
  /** ISO 3166-1 alpha-2, or `*`. */
  readonly country: string,
  /** A sector name, or `*`. */
  readonly sector: string,
  /** A size class, or `*`. */
  readonly sizeClass: string,
  readonly low: number,
  readonly likely: number,
  readonly high: number,
  readonly notMeasured: ReadonlyArray<TefNotMeasured>,
  readonly sourceIds: ReadonlyArray<string>,
}

export interface TefCatalogue {
  readonly id: string,
  /** Semantic Versioning `MAJOR.MINOR.PATCH`, set by the publisher. */
  readonly version: string,
  readonly builtOn: string,
  readonly digest: string,
  readonly publisher: string,
  readonly sources: ReadonlyArray<TefCatalogueSource>,
  readonly rows: ReadonlyArray<TefCatalogueRow>,
  readonly row: (outcomeId: string, country: string, sector: string, sizeClass: string) => TefCatalogueRow | undefined,
  /** The countries and sectors some row names, `*` left out. */
  readonly countries: ReadonlySet<string>,
  readonly sectors: ReadonlySet<string>,
}

export class TefCataloguePackageError extends StructuredError {
  override readonly name: string = 'TefCataloguePackageError';

  constructor(errors: ReadonlyArray<string>) {
    super(`The TEF catalogue package is invalid: ${errors.slice(0, 5).join('; ')}`, { data: { errors: errors.slice(0, 50), count: errors.length } });
  }
}

export const TEF_CATALOGUE_COLUMNS = ['outcome', 'country', 'sector', 'size_class', 'low', 'likely', 'high', 'not_measured', 'sources'] as const;

/** RFC 4180 fields of one line: commas separate, double quotes enclose, a doubled quote is a quote. */
export const parseCsvLine = (line: string): Array<string> => {
  const fields: Array<string> = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line.charAt(i);
    if (quoted) {
      if (c === '"' && line.charAt(i + 1) === '"') {
        current += '"';
        i += 1;
      } else if (c === '"') {
        quoted = false;
      } else {
        current += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      fields.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  fields.push(current);
  return fields;
};

const rowKey = (outcomeId: string, country: string, sector: string, sizeClass: string): string => `${outcomeId}|${country}|${sector}|${sizeClass}`;

const isNotMeasured = (value: string): value is TefNotMeasured => (TEF_NOT_MEASURED as ReadonlyArray<string>).includes(value);

const text = z.string().trim().min(1);

// MAJOR.MINOR.PATCH only: a stored estimate's version is compared as a string, where SemVer ignores a build part.
const MAJOR_MINOR_PATCH = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** SHA-256 of `rows.csv` as the package holds it, lowercase hex. */
export const tefRowsDigest = (rowsCsv: string): string => createHash('sha256').update(rowsCsv, 'utf8').digest('hex');

const ManifestSchema = z.object({
  schema: z.literal(TEF_CATALOGUE_SCHEMA),
  // The importer names the file it writes after it.
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'is not a lowercase slug'),
  version: z.string().regex(MAJOR_MINOR_PATCH, 'is not a Semantic Versioning MAJOR.MINOR.PATCH'),
  built_on: z.iso.date(),
  digest: z.string().regex(/^[0-9a-f]{64}$/, 'is not a lowercase hex SHA-256'),
  publisher: text,
  sources: z.array(z.object({
    id: text,
    title: text,
    publisher: text,
    url: text.optional(),
    licence: text.optional(),
    attribution: text.optional(),
    reference_period: z.string().regex(/^\d{4}(-\d{4})?$/, 'is not a year or two years joined by a hyphen').optional(),
  })).min(1),
});

const SchemaOnly = z.object({ schema: z.unknown() });

const toNumber = (value: string): number => (value.trim() === '' ? Number.NaN : Number(value));

/**
 * Reads and checks a package: refuses a `schema` other than `TEF_CATALOGUE_SCHEMA`, a version that is
 * not plain `MAJOR.MINOR.PATCH`, a `digest` that is not the SHA-256 of `rowsCsv`, a key outside the
 * outcome keys, `sectors` or the size classes, a range out of `0 < low <= likely <= high`, a
 * `not_measured` value outside its three, a source the manifest does not list, a manifest source no
 * row reads, a repeated key, a country and sector holding rows for some size classes only, and an
 * outcome without its row for every country, sector and size.
 * Throws `TefCataloguePackageError` listing what breaks.
 */
export const loadTefCataloguePackage = (files: TefCataloguePackageFiles, sectors: ReadonlySet<string>): TefCatalogue => {
  const declared = SchemaOnly.safeParse(files.catalogue);
  if (!declared.success || declared.data.schema !== TEF_CATALOGUE_SCHEMA) {
    throw new TefCataloguePackageError([`catalogue.json schema is ${String(declared.data?.schema)}, this platform reads ${TEF_CATALOGUE_SCHEMA}`]);
  }
  const parsed = ManifestSchema.safeParse(files.catalogue);
  if (!parsed.success) {
    throw new TefCataloguePackageError(parsed.error.issues.map((issue) => `catalogue.json ${issue.path.join('.')}: ${issue.message}`));
  }
  const manifest = parsed.data;
  const digest = tefRowsDigest(files.rowsCsv);
  if (digest !== manifest.digest) {
    throw new TefCataloguePackageError([`catalogue.json digest ${manifest.digest} is not the SHA-256 of rows.csv (${digest}): the rows were changed or converted after the build`]);
  }
  const errors: Array<string> = [];
  const sources: Array<TefCatalogueSource> = manifest.sources.map((source) => ({
    id: source.id,
    title: source.title,
    publisher: source.publisher,
    url: source.url ?? null,
    licence: source.licence ?? null,
    attribution: source.attribution ?? null,
    referencePeriod: source.reference_period ?? null,
  }));
  const sourceIds = new Set(sources.map((source) => source.id));
  if (sourceIds.size !== sources.length) {
    errors.push('catalogue.json lists a source twice');
  }

  const lines = files.rowsCsv.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines[0] !== TEF_CATALOGUE_COLUMNS.join(',')) {
    throw new TefCataloguePackageError([...errors, `rows.csv header is ${lines[0] ?? 'missing'}, expected ${TEF_CATALOGUE_COLUMNS.join(',')}`]);
  }
  const index = new Map<string, TefCatalogueRow>();
  const rows: Array<TefCatalogueRow> = [];
  const read = new Set<string>();
  const sizeClassesOf = new Map<string, Set<string>>();
  const outcomesRead = new Map<string, string>();
  for (const [i, line] of lines.slice(1).entries()) {
    const at = `rows.csv line ${i + 2}`;
    const fields = parseCsvLine(line);
    if (fields.length !== TEF_CATALOGUE_COLUMNS.length) {
      errors.push(`${at} has ${fields.length} fields`);
      continue;
    }
    const [outcome = '', country = '', sector = '', sizeClass = '', low = '', likely = '', high = '', notMeasured = '', rowSources = ''] = fields;
    const outcomeId = Object.hasOwn(TEF_OUTCOME_BY_KEY, outcome) ? TEF_OUTCOME_BY_KEY[outcome] : undefined;
    if (outcomeId === undefined) {
      errors.push(`${at} outcome ${outcome} is not a known outcome key`);
    }
    if (country !== TEF_ANY && !/^[A-Z]{2}$/.test(country)) {
      errors.push(`${at} country ${country} is not ISO 3166-1 alpha-2 or ${TEF_ANY}`);
    }
    if (sector !== TEF_ANY && !sectors.has(sector)) {
      errors.push(`${at} sector ${sector} is not a known sector`);
    }
    if (sizeClass !== TEF_ANY && !(TEF_SIZE_CLASSES as ReadonlyArray<string>).includes(sizeClass)) {
      errors.push(`${at} size class ${sizeClass} is not a known size class`);
    }
    const l = toNumber(low);
    const m = toNumber(likely);
    const h = toNumber(high);
    if (![l, m, h].every(Number.isFinite) || !(l > 0 && l <= m && m <= h)) {
      errors.push(`${at} breaks 0 < low <= likely <= high (${low}, ${likely}, ${high})`);
    }
    const marks = notMeasured === '' ? [] : notMeasured.split(';');
    const measuredMarks = marks.filter(isNotMeasured);
    if (measuredMarks.length !== marks.length || new Set(marks).size !== marks.length) {
      errors.push(`${at} not_measured ${notMeasured} is not a subset of ${TEF_NOT_MEASURED.join(', ')}`);
    }
    const ids = rowSources === '' ? [] : rowSources.split(';');
    if (ids.length === 0) {
      errors.push(`${at} names no source`);
    }
    for (const id of ids) {
      read.add(id);
      if (!sourceIds.has(id)) {
        errors.push(`${at} names source ${id}, absent from catalogue.json`);
      }
    }
    if (outcomeId === undefined) {
      continue;
    }
    const key = rowKey(outcomeId, country, sector, sizeClass);
    if (index.has(key)) {
      errors.push(`${at} repeats ${outcome}, ${country}, ${sector}, ${sizeClass}`);
      continue;
    }
    const row: TefCatalogueRow = { outcomeId, country, sector, sizeClass, low: l, likely: m, high: h, notMeasured: measuredMarks, sourceIds: ids };
    index.set(key, row);
    rows.push(row);
    outcomesRead.set(outcome, outcomeId);
    if (sizeClass !== TEF_ANY) {
      const profile = `${outcome}, ${country}, ${sector}`;
      sizeClassesOf.set(profile, (sizeClassesOf.get(profile) ?? new Set()).add(sizeClass));
    }
  }
  if (rows.length === 0) {
    errors.push('rows.csv holds no row');
  }
  // A mixture of size classes records one country and sector, so every class must fall back alike.
  for (const [profile, present] of sizeClassesOf) {
    const missing = TEF_SIZE_CLASSES.filter((sizeClass) => !present.has(sizeClass));
    if (missing.length > 0) {
      errors.push(`rows.csv has ${profile} for some size classes but not ${missing.join(', ')}`);
    }
  }
  // Every fallback ends on this row, so a lookup never finds none.
  for (const [outcome, outcomeId] of outcomesRead) {
    if (!index.has(rowKey(outcomeId, TEF_ANY, TEF_ANY, TEF_ANY))) {
      errors.push(`rows.csv has no ${outcome}, ${TEF_ANY}, ${TEF_ANY}, ${TEF_ANY} row, which every fallback for ${outcome} ends on`);
    }
  }
  for (const id of sourceIds) {
    if (!read.has(id)) {
      errors.push(`source ${id} is listed but no row reads it`);
    }
  }
  if (errors.length > 0) {
    throw new TefCataloguePackageError(errors);
  }
  return {
    id: manifest.id,
    version: manifest.version,
    builtOn: manifest.built_on,
    digest: manifest.digest,
    publisher: manifest.publisher,
    sources,
    rows,
    row: (outcomeId, country, sector, sizeClass) => index.get(rowKey(outcomeId, country, sector, sizeClass)),
    countries: new Set(rows.map((row) => row.country).filter((country) => country !== TEF_ANY)),
    sectors: new Set(rows.map((row) => row.sector).filter((sector) => sector !== TEF_ANY)),
  };
};
