import { describe, expect, it } from 'vitest';
import type { TefCataloguePackageFiles } from './catalogue-package';
import { AttackOutcome_Ransomware } from '../attack-outcomes/data/attack-outcomes-ids';
import { sectorsData } from '../sectors/data/sectors-data';
import { sizeClassOfEmployees, TEF_CATALOGUE_SCHEMA, TEF_OUTCOME_BY_KEY, TEF_SIZE_CLASSES } from './catalogue-constants';
import { lookupTefCatalogue, readTefCatalogueRow, revenueBandSizeClasses } from './catalogue-lookup';
import { loadTefCataloguePackage, parseCsvLine, TEF_CATALOGUE_COLUMNS, TefCataloguePackageError, tefRowsDigest } from './catalogue-package';
import { currentTefCatalogue } from './catalogue-registry';
import shipped from './data/opencrq-open-data.json';

const SECTORS = new Set(sectorsData.map((sector) => sector.name));
const MANIFEST = {
  schema: TEF_CATALOGUE_SCHEMA,
  id: 'test-catalogue',
  version: '1.0.0',
  built_on: '2026-11-08',
  publisher: 'Test',
  sources: [{ id: 's', title: 'Survey', publisher: 'Office', url: 'https://example.org', licence: 'CC BY 4.0', attribution: 'Source: Office.', reference_period: '2024' }],
};
const packageOf = (lines: Array<string>, manifest: Record<string, unknown> = {}): TefCataloguePackageFiles => {
  const rowsCsv = [TEF_CATALOGUE_COLUMNS.join(','), ...lines].join('\n');
  return { catalogue: { ...MANIFEST, digest: tefRowsDigest(rowsCsv), ...manifest }, rowsCsv };
};
const errorsOf = (files: TefCataloguePackageFiles): Array<string> => {
  try {
    loadTefCataloguePackage(files, SECTORS);
    return [];
  } catch (error) {
    const errors = error instanceof TefCataloguePackageError ? error.data?.errors : undefined;
    return Array.isArray(errors) ? errors.map(String) : [String(error)];
  }
};

describe('the shipped catalogue package', () => {
  const catalogue = currentTefCatalogue();

  it('passes the checks it is loaded with', () => {
    expect(catalogue.id).toBe(shipped.catalogue.id);
    expect(catalogue.rows.length).toBeGreaterThan(30_000);
    expect(catalogue.publisher).toBe('Filigran');
    expect(catalogue.sources.map((source) => [source.id, source.title])).toEqual([['filigran-intelligence', 'Filigran Intelligence']]);
  });

  it('returns every row of rows.csv exactly on an exact lookup', () => {
    const lines = shipped.rowsCsv.split('\n').filter((line) => line.length > 0).slice(1);
    expect(lines).toHaveLength(catalogue.rows.length);
    for (const line of lines) {
      const [outcome = '', country = '', sector = '', sizeClass = '', low = '', likely = '', high = '', notMeasured = '', sources = ''] = parseCsvLine(line);
      const row = readTefCatalogueRow(catalogue, TEF_OUTCOME_BY_KEY[outcome] ?? '', country, sector, sizeClass);
      expect({ country: row.country, sector: row.sector, sizeClass: row.sizeClass, low: row.low, likely: row.likely, high: row.high, notMeasured: row.notMeasured.join(';'), sources: row.sourceIds.join(';') })
        .toEqual({ country, sector, sizeClass, low: Number(low), likely: Number(likely), high: Number(high), notMeasured, sources });
    }
  });
});

