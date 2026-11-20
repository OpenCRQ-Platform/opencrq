import { describe, expect, it } from 'vitest';
import type { CapabilityEdge } from '../types/capability';
import type { ControlTechniqueTestReading, TechniqueTestOutcome } from '../types/validation';
import {
  hasTestedReading,
  isEfficacySegment,
  isLinkedTechnique,
  isRemovedTechnique,
  pricedTechniqueIds,
  readingsByTechnique,
  readingsWithoutEdge,
  techniquesByVerdict,
  testedUncoveredReadings,
  verdictOfTechnique,
} from './control-technique-readings-utils';

const DECLARED = 0.5;

const tested = (heldTests: number, hostsTested: number, scopeHosts: number): TechniqueTestOutcome =>
  ({ tests: hostsTested, heldTests, rate: heldTests / hostsTested, hostsTested, scopeHosts, share: hostsTested / scopeHosts });

const reading = (mitreTechniqueId: string, outcome: TechniqueTestOutcome | null): ControlTechniqueTestReading => ({
  covered: true,
  capabilityId: 'edr',
  function: 'prevent',
  mitreTechniqueId,
  techniqueExternalId: mitreTechniqueId.toUpperCase(),
  techniqueName: mitreTechniqueId,
  familyTechniqueId: mitreTechniqueId,
  parentEfficacy: null,
  declaration: null,
  declared: DECLARED,
  efficacy: outcome === null ? DECLARED : Math.min(DECLARED, (1 - outcome.share) * DECLARED + outcome.share * outcome.rate),
  tested: outcome,
});

const READINGS = [
  reading('t1055', tested(1, 10, 20)),
  reading('t1059', tested(15, 15, 20)),
  reading('t1003', null),
];

describe('verdictOfTechnique', () => {
  it('reads a technique with no reading yet as untested', () => {
    expect(verdictOfTechnique(undefined)).toBe('untested');
  });

  it('reads the tests lowering or confirming the declaration', () => {
    const byTechnique = readingsByTechnique(READINGS);

    expect(verdictOfTechnique(byTechnique.get('t1055'))).toBe('lowered');
    expect(verdictOfTechnique(byTechnique.get('t1059'))).toBe('confirmed');
    expect(verdictOfTechnique(byTechnique.get('t1003'))).toBe('untested');
  });
});

describe('techniquesByVerdict', () => {
  it('puts every covered technique under exactly one verdict, an unanswered one under untested', () => {
    const byVerdict = techniquesByVerdict(['t1055', 't1059', 't1003', 't1068'], readingsByTechnique(READINGS));

    expect(byVerdict).toEqual({
      lowered: new Set(['t1055']),
      confirmed: new Set(['t1059']),
      untested: new Set(['t1003', 't1068']),
    });
  });

  it('counts only the techniques asked about', () => {
    const byVerdict = techniquesByVerdict(['t1059'], readingsByTechnique(READINGS));

    expect(byVerdict.lowered.size + byVerdict.confirmed.size + byVerdict.untested.size).toBe(1);
  });
});

const uncovered = (mitreTechniqueId: string, outcome: TechniqueTestOutcome | null): ControlTechniqueTestReading => ({
  covered: false,
  capabilityId: 'edr',
  function: 'prevent',
  mitreTechniqueId,
  techniqueExternalId: mitreTechniqueId.toUpperCase(),
  techniqueName: mitreTechniqueId,
  familyTechniqueId: mitreTechniqueId,
  tested: outcome,
});

describe('the techniques the engine does not read', () => {
  const readings = readingsByTechnique([...READINGS, uncovered('t1566', tested(0, 1, 20)), uncovered('t1204', null), reading('t1598', tested(1, 1, 20))]);

  it('keeps the tested ones for their filter, never one without a result', () => {
    expect(testedUncoveredReadings(readings).map((entry) => entry.mitreTechniqueId)).toEqual(['t1566']);
  });

  it('reads an unread technique as untested in the verdicts, which leave it out', () => {
    expect(verdictOfTechnique(readings.get('t1566'))).toBe('untested');
    expect(pricedTechniqueIds(['t1055', 't1059', 't1003', 't1204', 't1068'], readings).sort())
      .toEqual(['t1003', 't1055', 't1059', 't1068', 't1598']);
  });

  it('lists the readings with no edge by technique id', () => {
    expect(readingsWithoutEdge(readings, ['t1055', 't1059', 't1003', 't1204']).map((entry) => entry.techniqueExternalId)).toEqual(['T1566', 'T1598']);
  });
});

describe('hasTestedReading', () => {
  it('tells a control OpenAEV has a result for from one it has none for', () => {
    expect(hasTestedReading(READINGS)).toBe(true);
    expect(hasTestedReading([reading('t1003', null)])).toBe(false);
    expect(hasTestedReading(undefined)).toBe(false);
  });
});

describe('isEfficacySegment', () => {
  it('accepts the five filters and nothing else', () => {
    expect(['all', 'confirmed', 'lowered', 'untested', 'uncovered', 'met'].filter(isEfficacySegment)).toEqual(['all', 'confirmed', 'lowered', 'untested', 'uncovered']);
  });
});

describe('isLinkedTechnique and isRemovedTechnique', () => {
  const edge = (techniqueId: string, state: CapabilityEdge['state']): CapabilityEdge => ({
    techniqueId,
    techniqueExternalId: techniqueId.toUpperCase(),
    techniqueName: techniqueId,
    function: 'prevent',
    source: 'catalogue',
    state,
    tactics: [],
  });
  const EDGES = [edge('t1', 'recommended'), edge('t2', 'added'), edge('t3', 'removed')];

  it('should read a recommended or added edge as linked, never as removed', () => {
    expect(['t1', 't2'].map((id) => [isLinkedTechnique(EDGES, id), isRemovedTechnique(EDGES, id)])).toEqual([[true, false], [true, false]]);
  });

  it('should read a removed edge as removed and unlinked', () => {
    expect([isLinkedTechnique(EDGES, 't3'), isRemovedTechnique(EDGES, 't3')]).toEqual([false, true]);
  });

  it('should read a technique with no edge as neither', () => {
    expect([isLinkedTechnique(EDGES, 't4'), isRemovedTechnique(EDGES, 't4')]).toEqual([false, false]);
  });
});
