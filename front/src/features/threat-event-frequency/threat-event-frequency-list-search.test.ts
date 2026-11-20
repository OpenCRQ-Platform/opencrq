import { describe, expect, it } from 'vitest';
import { threatEventFrequencyListSearchSchema, threatEventFrequencyScopesListSearchSchema } from './threat-event-frequency-list-search';

const ID = '0199b6a2-7c1e-7f3a-9d2b-1c4e5f6a7b8c';

describe('threatEventFrequencyListSearchSchema', () => {
  it('should read an absent profile as the starting one', () => {
    expect(threatEventFrequencyListSearchSchema.parse({})).toEqual({});
  });

  it('should keep an attack outcome id', () => {
    expect(threatEventFrequencyListSearchSchema.parse({ outcome: ID })).toEqual({ outcome: ID });
  });

  it('should drop an outcome that is no id rather than fail the page', () => {
    expect(threatEventFrequencyListSearchSchema.parse({ outcome: 'ransomware' })).toEqual({ outcome: undefined });
  });

  it('should keep a starting scope and a profile', () => {
    const search = { from: ID, sectorId: ID, countryId: ID, size: '1000-4999', revenueBand: '1b_10b' };
    expect(threatEventFrequencyListSearchSchema.parse(search)).toEqual(search);
  });

  it('should drop a profile part that is no id or no revenue band', () => {
    expect(threatEventFrequencyListSearchSchema.parse({ from: 'acme', sectorId: 'finance', size: '7', revenueBand: 'huge' }))
      .toEqual({ from: undefined, sectorId: undefined, size: undefined, revenueBand: undefined });
  });
});

describe('threatEventFrequencyScopesListSearchSchema', () => {
  it('should read an absent search as the empty one', () => {
    expect(threatEventFrequencyScopesListSearchSchema.parse({})).toEqual({ search: '' });
  });

  it('should read a search the router parsed as a number back as the text typed', () => {
    expect(threatEventFrequencyScopesListSearchSchema.parse({ search: 2026 })).toEqual({ search: '2026' });
  });
});