describe('the fallback rule', () => {
  const R = AttackOutcome_Ransomware;
  const everySize = (profile: string, value: number, notMeasured = ''): Array<string> =>
    TEF_SIZE_CLASSES.map((sizeClass) => `${profile},${sizeClass},${value},${value},${value},${notMeasured},s`);
  const catalogue = loadTefCataloguePackage(packageOf([
    ...everySize('ransomware,FR,Finance', 1),
    ...everySize('ransomware,FR,*', 2),
    'ransomware,FR,*,*,3,3,3,,s',
    ...everySize('ransomware,*,Finance', 4, 'country'),
    ...everySize('ransomware,*,*', 5, 'country'),
    'ransomware,*,*,*,6,6,6,country;sector;size,s',
  ]), SECTORS);
  const read = (country: string, sector: string, sizeClass: string): number => readTefCatalogueRow(catalogue, R, country, sector, sizeClass).likely;

  it('reads the exact row, else every sector, then every size, then the same for every country', () => {
    expect(read('FR', 'Finance', '50-249')).toBe(1);
    expect(read('FR', 'Health', '50-249')).toBe(2);
    expect(read('FR', 'Health', '*')).toBe(3);
    expect(read('JP', 'Finance', '50-249')).toBe(4);
    expect(read('JP', 'Health', '50-249')).toBe(5);
    expect(read('JP', 'Health', '*')).toBe(6);
  });

  it('reads an absent country or sector as the row for every value, and an absent size as every class alike', () => {
    const lookup = lookupTefCatalogue(catalogue, { countryIsoAlpha2: null, sector: null, employeeCount: null, revenueBand: null }, R);
    expect(lookup).toMatchObject({ country: '*', sector: '*', sizeSource: 'none', notMeasured: ['country'], sourceIds: ['s'] });
    expect(lookup.likely).toBeCloseTo(5, 12);
    expect(lookup.sizeClasses).toEqual(TEF_SIZE_CLASSES.map((sizeClass) => ({ sizeClass, weight: 1 / 6 })));
  });
});

describe('the size class', () => {
  it('reads an employee count at the class edges', () => {
    expect([0, 1, 9, 10, 49, 50, 249, 250, 999, 1000, 4999, 5000].map(sizeClassOfEmployees))
      .toEqual(['0-9', '0-9', '0-9', '10-49', '10-49', '50-249', '50-249', '250-999', '250-999', '1000-4999', '1000-4999', '5000+']);
  });

  it('reads a declared count of zero employees as the smallest class, not as an undeclared count', () => {
    const read = lookupTefCatalogue(currentTefCatalogue(), { countryIsoAlpha2: 'FR', sector: 'Finance', employeeCount: 0, revenueBand: '10m_100m' }, AttackOutcome_Ransomware);
    expect(read.sizeSource).toBe('employee_count');
    expect(read.sizeClasses).toEqual([{ sizeClass: '0-9', weight: 1 }]);
  });

  it('spreads a revenue band over the classes it spans, weights summing to 1', () => {
    expect(revenueBandSizeClasses('under_10m').map((share) => [share.sizeClass, Math.round(share.weight * 1000) / 1000]))
      .toEqual([['0-9', 0.275], ['10-49', 0.506], ['50-249', 0.218]]);
    for (const band of ['10m_100m', '100m_1b', '1b_10b', '10b_100b', 'over_100b'] as const) {
      expect(revenueBandSizeClasses(band).reduce((sum, share) => sum + share.weight, 0)).toBeCloseTo(1, 12);
    }
  });

  it('reads a profile with no employee count as the classes its revenue band spans, each point mixed by weight', () => {
    const catalogue = currentTefCatalogue();
    const byRevenue = lookupTefCatalogue(catalogue, { countryIsoAlpha2: 'FR', sector: 'Finance', employeeCount: null, revenueBand: '10m_100m' }, AttackOutcome_Ransomware);
    expect(byRevenue.sizeSource).toBe('revenue_band');
    expect(byRevenue.sizeClasses.map((share) => share.sizeClass)).toEqual(['10-49', '50-249', '250-999']);
    const rows = byRevenue.sizeClasses.map(({ sizeClass, weight }) => ({ weight, row: readTefCatalogueRow(catalogue, AttackOutcome_Ransomware, 'FR', 'Finance', sizeClass) }));
    const mixed = (point: (row: { low: number, likely: number, high: number }) => number): number => rows.reduce((sum, { weight, row }) => sum + weight * point(row), 0);
    expect(byRevenue.low).toBeCloseTo(mixed((row) => row.low), 12);
    expect(byRevenue.likely).toBeCloseTo(mixed((row) => row.likely), 12);
    expect(byRevenue.high).toBeCloseTo(mixed((row) => row.high), 12);
  });

  it('reads a profile with no size as every class, each point averaged alike', () => {
    const catalogue = currentTefCatalogue();
    const unsized = lookupTefCatalogue(catalogue, { countryIsoAlpha2: 'FR', sector: 'Finance', employeeCount: null, revenueBand: null }, AttackOutcome_Ransomware);
    expect(unsized.sizeSource).toBe('none');
    const rows = TEF_SIZE_CLASSES.map((sizeClass) => readTefCatalogueRow(catalogue, AttackOutcome_Ransomware, 'FR', 'Finance', sizeClass));
    const averaged = (point: (row: { low: number, likely: number, high: number }) => number): number => rows.reduce((sum, row) => sum + point(row), 0) / rows.length;
    expect(unsized.low).toBeCloseTo(averaged((row) => row.low), 12);
    expect(unsized.likely).toBeCloseTo(averaged((row) => row.likely), 12);
    expect(unsized.high).toBeCloseTo(averaged((row) => row.high), 12);
  });
});

