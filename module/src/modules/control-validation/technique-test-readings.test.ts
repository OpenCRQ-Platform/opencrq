import { describe, expect, it } from 'vitest';
import type {
  CoveredTechniqueTestReading,
  TechniqueControlCell,
  TechniqueControlTestReading,
  TechniqueDeclaration,
  TechniqueReadingCell,
} from './technique-test-readings';
import type { TechniqueTestResult } from './technique-test-results';
import { coverageCoefficient, STRENGTH_BY_RUNG } from '../controls/capability/constants';
import { PHISHING_STAGE_ANCHORS, PHISHING_STAGE_TECHNIQUES } from '../crq-indicators/engine/attack-run-constants';
import { coverageOfReadings, readTechniqueTests, readUncoveredTests } from './technique-test-readings';

const EDR = 'edr';
const T1055 = 't1055';
const T1055_012 = 't1055.012';
const T1059 = 't1059';
const L2_L2: TechniqueDeclaration = { strengthRung: 'L2', coverageBucket: 'L2', strength: STRENGTH_BY_RUNG.L2, coverage: coverageCoefficient('L2'), phishingStage: null };
/** L2 strength and L2 coverage on the engine's scale, about 50 %. */
const DECLARED = STRENGTH_BY_RUNG.L2 * coverageCoefficient('L2');

const cell = (over: Partial<TechniqueControlCell> = {}): TechniqueControlCell => ({
  capabilityId: EDR,
  function: 'prevent',
  mitreTechniqueId: T1055,
  parentTechniqueId: null,
  declaration: L2_L2,
  ...over,
});

const subTechniqueCell = (over: Partial<TechniqueControlCell> = {}): TechniqueControlCell =>
  cell({ mitreTechniqueId: T1055_012, parentTechniqueId: T1055, ...over });

/** One test per host unless `tests` says more. */
const result = (heldTests: number, hostsTested: number, scopeHosts: number, over: Partial<TechniqueTestResult> = {}): TechniqueTestResult => {
  const tests = over.tests ?? hostsTested;
  return {
    capabilityId: EDR,
    function: 'prevent',
    mitreTechniqueId: T1055,
    grain: 'technique',
    rate: heldTests / tests,
    tests,
    heldTests,
    hostsTested,
    scopeHosts,
    ...over,
  };
};

