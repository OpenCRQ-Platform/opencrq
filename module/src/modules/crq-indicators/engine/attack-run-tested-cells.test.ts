import { describe, expect, it } from 'vitest';
import type { AttackRunControl, AttackRunGroup, AttackRunLawInputs, AttackRunTechnique, AttackRunTestedCell, CompiledAttackRunLaw } from './attack-run-law';
import type { AttackRunWorldDraw, PreparedWorld } from './attack-run-evaluation';
import type { DoorEstate } from './attack-run-door';
import type { CapabilityFunction } from '../../controls/capability/constants';
import type { EngineRunControl, EngineRunInputs, EngineRunResult } from './engine-run';
import { coverageCoefficient, STRENGTH_BY_RUNG } from '../../controls/capability/constants';
import { ATTACK_RUN_CONSTANTS } from './attack-run-constants';
import { compileAttackRunLaw, PHISHING_STAGE } from './attack-run-law';
import { evaluateAttackRun, prepareWorld, setControlState } from './attack-run-evaluation';
import { createEngineRun } from './engine-run';

/**
 * A control's efficacy on each technique OpenAEV tested: the declaration audited by the observed
 * rate, read on the worked example of a scope of 20 hosts, 2 of them lab VMs, whose EDR declares L2
 * strength and L2 coverage, about 50 % on the engine's scale.
 */

const DECLARED = STRENGTH_BY_RUNG.L2 * coverageCoefficient('L2');
const L3_DECLARED = STRENGTH_BY_RUNG.L3 * coverageCoefficient('L2');
const HOST = 'host';
const IDENTITY = 'identity';

const technique = (externalId: string, tacticExternalIds: ReadonlyArray<string>, families: AttackRunTechnique['families']): AttackRunTechnique =>
  ({ externalId, tacticExternalIds, families });

const REPERTOIRE: ReadonlyArray<AttackRunTechnique> = [
  technique('T1566', ['TA0001'], [IDENTITY, HOST]),
  technique('T1055', ['TA0004', 'TA0005'], [HOST, IDENTITY]),
  technique('T1059', ['TA0002'], [HOST, IDENTITY]),
  technique('T1021', ['TA0008'], [HOST]),
  technique('T1570', ['TA0008'], [HOST]),
  technique('T1046', ['TA0007'], [HOST]),
  technique('T1003', ['TA0006'], [HOST, IDENTITY]),
  technique('T1547', ['TA0003'], [HOST]),
  technique('T1486', ['TA0040'], [HOST]),
];

const GROUPS: ReadonlyArray<AttackRunGroup> = [
  { id: 'hosts', family: HOST, assets: 20, exposure: 'internal', criticality: 'medium', matchedByScenarioGroup: false },
  { id: 'identities', family: IDENTITY, assets: 5, exposure: 'internal', criticality: 'medium', matchedByScenarioGroup: false },
];

const DOOR: DoorEstate = {
  techniques: ['T1566'],
  families: [HOST, IDENTITY],
  cves: [],
  assets: [],
  applicable: [Float64Array.from([20, 5])],
  targetApplicable: [new Float64Array(2)],
  phishing: null,
};

const tested = (techniqueExternalId: string, fn: CapabilityFunction, held: number, hostsTested: number, scopeHosts = 20): AttackRunTestedCell =>
  ({ techniqueExternalId, function: fn, rate: held / hostsTested, hostsTested, scopeHosts });

/** What the derivation stores for the worked example, T1003 and T1046 failed on both lab VMs alone. */
const WORKED_EXAMPLE: ReadonlyArray<AttackRunTestedCell> = [
  tested('T1055', 'prevent', 1, 10),
  tested('T1055', 'detect', 10, 10),
  tested('T1059', 'prevent', 15, 15),
  tested('T1021', 'prevent', 0, 1),
  tested('T1003', 'prevent', 0, 2),
  tested('T1046', 'prevent', 0, 2),
];

const edr = (results: ReadonlyArray<AttackRunTestedCell> = WORKED_EXAMPLE): AttackRunControl => ({
  capabilityExternalId: 'EDR',
  preventTechniqueExternalIds: ['T1055', 'T1059', 'T1021', 'T1046', 'T1003'],
  detectTechniqueExternalIds: ['T1055', 'T1003', 'T1547'],
  tested: results,
});

const lawOf = (controls: ReadonlyArray<AttackRunControl>, over: Partial<AttackRunLawInputs> = {}): CompiledAttackRunLaw => compileAttackRunLaw({
  terminalTacticExternalId: 'TA0040',
  actorClass: { capability: 0.7, stealth: 0.4, patience: 0.2, attackRunDays: 5 },
  repertoire: REPERTOIRE,
  groups: GROUPS,
  controls,
  constants: ATTACK_RUN_CONSTANTS,
  door: DOOR,
  unknownExposureCountsAs: 'internal',
  unknownCriticalityCountsAs: 'low',
  ...over,
});

