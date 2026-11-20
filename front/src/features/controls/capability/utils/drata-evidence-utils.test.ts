import { describe, expect, it } from 'vitest';
import { filterDrataEvidence, readyCountOf } from './drata-evidence-utils';

const controls = [
  { code: 'DCF-58', name: 'Unique account identifiers', isReady: true },
  { code: 'DCF-68', name: 'Multi-factor authentication', isReady: false },
  { code: 'DCF-338', name: 'Access reviews', isReady: false },
];

describe('filterDrataEvidence', () => {
  it('keeps every control without a filter', () => {
    expect(filterDrataEvidence(controls, { search: '', notReadyOnly: false })).toHaveLength(3);
  });

  it('keeps the controls not ready', () => {
    expect(filterDrataEvidence(controls, { search: '', notReadyOnly: true }).map((control) => control.code))
      .toEqual(['DCF-68', 'DCF-338']);
  });

  it('matches the code or the name, ignoring case and surrounding spaces', () => {
    expect(filterDrataEvidence(controls, { search: ' dcf-58 ', notReadyOnly: false }).map((control) => control.code)).toEqual(['DCF-58']);
    expect(filterDrataEvidence(controls, { search: 'ACCESS', notReadyOnly: false }).map((control) => control.code)).toEqual(['DCF-338']);
  });

  it('applies the search and the readiness filter together', () => {
    expect(filterDrataEvidence(controls, { search: 'unique', notReadyOnly: true })).toEqual([]);
  });
});

describe('readyCountOf', () => {
  it('counts the ready controls', () => {
    expect(readyCountOf(controls)).toBe(1);
  });
});

describe('filterDrataEvidence accents', () => {
  const accented = [
    { code: 'A-1', name: 'École Straße', isReady: true },
    { code: 'A-2', name: 'ecole plain', isReady: true },
  ];
  const codes = (search: string) => filterDrataEvidence(accented, { search, notReadyOnly: false }).map((control) => control.code);

  it('should find an accented name from its plain spelling, and the reverse', () => {
    expect(codes('strasse')).toEqual(['A-1']);
    expect(codes('ecole')).toEqual(['A-1', 'A-2']);
    expect(codes('éco')).toEqual(['A-1', 'A-2']);
  });
});