describe('readTechniqueTests', () => {
  it('reads T1055 prevention, 1 held of 10 tests on 10 of 20 hosts, at 30 % against the declared 50 %', () => {
    const [reading] = readTechniqueTests([cell()], [result(1, 10, 20)]);

    expect(reading).toEqual({
      covered: true,
      capabilityId: EDR,
      function: 'prevent',
      mitreTechniqueId: T1055,
      familyTechniqueId: T1055,
      declaration: L2_L2,
      declared: DECLARED,
      efficacy: expect.closeTo(0.30, 2),
      tested: { tests: 10, heldTests: 1, rate: 0.1, hostsTested: 10, scopeHosts: 20, share: 0.5 },
      parentEfficacy: null,
    });
    expect(reading.declared).toBeCloseTo(0.50, 2);
  });

  it('weighs every test, the tested share counting hosts', () => {
    const [reading] = readTechniqueTests([cell()], [result(3, 2, 20, { tests: 4 })]);

    expect(reading.tested).toEqual({ tests: 4, heldTests: 3, rate: 0.75, hostsTested: 2, scopeHosts: 20, share: 0.1 });
  });

  it('keeps the declaration where every test held', () => {
    const [reading] = readTechniqueTests([cell()], [result(15, 15, 20)]);

    expect(reading.efficacy).toBe(DECLARED);
    expect(reading.tested).toMatchObject({ heldTests: 15, tests: 15 });
  });

  it('reads an untested cell as not tested, on its declaration', () => {
    const [reading] = readTechniqueTests([cell()], []);

    expect(reading).toMatchObject({ efficacy: DECLARED, tested: null });
  });

  it('keeps each function to its own result', () => {
    const readings = readTechniqueTests(
      [cell(), cell({ function: 'detect' })],
      [result(1, 10, 20), result(10, 10, 20, { function: 'detect' })],
    );

    expect(readings.map((reading) => reading.efficacy)).toEqual([expect.closeTo(0.30, 2), DECLARED]);
  });

  it('keeps each control to its own result', () => {
    const [reading] = readTechniqueTests([cell({ capabilityId: 'other' })], [result(1, 10, 20)]);

    expect(reading.tested).toBeNull();
  });

  it('reads a technique on its family\'s row, never a sub-technique\'s', () => {
    const [reading] = readTechniqueTests([cell()], [
      result(0, 1, 20, { mitreTechniqueId: T1059 }),
      result(2, 2, 20, { mitreTechniqueId: T1055, grain: 'sub_technique' }),
      result(1, 10, 20),
    ]);

    expect(reading.tested).toMatchObject({ heldTests: 1, tests: 10 });
  });

  it('reads a sub-technique on its own row, its efficacy on its own result, beside its parent\'s', () => {
    const [reading] = readTechniqueTests([subTechniqueCell()], [
      result(1, 10, 20),
      result(1, 2, 20, { mitreTechniqueId: T1055_012, grain: 'sub_technique' }),
    ]);

    expect(reading).toMatchObject({
      familyTechniqueId: T1055,
      tested: { tests: 2, heldTests: 1, rate: 0.5, hostsTested: 2, share: 0.1 },
      efficacy: expect.closeTo(DECLARED - 0.1 * (DECLARED - 0.5), 12),
      parentEfficacy: expect.closeTo(0.30, 2),
    });
  });

  it('reads a sub-technique with no row of its own as not tested on its declaration, whatever its parent\'s', () => {
    const [reading] = readTechniqueTests([subTechniqueCell()], [result(1, 10, 20)]);

    expect(reading).toMatchObject({ tested: null, efficacy: DECLARED, parentEfficacy: expect.closeTo(0.30, 2) });
  });

  it('reads an untested parent the control covers at its declaration', () => {
    const [reading] = readTechniqueTests([subTechniqueCell()], []);

    expect(reading.parentEfficacy).toBe(DECLARED);
  });

  it('leaves a control declared absent at zero, its result still shown', () => {
    const [reading] = readTechniqueTests(
      [cell({ declaration: { strengthRung: 'L0', coverageBucket: 'L0', strength: 0, coverage: 0, phishingStage: null } })],
      [result(10, 10, 20)],
    );

    expect(reading).toMatchObject({ declared: 0, efficacy: 0, tested: { heldTests: 10 } });
  });

  it('reads a control the level resolves no posture for as declared absent', () => {
    const [reading] = readTechniqueTests([cell({ declaration: null })], []);

    expect(reading).toMatchObject({ declaration: null, declared: 0, efficacy: 0, tested: null });
  });

  it('caps the tested share at the whole level', () => {
    const [reading] = readTechniqueTests([cell()], [result(1, 4, 2, { tests: 4 })]);

    expect(reading.tested?.share).toBe(1);
  });
});

describe('readUncoveredTests', () => {
  const uncoveredCell = (over: Partial<TechniqueReadingCell> = {}): TechniqueReadingCell => ({
    capabilityId: EDR,
    function: 'prevent',
    mitreTechniqueId: T1059,
    parentTechniqueId: null,
    ...over,
  });

  it('reads a technique on its family row alone, flagged, with no engine figure', () => {
    expect(readUncoveredTests([uncoveredCell()], [result(1, 2, 20, { mitreTechniqueId: T1059 })])).toEqual([{
      covered: false,
      capabilityId: EDR,
      function: 'prevent',
      mitreTechniqueId: T1059,
      familyTechniqueId: T1059,
      tested: { tests: 2, heldTests: 1, rate: 0.5, hostsTested: 2, scopeHosts: 20, share: 0.1 },
    }]);
  });

  it('reads a sub-technique on its own row under its parent\'s family, never the parent\'s row', () => {
    const [reading] = readUncoveredTests(
      [uncoveredCell({ mitreTechniqueId: T1055_012, parentTechniqueId: T1055 })],
      [result(1, 10, 20), result(0, 1, 20, { mitreTechniqueId: T1055_012, grain: 'sub_technique' })],
    );

    expect(reading).toMatchObject({ familyTechniqueId: T1055, tested: { tests: 1, heldTests: 0 } });
  });

  it('reads an untested cell as not tested', () => {
    expect(readUncoveredTests([uncoveredCell()], [result(1, 10, 20)])).toEqual([expect.objectContaining({ covered: false, tested: null })]);
  });

  it('keeps each function and control to its own result', () => {
    const readings = readUncoveredTests(
      [uncoveredCell({ mitreTechniqueId: T1055 }), uncoveredCell({ mitreTechniqueId: T1055, function: 'detect' })],
      [result(1, 10, 20, { capabilityId: 'other' }), result(1, 10, 20, { function: 'detect' })],
    );

    expect(readings.map((reading) => reading.tested?.heldTests ?? null)).toEqual([null, 1]);
  });
});