const drawOf = (law: CompiledAttackRunLaw, efficacy: number, deployed = true): AttackRunWorldDraw => ({
  deployed: law.controls.map(() => deployed),
  preventEfficacy: law.controls.map(() => efficacy),
  detectEfficacy: law.controls.map(() => efficacy),
  knockoutUniform: law.controls.map(() => law.obstacles.map(() => 1)),
  reactionTimeHours: { min: 8, likely: 8, max: 8 },
  cveUniform: new Float64Array(0),
  familyUniform: new Float64Array(DOOR.families.length),
});

const worldOf = (law: CompiledAttackRunLaw, efficacy = DECLARED, deployed = true): PreparedWorld => prepareWorld(law, drawOf(law, efficacy, deployed));

const familyAt = (world: PreparedWorld, family: string): number => world.law.inputs.groups.findIndex((group) => group.family === family);

const at = (world: PreparedWorld, externalId: string, family: string): number =>
  REPERTOIRE.findIndex((entry) => entry.externalId === externalId) * world.law.familyCount + familyAt(world, family);

/** The efficacy a cell reads: what its product lets through, with the EDR the only control. */
const prevention = (world: PreparedWorld, externalId: string, family = HOST): number => 1 - world.preventByFamily[at(world, externalId, family)];

describe('a tested technique', () => {
  const world = worldOf(lawOf([edr()]));

  it.each([
    { cell: 'T1055 prevention', read: () => prevention(world, 'T1055'), efficacy: 0.30 },
    { cell: 'T1021 prevention', read: () => prevention(world, 'T1021'), efficacy: 0.48 },
    { cell: 'T1003 prevention', read: () => prevention(world, 'T1003'), efficacy: 0.45 },
    { cell: 'T1046 prevention', read: () => prevention(world, 'T1046'), efficacy: 0.45 },
  ])('reads the worked example on $cell', ({ read, efficacy }) => {
    expect(read()).toBeCloseTo(efficacy, 2);
  });

  it('reads the declaration exactly where every tested host held', () => {
    const declared = worldOf(lawOf([edr([])]));
    expect(world.detectByFamily[at(world, 'T1055', HOST)]).toBe(declared.detectByFamily[at(declared, 'T1055', HOST)]);
    expect(world.preventByFamily[at(world, 'T1059', HOST)]).toBe(declared.preventByFamily[at(declared, 'T1059', HOST)]);
  });

  it('reads the declaration exactly on T1003 detection, untested', () => {
    expect(world.detectByFamily[at(world, 'T1003', HOST)]).toBe(1 - DECLARED);
  });

  it('reads the same efficacy on every family the control protects', () => {
    expect(prevention(world, 'T1055', IDENTITY)).toBe(prevention(world, 'T1055', HOST));
  });

  it('reads 50.1 % on 2,000 hosts with 10 tested and none held', () => {
    const large = worldOf(lawOf([edr([tested('T1055', 'prevent', 0, 10, 2000)])]));
    expect(prevention(large, 'T1055')).toBeCloseTo(0.501, 3);
  });

  it('reads the declaration when the scope holds no host', () => {
    const empty = worldOf(lawOf([edr([{ techniqueExternalId: 'T1055', function: 'prevent', rate: 0, hostsTested: 1, scopeHosts: 0 }])]));
    expect(empty.preventByFamily[at(empty, 'T1055', HOST)]).toBe(1 - DECLARED);
  });

  it('reads nothing of a result on a technique the control does not cover for that function, every product at its declared bits', () => {
    const uncovered = [tested('T1486', 'prevent', 0, 20), tested('T1547', 'prevent', 0, 20), tested('T1059', 'detect', 0, 20), tested('T1566', 'prevent', 0, 20)];
    const law = lawOf([edr(uncovered)]);
    expect(law.controls[0].testedStage).toEqual([]);
    expect(law.controls[0].testedPrevent.size + law.controls[0].testedDetect.size).toBe(0);
    const read = worldOf(law);
    const declared = worldOf(lawOf([edr([])]));
    expect(read.preventByFamily).toEqual(declared.preventByFamily);
    expect(read.detectByFamily).toEqual(declared.detectByFamily);
    expect(read.phishingLetThrough).toEqual(declared.phishingLetThrough);
  });
});