describe('a package the platform refuses', () => {
  it('names an unknown schema version', () => {
    expect(errorsOf(packageOf(['ransomware,FR,*,*,1,1,1,,s'], { ...MANIFEST, schema: 'opencrq-tef-catalogue/2' }))[0]).toMatch(/schema is opencrq-tef-catalogue\/2/);
  });

  it.each(['2026-11-08', '1.0.0-rc.1', '1.0.0+build.7'])('names a version that is not MAJOR.MINOR.PATCH, such as %s', (version) => {
    expect(errorsOf(packageOf(['ransomware,FR,*,*,1,1,1,,s'], { version }))[0]).toMatch(/version: is not a Semantic Versioning MAJOR.MINOR.PATCH/);
  });

  it('names an id that is not a slug', () => {
    expect(errorsOf(packageOf(['ransomware,FR,*,*,1,1,1,,s'], { id: '../outside' }))[0]).toMatch(/id: is not a lowercase slug/);
  });

  it('names rows that are not the ones the digest was taken on', () => {
    const files = packageOf(['ransomware,FR,*,*,1,1,1,,s']);
    expect(errorsOf({ ...files, rowsCsv: files.rowsCsv.replaceAll('\n', '\r\n') })[0]).toMatch(/digest .* is not the SHA-256 of rows\.csv/);
  });

  it('names keys outside the taxonomy, broken ranges, unknown sources and repeated keys', () => {
    const errors = errorsOf(packageOf([
      'phishing,FR,*,*,1,1,1,,s',
      'toString,FR,*,*,1,1,1,,s',
      'ransomware,FRA,*,*,1,1,1,,s',
      'ransomware,FR,Banking,*,1,1,1,,s',
      'ransomware,FR,*,51-249,1,1,1,,s',
      'ransomware,FR,Finance,*,3,2,1,,s',
      'ransomware,FR,Health,*,1,1,1,region,s',
      'ransomware,FR,Energy,*,1,1,1,,other',
      'ransomware,FR,*,*,1,1,1,,s',
      'ransomware,FR,*,*,1,1,1,,s',
    ]));
    for (const expected of [/outcome phishing/, /outcome toString/, /country FRA/, /sector Banking/, /size class 51-249/, /low <= likely <= high \(3/, /not_measured region/, /source other/, /repeats ransomware, FR, \*, \*/]) {
      expect(errors.some((error) => expected.test(error)), `${expected} in ${errors.join(' / ')}`).toBe(true);
    }
  });

  it('names a country and sector holding rows for some size classes only', () => {
    expect(errorsOf(packageOf(['ransomware,*,*,*,1,1,1,,s', 'ransomware,FR,Finance,50-249,1,1,1,,s', 'ransomware,FR,Finance,5000+,1,1,1,,s'])))
      .toEqual(['rows.csv has ransomware, FR, Finance for some size classes but not 0-9, 10-49, 250-999, 1000-4999']);
  });

  it('names an outcome without its row for every country, sector and size', () => {
    expect(errorsOf(packageOf(['ransomware,*,*,*,1,1,1,,s', 'espionage,FR,*,*,1,1,1,,s'])))
      .toEqual(['rows.csv has no espionage, *, *, * row, which every fallback for espionage ends on']);
  });

  it('reads a source with only an id, a title and a publisher, its other fields null', () => {
    const catalogue = loadTefCataloguePackage(packageOf(['ransomware,*,*,*,1,1,1,,s'], { sources: [{ id: 's', title: 'Survey', publisher: 'Office' }] }), SECTORS);
    expect(catalogue.sources).toEqual([{ id: 's', title: 'Survey', publisher: 'Office', url: null, licence: null, attribution: null, referencePeriod: null }]);
  });

  it('names a manifest source no row reads', () => {
    expect(errorsOf(packageOf(['ransomware,*,*,*,1,1,1,,s'], { ...MANIFEST, sources: [...MANIFEST.sources, { ...MANIFEST.sources[0], id: 'idle' }] })))
      .toEqual(['source idle is listed but no row reads it']);
  });
});
