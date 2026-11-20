import { TEF_EVERY_SIZE } from '@app/module/client';
import { describe, expect, it } from 'vitest';
import type { FrequencyProfile, ScopeIdentity, TefCatalog, TefRead, TefReading, TefScopeReading } from './threat-event-frequency-utils';
import {
  choicesFor,
  matchingScopes,
  outcomesByFrequency,
  profileNotes,
  rangePercent,
  ratioFractionDigits,
  recurrence,
  sameProfile,
  scenarioTefGap,
  scopeFrequencyRows,
  scopeSizeSortKey,
  simulatedProfile,
  sizeChoiceOf,
  sizeClassBounds,
  startingProfile,
} from './threat-event-frequency-utils';

const FINANCE_ID = '019e0000-0000-7000-8000-000000000001';
const HEALTH_ID = '019e0000-0000-7000-8000-000000000002';
const USA_ID = '019e0000-0000-7000-8000-000000000003';
const FRANCE_ID = '019e0000-0000-7000-8000-000000000004';

const CATALOG: TefCatalog = {
  id: 'opencrq-open-data',
  version: '1.0.0',
  builtOn: '2026-11-08',
  publisher: 'Filigran',
  sources: [],
  sizeClasses: ['0-9', '10-49', '50-249', '250-999', '1000-4999', '5000+'],
  outcomes: [],
  sectors: [{ id: FINANCE_ID, name: 'Finance', measured: true }, { id: HEALTH_ID, name: 'Health', measured: true }],
  countries: [{ id: FRANCE_ID, name: 'France', isoAlpha3: 'FRA', readAs: 'FR' }, { id: USA_ID, name: 'United States of America', isoAlpha3: 'USA', readAs: 'US' }],
  revenueBands: [],
};

const read = (overrides: Partial<TefRead> = {}): TefRead => ({
  catalogue: { id: CATALOG.id, version: CATALOG.version },
  countryIsoAlpha3: 'FRA',
  sectorName: 'Finance',
  sizeSource: 'employee_count',
  country: 'FR',
  sector: 'Finance',
  sizeClasses: [{ sizeClass: '50-249', weight: 1 }],
  low: 0.1,
  likely: 0.2,
  high: 0.6,
  notMeasured: [],
  sources: [],
  ...overrides,
});

const FRANCE: FrequencyProfile = { countryId: FRANCE_ID, sectorId: FINANCE_ID, employeeCount: 120, revenueBand: null };

describe('size classes', () => {
  it('should read a class\'s headcount bounds, the open class with none above', () => {
    expect(sizeClassBounds('1000-4999')).toEqual({ from: 1000, to: 4999 });
    expect(sizeClassBounds('5000+')).toEqual({ from: 5000, to: null });
    expect(sizeClassBounds('0-9')).toEqual({ from: 0, to: 9 });
  });
});

describe('startingProfile', () => {
  it('should start without a risk scope from Finance in the United States, sized by a revenue band', () => {
    expect(startingProfile(CATALOG, undefined)).toEqual({ countryId: USA_ID, sectorId: FINANCE_ID, employeeCount: null, revenueBand: '100m_1b' });
  });

  it('should read a sector or country the tenant no longer has as unset', () => {
    expect(startingProfile(CATALOG, { ...FRANCE, sectorId: '019e0000-0000-7000-8000-0000000000ff' })).toEqual({ ...FRANCE, sectorId: null });
  });
});