describe('a control declared absent', () => {
  it('stays absent at no coverage, whatever its results', () => {
    const world = worldOf(lawOf([edr([tested('T1059', 'prevent', 0, 20)])]), 0, false);
    expect(world.preventByFamily[at(world, 'T1059', HOST)]).toBe(1);
  });

  it('stays absent at no strength, whatever its results', () => {
    const world = worldOf(lawOf([edr([tested('T1059', 'prevent', 0, 20)])]), 0);
    expect(world.preventByFamily[at(world, 'T1059', HOST)]).toBe(1);
  });
});

describe('a strength step', () => {
  const law = lawOf([edr()]);
  const before = worldOf(law);
  const after = worldOf(law, L3_DECLARED);
  const step = L3_DECLARED - DECLARED;

  it('lands in full on T1003 detection, untested, and on T1059 prevention, fully held', () => {
    const detection = (world: PreparedWorld): number => 1 - world.detectByFamily[at(world, 'T1003', HOST)];
    expect(detection(after) - detection(before)).toBeCloseTo(step, 12);
    expect(prevention(after, 'T1059') - prevention(before, 'T1059')).toBeCloseTo(step, 12);
  });

  it('lands for 90 % of its size on T1003 prevention, failed on the 2 lab VMs of 20 hosts', () => {
    expect(prevention(after, 'T1003') - prevention(before, 'T1003')).toBeCloseTo(0.9 * step, 12);
  });

  it('lands for half its size on T1055 prevention, below its declaration with half the hosts tested', () => {
    expect(prevention(after, 'T1055') - prevention(before, 'T1055')).toBeCloseTo(0.5 * step, 12);
  });

  it('returns every product to its bits when undone', () => {
    const world = worldOf(law);
    const prevent = Float64Array.from(world.preventByFamily);
    const detect = Float64Array.from(world.detectByFamily);
    const declared = world.controlStates[0];
    setControlState(world, 0, { deployed: true, preventEfficacy: L3_DECLARED, detectEfficacy: L3_DECLARED });
    setControlState(world, 0, declared);
    for (let index = 0; index < prevent.length; index += 1) {
      expect(world.preventByFamily[index]).toBeCloseTo(prevent[index], 14);
      expect(world.detectByFamily[index]).toBeCloseTo(detect[index], 14);
    }
  });
});

describe('an estate-grain read', () => {
  it('sees the anchoring less often when the persistence technique\'s detection failed, and as declared when it held', () => {
    const seen = (results: ReadonlyArray<AttackRunTestedCell>): number => evaluateAttackRun(worldOf(lawOf([edr(results)]))).firstDetectionAtAnchoring;
    const declared = seen([]);
    expect(declared).toBeGreaterThan(0);
    expect(seen([tested('T1547', 'detect', 20, 20)])).toBe(declared);
    expect(seen([tested('T1547', 'detect', 0, 20)])).toBeLessThan(declared);
  });
});

describe('the phishing stage', () => {
  const control = (capabilityExternalId: string, results: ReadonlyArray<AttackRunTestedCell>, declaredPreventEfficacy?: number): AttackRunControl => ({
    capabilityExternalId,
    preventTechniqueExternalIds: ['T1566'],
    detectTechniqueExternalIds: [],
    tested: results,
    ...(declaredPreventEfficacy === undefined ? {} : { declaredPreventEfficacy }),
  });
  const stageCell = (world: PreparedWorld, family: string): number =>
    world.phishingLetThrough[PHISHING_STAGE.delivery * world.law.familyCount + familyAt(world, family)];

  it('reads the technique it models, on every family alike', () => {
    const world = worldOf(lawOf([control('ESP', [tested('T1566', 'prevent', 0, 20)])]));
    expect(stageCell(world, IDENTITY)).toBeCloseTo(1, 12);
    expect(stageCell(world, HOST)).toBe(stageCell(world, IDENTITY));
  });

  it('reads the weakest of the stage\'s techniques the control was tested on, a failure on any of them letting the stage through', () => {
    const payloadControl = (results: Array<AttackRunTestedCell>) => ({ ...control('EDR', results), preventTechniqueExternalIds: ['T1203', 'T1204'] });
    const both = lawOf([payloadControl([tested('T1203', 'prevent', 0, 5), tested('T1204', 'prevent', 5, 5)])]);
    expect(both.controls[0].testedStage.map((result) => result.rate)).toEqual([1, 0]);
    const payloadCell = (world: PreparedWorld): number =>
      world.phishingLetThrough[PHISHING_STAGE.payload * world.law.familyCount + familyAt(world, HOST)];
    const failedOnly = worldOf(lawOf([payloadControl([tested('T1203', 'prevent', 0, 5)])]));
    const heldOnly = worldOf(lawOf([payloadControl([tested('T1204', 'prevent', 5, 5)])]));
    expect(payloadCell(worldOf(both))).toBe(payloadCell(failedOnly));
    expect(payloadCell(worldOf(both))).toBeGreaterThan(payloadCell(heldOnly));
  });

  it('never reads a technique of the stage the control has no edge under', () => {
    const law = lawOf([{ ...control('ESP', [tested('T1203', 'prevent', 0, 20)]), preventTechniqueExternalIds: ['T1204'] }]);
    expect(law.controls[0].testedStage).toEqual([]);
  });

  it('reads a technique of the stage the control has an edge under through one of its sub-techniques', () => {
    const law = lawOf([{ ...control('ESP', [tested('T1204', 'prevent', 0, 20)]), preventTechniqueExternalIds: ['T1204.002'] }]);
    expect(law.controls[0].testedStage.map((result) => result.rate)).toEqual([0]);
  });

  it('backs the training out of the declared simulation rate at its audited efficacy', () => {
    const results = [tested('T1566', 'prevent', 2, 10)];
    const law = lawOf([control('SAT', results, DECLARED)], { phishing: { actorClass: 'default', declaredSusceptibility: 0.12 } });
    const world = worldOf(law);
    expect(law.phishingTrainingLetThrough[familyAt(world, HOST)]).toBe(stageCell(world, HOST));
    expect(law.phishingTrainingLetThrough[familyAt(world, HOST)]).toBeCloseTo(1 - (DECLARED - 0.5 * (DECLARED - 0.2)), 12);
  });
});

