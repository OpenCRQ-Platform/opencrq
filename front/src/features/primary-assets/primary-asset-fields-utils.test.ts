import { describe, expect, it } from 'vitest';
import {
  businessFunctionSuggestions,
  durationMinutes,
  filterByNativeFields,
  isReferenceTaken,
  isRtoAboveMtpd,
  overallSecurityNeed,
  resolveBusinessFunctionFilter,
  securityNeedRank,
  splitDuration,
} from './primary-asset-fields-utils';

describe('overallSecurityNeed', () => {
  it('should be null when no criterion is set', () => {
    expect(overallSecurityNeed({ availability: null, integrity: null, confidentiality: null, traceability: null })).toBeNull();
  });

  it('should take the highest level set', () => {
    expect(overallSecurityNeed({ availability: 'medium', integrity: 'high', confidentiality: 'low', traceability: null })).toBe('high');
  });

  it('should count traceability like the three others', () => {
    expect(overallSecurityNeed({ availability: 'low', integrity: null, confidentiality: 'low', traceability: 'very_high' })).toBe('very_high');
  });
});

describe('securityNeedRank', () => {
  it('should rank an unset level below low', () => {
    expect(securityNeedRank(null)).toBeLessThan(securityNeedRank('low'));
    expect(securityNeedRank('high')).toBeLessThan(securityNeedRank('very_high'));
  });
});

describe('splitDuration', () => {
  it('should default a blank duration to hours', () => {
    expect(splitDuration(null)).toEqual({ amount: null, unit: 'hours' });
  });

  it('should pick the largest whole unit', () => {
    expect(splitDuration(2 * 24 * 60)).toEqual({ amount: 2, unit: 'days' });
    expect(splitDuration(36 * 60)).toEqual({ amount: 36, unit: 'hours' });
    expect(splitDuration(90)).toEqual({ amount: 90, unit: 'minutes' });
  });

  it('should read zero as minutes', () => {
    expect(splitDuration(0)).toEqual({ amount: 0, unit: 'minutes' });
  });
});

describe('durationMinutes', () => {
  it('should convert each unit to minutes', () => {
    expect(durationMinutes({ amount: 4, unit: 'hours' })).toBe(240);
    expect(durationMinutes({ amount: 1, unit: 'days' })).toBe(1440);
    expect(durationMinutes({ amount: 15, unit: 'minutes' })).toBe(15);
  });

  it('should round a fraction to the minute', () => {
    expect(durationMinutes({ amount: 1.5, unit: 'hours' })).toBe(90);
    expect(durationMinutes({ amount: 0.01, unit: 'hours' })).toBe(1);
  });

  it('should keep a blank amount blank', () => {
    expect(durationMinutes({ amount: null, unit: 'days' })).toBeNull();
  });

  it('should read back what splitDuration produced', () => {
    for (const minutes of [0, 45, 240, 1440, 2160]) {
      expect(durationMinutes(splitDuration(minutes))).toBe(minutes);
    }
  });
});

describe('isRtoAboveMtpd', () => {
  it('should flag an RTO beyond the MTPD only', () => {
    expect(isRtoAboveMtpd(480, 240)).toBe(true);
    expect(isRtoAboveMtpd(240, 240)).toBe(false);
    expect(isRtoAboveMtpd(240, null)).toBe(false);
    expect(isRtoAboveMtpd(null, 240)).toBe(false);
  });
});

describe('businessFunctionSuggestions', () => {
  it('should list each function once, trimmed and sorted', () => {
    const rows = [
      { businessFunction: 'Finance' },
      { businessFunction: ' Engineering ' },
      { businessFunction: null },
      { businessFunction: 'finance' },
      { businessFunction: '   ' },
    ];
    expect(businessFunctionSuggestions(rows)).toEqual(['Engineering', 'Finance']);
  });

  it('should treat accents as the same function', () => {
    expect(businessFunctionSuggestions([{ businessFunction: 'Ingénierie' }, { businessFunction: 'Ingenierie' }])).toEqual(['Ingénierie']);
  });
});

describe('isReferenceTaken', () => {
  const rows = [{ id: 'a', reference: 'FIN-03' }, { id: 'b', reference: null }];

  it('should find a reference another asset holds', () => {
    expect(isReferenceTaken(rows, ' FIN-03 ', null)).toBe(true);
  });

  it('should ignore the asset being edited', () => {
    expect(isReferenceTaken(rows, 'FIN-03', 'a')).toBe(false);
  });

  it('should never flag a blank reference', () => {
    expect(isReferenceTaken(rows, '  ', null)).toBe(false);
    expect(isReferenceTaken(rows, null, null)).toBe(false);
  });

  it('should keep the case, as the server does', () => {
    expect(isReferenceTaken(rows, 'fin-03', null)).toBe(false);
  });
});

describe('filterByNativeFields', () => {
  const unset = { availability: null, integrity: null, confidentiality: null, traceability: null };
  const rows = [
    { id: 'billing', businessFunction: 'Finance', ...unset, availability: 'high' as const },
    { id: 'payroll', businessFunction: 'finance ', ...unset, confidentiality: 'medium' as const },
    { id: 'deploy', businessFunction: 'Engineering', ...unset },
    { id: 'blank', businessFunction: null, ...unset },
  ];
  const ids = (filtered: Array<{ id: string }>) => filtered.map((row) => row.id);

  it('should keep every row with no filter', () => {
    expect(ids(filterByNativeFields(rows, { businessFunction: '', level: 'all' }))).toEqual(['billing', 'payroll', 'deploy', 'blank']);
  });

  it('should match a business function whatever its case and spaces', () => {
    expect(ids(filterByNativeFields(rows, { businessFunction: 'Finance', level: 'all' }))).toEqual(['billing', 'payroll']);
  });

  it('should match the overall level', () => {
    expect(ids(filterByNativeFields(rows, { businessFunction: '', level: 'high' }))).toEqual(['billing']);
  });

  it('should keep the rows with no level set for not_set', () => {
    expect(ids(filterByNativeFields(rows, { businessFunction: '', level: 'not_set' }))).toEqual(['deploy', 'blank']);
  });

  it('should combine both filters', () => {
    expect(ids(filterByNativeFields(rows, { businessFunction: 'finance', level: 'medium' }))).toEqual(['payroll']);
  });
});

describe('resolveBusinessFunctionFilter', () => {
  it('should keep the value while the options load', () => {
    expect(resolveBusinessFunctionFilter('Finance', undefined)).toBe('Finance');
  });

  it('should return the surviving spelling of the same function', () => {
    expect(resolveBusinessFunctionFilter('Finance', ['finance', 'Lending'])).toBe('finance');
    expect(resolveBusinessFunctionFilter('ingenierie', ['Ingénierie'])).toBe('Ingénierie');
  });

  it('should drop a function no asset holds any more', () => {
    expect(resolveBusinessFunctionFilter('Finance', ['Lending'])).toBe('');
  });

  it('should leave no filter as no filter', () => {
    expect(resolveBusinessFunctionFilter('', ['Lending'])).toBe('');
  });
});