describe('simulatedProfile', () => {
  it('should keep the starting scope\'s headcount while its class is the one chosen', () => {
    expect(simulatedProfile(CATALOG, { size: '50-249' }, FRANCE).employeeCount).toBe(120);
  });

  it('should read another class at its lowest headcount, and no headcount for an unknown size', () => {
    expect(simulatedProfile(CATALOG, { size: '1000-4999' }, FRANCE).employeeCount).toBe(1000);
    expect(simulatedProfile(CATALOG, { size: '0-9' }, FRANCE).employeeCount).toBe(0);
    expect(simulatedProfile(CATALOG, { size: 'unknown', revenueBand: '1b_10b' }, FRANCE)).toEqual({ ...FRANCE, employeeCount: null, revenueBand: '1b_10b' });
  });

  it('should ignore a country the tenant does not have', () => {
    expect(simulatedProfile(CATALOG, { countryId: '019e0000-0000-7000-8000-0000000000ff' }, FRANCE)).toEqual(FRANCE);
  });

  it('should round-trip a changed profile through the choices the address keeps', () => {
    const changed = simulatedProfile(CATALOG, { countryId: USA_ID, size: '5000+' }, FRANCE);
    expect(choicesFor(changed, FRANCE)).toEqual({ countryId: USA_ID, sectorId: undefined, size: '5000+', revenueBand: undefined });
    expect(sameProfile(simulatedProfile(CATALOG, choicesFor(changed, FRANCE), FRANCE), changed)).toBe(true);
    expect(sizeChoiceOf({ ...FRANCE, employeeCount: null })).toBe('unknown');
    expect(sizeChoiceOf({ ...FRANCE, employeeCount: 0 })).toBe('0-9');
  });
});

describe('recurrence', () => {
  it('should read under a year in months, and a rate of zero as never', () => {
    expect(recurrence(2)).toEqual({ unit: 'months', value: 6 });
    expect(recurrence(0.25)).toEqual({ unit: 'years', value: 4 });
    expect(recurrence(0)).toBeUndefined();
  });
});

describe('rangePercent', () => {
  it('should place four decades, 0.01 to 100, across the bar and clip beyond them', () => {
    expect(rangePercent(0.01)).toBe(0);
    expect(rangePercent(1)).toBe(50);
    expect(rangePercent(1000)).toBe(100);
    expect(rangePercent(0)).toBe(0);
  });
});

describe('profileNotes', () => {
  it('should note nothing for a row that measures the whole profile', () => {
    expect(profileNotes([read()])).toEqual({ country: null, sector: null, size: null });
  });

  it('should tell a country the catalogue does not cover from one read on a pooled level', () => {
    expect(profileNotes([read({ country: '*', notMeasured: ['country'] })]).country).toBe('not_covered');
    expect(profileNotes([read({ notMeasured: ['country'] })]).country).toBe('pooled');
    expect(profileNotes([read({ countryIsoAlpha3: null, country: '*' })]).country).toBe('unset');
  });

  it('should tell a sector read on every sector from one measured in other countries', () => {
    expect(profileNotes([read({ sector: null, notMeasured: ['sector'] })]).sector).toBe('every_sector');
    expect(profileNotes([read({ notMeasured: ['sector'] })]).sector).toBe('other_countries');
  });

  it('should name the classes a revenue band spans, and the class a headcount extends', () => {
    const byRevenue = read({ sizeSource: 'revenue_band', sizeClasses: [{ sizeClass: '50-249', weight: 0.3 }, { sizeClass: '250-999', weight: 0.3 }, { sizeClass: '5000+', weight: 0.4 }] });
    expect(profileNotes([byRevenue]).size).toEqual({ kind: 'revenue_band', from: '50-249', to: '5000+' });
    expect(profileNotes([read({ sizeClasses: [{ sizeClass: '5000+', weight: 1 }], notMeasured: ['size'] })]).size).toEqual({ kind: 'extended', sizeClass: '5000+' });
    expect(profileNotes([read({ sizeSource: 'none', sizeClasses: [...TEF_EVERY_SIZE], notMeasured: ['size'] })]).size).toEqual({ kind: 'unset' });
  });

  it('should name the widest read any outcome falls back to', () => {
    expect(profileNotes([read({ notMeasured: ['sector'] }), read({ sector: null }), read()]).sector).toBe('every_sector');
  });
});