describe('a run', () => {
  const run = (results: ReadonlyArray<AttackRunTestedCell>, repertoire: ReadonlyArray<AttackRunTechnique>): EngineRunResult => {
    const control: EngineRunControl = {
      controlId: 'id-EDR',
      capabilityExternalId: 'EDR',
      strengthRung: 'L2',
      coverageBucket: 'L2',
      preventTechniqueExternalIds: ['T1055', 'T1059', 'T1021', 'T1003', 'T1486'],
      detectTechniqueExternalIds: ['T1055', 'T1003'],
      tested: results,
    };
    const inputs: EngineRunInputs = {
      terminalTacticExternalId: 'TA0040',
      controls: [control],
      actors: [{
        key: 'ransomware',
        name: null,
        actorClass: 'ransomware_operator',
        knobs: { capability: 0.7, stealth: 0.4, patience: 0.2, attackRunDays: 5 },
        share: 1,
        repertoire,
        groups: GROUPS,
      }],
      tef: { min: 0.5, likely: 1, max: 3 },
      lossDrivers: [{ min: 100000, likely: 400000, max: 2000000 }],
      reactionTimeHours: { min: 0.5, likely: 8, max: 96 },
      constants: ATTACK_RUN_CONSTANTS,
      door: DOOR,
      phishing: { declaredSusceptibility: null },
      unknownExposureCountsAs: 'internal',
      unknownCriticalityCountsAs: 'low',
      worlds: 50,
      seed: 'tested',
    };
    const engine = createEngineRun(inputs);
    while (!engine.done()) {
      engine.advance(8);
    }
    return engine.result();
  };
  const without = (...externalIds: ReadonlyArray<string>): ReadonlyArray<AttackRunTechnique> =>
    REPERTOIRE.filter((entry) => !externalIds.includes(entry.externalId));

  it('prices a higher ALE than the declaration alone when the actors use T1055', () => {
    const usingT1055 = without('T1059', 'T1021');
    expect(run([], usingT1055).ale.mean).toBeGreaterThan(0);
    expect(run(WORKED_EXAMPLE, usingT1055).ale.mean).toBeGreaterThan(run([], usingT1055).ale.mean);
  });

  it('prices a higher ALE than the declaration alone when the actors use T1003, failed on the lab VMs alone', () => {
    const usingT1003 = without('T1055', 'T1021');
    expect(run(WORKED_EXAMPLE, usingT1003).ale.mean).toBeGreaterThan(run([], usingT1003).ale.mean);
  });

  it('prices exactly the declaration when every result sits on a technique the control does not cover for that function', () => {
    const uncovered = [tested('T1046', 'prevent', 0, 20), tested('T1547', 'prevent', 0, 20), tested('T1059', 'detect', 0, 20)];
    expect(run(uncovered, REPERTOIRE).ale.mean).toBe(run([], REPERTOIRE).ale.mean);
  });

  it('prices exactly the declaration when every technique the actors use held or went untested', () => {
    const usingT1059 = without('T1055', 'T1021');
    const declared = run([], usingT1059).ale.mean;
    expect(declared).toBeGreaterThan(0);
    expect(run(WORKED_EXAMPLE.filter((cell) => cell.techniqueExternalId !== 'T1003'), usingT1059).ale.mean).toBe(declared);
  });
});
