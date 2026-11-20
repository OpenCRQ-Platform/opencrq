import { describe, expect, it } from 'vitest';
import type { TechniqueTestCount } from './technique-test-results';
import { techniqueTestResultsOf } from './technique-test-results';

const EDR = 'edr';
const EHB = 'ehb';
const T1055 = 't1055';
const T1059 = 't1059';

const count = (over: Partial<TechniqueTestCount> = {}): TechniqueTestCount => ({
  capabilityId: EDR,
  expectationType: 'prevention',
  mitreTechniqueId: T1055,
  grain: 'technique',
  tests: 10,
  heldTests: 1,
  hostsTested: 10,
  ...over,
});

describe('techniqueTestResultsOf', () => {
  it('reads a count as the control\'s result on its function, the rate on the tests and the share on the level\'s hosts', () => {
    expect(techniqueTestResultsOf([count()], 20)).toEqual([{
      capabilityId: EDR,
      function: 'prevent',
      mitreTechniqueId: T1055,
      grain: 'technique',
      rate: 0.1,
      tests: 10,
      heldTests: 1,
      hostsTested: 10,
      scopeHosts: 20,
    }]);
  });

  it('reads a detection count on the detect function', () => {
    expect(techniqueTestResultsOf([count({ expectationType: 'detection', heldTests: 10 })], 20))
      .toEqual([expect.objectContaining({ function: 'detect', rate: 1 })]);
  });

  it('stores nothing when the level holds no host', () => {
    expect(techniqueTestResultsOf([count()], 0)).toEqual([]);
  });

  it('never stores more hosts tested than the level holds', () => {
    expect(techniqueTestResultsOf([count({ hostsTested: 25 })], 20)).toEqual([expect.objectContaining({ hostsTested: 25, scopeHosts: 25 })]);
  });

  it('orders the results by control, function and technique, whatever order the counts came in', () => {
    const results = techniqueTestResultsOf([
      count({ capabilityId: EHB, mitreTechniqueId: T1059 }),
      count({ expectationType: 'detection' }),
      count(),
    ], 20);
    expect(results.map(({ capabilityId, function: fn }) => `${capabilityId}|${fn}`)).toEqual(['edr|detect', 'edr|prevent', 'ehb|prevent']);
  });
});