describe('scenarioTefGap', () => {
  const current = read({ likely: 0.4 });

  it('should flag a typed value apart from the catalogue at the precision it was typed', () => {
    expect(scenarioTefGap({ tefMode: 'manual', likely: 0.4, read: null }, read({ likely: 0.4004 }))).toBeNull();
    expect(scenarioTefGap({ tefMode: 'manual', likely: 1, read: null }, current)).toBe('manual');
  });

  it('should take an auto estimate the catalogue in force gives today as current', () => {
    expect(scenarioTefGap({ tefMode: 'auto', likely: 0.4, read: read({ likely: 0.4 }) }, current)).toBeNull();
    expect(scenarioTefGap({ tefMode: 'auto', likely: null, read: null }, current)).toBeNull();
  });

  it('should flag an auto estimate read for another profile, from another catalogue, or from a vintage', () => {
    expect(scenarioTefGap({ tefMode: 'auto', likely: 0.25, read: read({ likely: 0.25 }) }, current)).toBe('stale');
    expect(scenarioTefGap({ tefMode: 'auto', likely: 0.4, read: read({ likely: 0.4, catalogue: { id: CATALOG.id, version: '0.9.0' } }) }, current)).toBe('stale');
    expect(scenarioTefGap({ tefMode: 'auto', likely: 0.4, read: null }, current)).toBe('stale');
  });
});

describe('ratioFractionDigits', () => {
  it('should keep one decimal unless the ratio would then read 1', () => {
    expect(ratioFractionDigits(2.94)).toBe(1);
    expect(ratioFractionDigits(1.025)).toBe(2);
    expect(ratioFractionDigits(0.996)).toBe(3);
    expect(ratioFractionDigits(1.0004)).toBe(3);
  });
});

describe('scopeSizeSortKey', () => {
  const readingSpanning = (sizeSource: TefRead['sizeSource'], sizeClasses: TefRead['sizeClasses']): TefReading => ({
    outcomes: [{ attackOutcomeId: '019e0000-0000-7000-8000-0000000000a1', name: 'Ransomware', read: read({ sizeSource, sizeClasses }) }],
    total: { low: 0.1, likely: 0.2, high: 0.6 },
  });

  it('should sort a scope by its headcount, 0 included', () => {
    expect(scopeSizeSortKey({ employeeCount: 0 }, readingSpanning('employee_count', [{ sizeClass: '0-9', weight: 1 }]))).toBe(0);
    expect(scopeSizeSortKey({ employeeCount: 3 }, readingSpanning('employee_count', [{ sizeClass: '0-9', weight: 1 }]))).toBe(3);
  });

  it('should sort a scope sized by its revenue band at the floor of the smallest class it spans', () => {
    expect(scopeSizeSortKey({ employeeCount: null }, readingSpanning('revenue_band', [{ sizeClass: '5000+', weight: 0.6 }, { sizeClass: '50-249', weight: 0.4 }]))).toBe(50);
  });

  it('should sort a scope with no size below every sized one', () => {
    expect(scopeSizeSortKey({ employeeCount: null }, readingSpanning('none', [...TEF_EVERY_SIZE]))).toBe(-1);
  });
});

describe('scope rows', () => {
  const scope = (id: string, name: string): ScopeIdentity => ({ ...FRANCE, id, name });
  const reading = (organizationId: string, ransomware: number, fraud: number, total: number): TefScopeReading => ({
    organizationId,
    outcomes: [
      { attackOutcomeId: 'ransomware', name: 'Ransomware', read: read({ likely: ransomware }) },
      { attackOutcomeId: 'fraud', name: 'Fraud', read: read({ likely: fraud }) },
    ],
    total: { low: total / 2, likely: total, high: total * 2 },
  });
  const rows = scopeFrequencyRows(
    [scope('a', 'Atelier'), scope('b', 'Banque'), scope('c', 'Clinique')],
    [reading('a', 0.1, 0.2, 0.35), reading('b', 0.3, 0.9, 1.4)],
  );

  it('should rank the scopes with a reading by their total, most attempts first', () => {
    expect(rows.map((row) => row.scope.name)).toEqual(['Banque', 'Atelier']);
  });

  it('should keep the scopes whose name holds the search, whatever its accents', () => {
    expect(matchingScopes(rows, 'BANQUÉ').map((row) => row.scope.name)).toEqual(['Banque']);
  });

  it('should order the outcome columns by their attempts across the scopes', () => {
    expect(outcomesByFrequency(rows).map((outcome) => outcome.name)).toEqual(['Fraud', 'Ransomware']);
  });
});