describe('an anchored phishing stage', () => {
  // The readings audit an anchored stage technique on its own row, the engine on the stage's first
  // tested technique: the two agree only while each anchored stage holds one technique.
  it.each(Object.entries(PHISHING_STAGE_ANCHORS))('%s acts at a stage of one technique', (_, { stage }) => {
    expect(PHISHING_STAGE_TECHNIQUES[stage]).toHaveLength(1);
  });
});

describe('coverageOfReadings', () => {
  const covered = (capabilityExternalId: string, efficacy: number, over: Partial<CoveredTechniqueTestReading> = {}): TechniqueControlTestReading => ({
    covered: true,
    capabilityId: capabilityExternalId.toLowerCase(),
    capabilityExternalId,
    capabilityName: capabilityExternalId,
    capabilityRungs: { strengthRung: 'L2', coverageBucket: 'L2' },
    function: 'prevent',
    mitreTechniqueId: T1059,
    familyTechniqueId: T1059,
    declaration: L2_L2,
    declared: DECLARED,
    efficacy,
    tested: null,
    parentEfficacy: null,
    ...over,
  });
  const uncovered = (capabilityExternalId: string, fn: 'prevent' | 'detect' = 'prevent'): TechniqueControlTestReading => ({
    covered: false,
    capabilityId: capabilityExternalId.toLowerCase(),
    capabilityExternalId,
    capabilityName: capabilityExternalId,
    capabilityRungs: null,
    function: fn,
    mitreTechniqueId: T1059,
    familyTechniqueId: T1059,
    tested: null,
  });
  const ranked = (readings: Array<TechniqueControlTestReading>) => {
    const { best, others } = coverageOfReadings(T1059, 'prevent', readings);
    return { best: best?.capabilityExternalId ?? null, others: others.map((reading) => reading.capabilityExternalId) };
  };

  it('takes the highest efficacy as the best control, the others after it in the same order', () => {
    expect(ranked([covered('OSH', 0.4), covered('EDR', 0.3), covered('AV', 0.5)])).toEqual({ best: 'AV', others: ['OSH', 'EDR'] });
  });

  it('breaks an efficacy tie on the higher declaration, then on the catalogue id', () => {
    expect(ranked([covered('OSH', 0.4, { declared: 0.4 }), covered('EDR', 0.4, { declared: 0.6 })])).toEqual({ best: 'EDR', others: ['OSH'] });
    expect(ranked([covered('OSH', 0.4), covered('EDR', 0.4)])).toEqual({ best: 'EDR', others: ['OSH'] });
  });

  it('breaks a catalogue id tie by code point, whatever the server locale', () => {
    expect(ranked([covered('iam', 0.4), covered('IDP', 0.4)])).toEqual({ best: 'IDP', others: ['iam'] });
    expect(ranked([covered('NETFW', 0.4), covered('NET-FW', 0.4)])).toEqual({ best: 'NET-FW', others: ['NETFW'] });
    expect(ranked([uncovered('iam'), uncovered('IDP')])).toEqual({ best: null, others: ['IDP', 'iam'] });
  });

  it('never takes a control at no coverage, nor one the level does not assess, which the engine reads as absent', () => {
    const atNoCoverage = covered('AV', 0, { declaration: { ...L2_L2, coverageBucket: 'L0', coverage: 0 }, declared: 0 });
    const unassessed = covered('EDR', 0, { declaration: null, declared: 0 });

    expect(ranked([atNoCoverage, unassessed, covered('OSH', 0.1)])).toEqual({ best: 'OSH', others: ['AV', 'EDR'] });
    expect(ranked([atNoCoverage, unassessed])).toEqual({ best: null, others: ['AV', 'EDR'] });
  });

  it('lists the controls the engine does not read after the present ones, and keeps to the function asked', () => {
    expect(ranked([uncovered('AV'), covered('OSH', 0.4), uncovered('EDR', 'detect')])).toEqual({ best: 'OSH', others: ['AV'] });
  });
});
