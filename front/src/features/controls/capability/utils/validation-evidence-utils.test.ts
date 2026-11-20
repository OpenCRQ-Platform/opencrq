import { describe, expect, it } from 'vitest';
import { evidenceLineFilters, heldShare, isFiltered, techniqueFilterOptions } from './validation-evidence-utils';

describe('techniqueFilterOptions', () => {
  const techniques = [{ externalId: 'T1055', name: 'Process Injection' }];

  it('labels each technique with its id and name', () => {
    expect(techniqueFilterOptions(techniques, undefined)).toEqual([{ value: 'T1055', label: 'T1055 – Process Injection' }]);
  });

  it('offers the technique the address names by its id when no line is filed on it', () => {
    expect(techniqueFilterOptions(techniques, 'T1003')).toEqual([
      { value: 'T1003', label: 'T1003' },
      { value: 'T1055', label: 'T1055 – Process Injection' },
    ]);
  });

  it('offers the technique the address names while the options load', () => {
    expect(techniqueFilterOptions(undefined, 'T1055')).toEqual([{ value: 'T1055', label: 'T1055' }]);
  });
});

describe('evidenceLineFilters', () => {
  it('maps every "all" to no filter', () => {
    const filters = evidenceLineFilters({ technique: undefined, function: 'all', result: 'all', family: undefined }, ['EDR']);

    expect(filters).toEqual({ technique: undefined, function: undefined, result: undefined, securityPlatformType: undefined });
    expect(isFiltered(filters)).toBe(false);
  });

  it('keeps the filters the address sets', () => {
    const filters = evidenceLineFilters({ technique: 'T1055', function: 'prevent', result: 'validated', family: 'EDR' }, ['EDR']);

    expect(filters).toEqual({ technique: 'T1055', function: 'prevent', result: 'validated', securityPlatformType: 'EDR' });
    expect(isFiltered(filters)).toBe(true);
  });

  it('reads a family the control does not have as every family', () => {
    expect(evidenceLineFilters({ technique: undefined, function: 'all', result: 'all', family: 'XDR' }, ['EDR']).securityPlatformType).toBeUndefined();
  });
});

describe('heldShare', () => {
  it('is the share of the assets that held', () => {
    expect(heldShare({ validated: 3, contradicted: 1 })).toBe(0.75);
  });

  it('is nothing for a line without an asset', () => {
    expect(heldShare({ validated: 0, contradicted: 0 })).toBe(0);
  });
});
