import { describe, expect, it } from 'vitest';
import type { AttackRunControl, AttackRunGroup, AttackRunTechnique, CompiledAttackRunLaw } from './attack-run-law';
import type { AttackRunControlDeclaration, AttackRunWorlds, ControlLever } from './attack-run-worlds';
import type { DoorEstate } from './attack-run-door';
import type { PreparedWorld } from './attack-run-evaluation';
import type { EngineRunControl, EngineRunInputs } from './engine-run';
import { buildAttackRunWorlds, controlStateAt, controlWorldSpec, DECLARED_LEVER, declaredPreventEfficacy, declaredStrength, targetStateAt, worldDrawAt  } from './attack-run-worlds';
import { ATTACK_RUN_CONSTANTS, PHISHING_STAGE_ANCHORS, phishingStageAnchorOf } from './attack-run-constants';
import { compileAttackRunLaw, PHISHING_STAGE, phishingStageNameOf } from './attack-run-law';
import { evaluateAttackRun, prepareWorld, refreshWorld, setControlState } from './attack-run-evaluation';
import { buildObstacles } from './attack-run-obstacles';
import { createEngineRun } from './engine-run';
import { catalogueCoverage } from './attack-run-fixtures';

/**
 * The stage a phishing campaign reads for email filtering at delivery and for multi-factor
 * authentication at the credential stage: a stage anchor per declared rung in place of the shared
 * scale, at that stage only.
 */

const IDENTITY = 'identity';
const HOST = 'host';
const PEOPLE = 30;

const technique = (externalId: string, tacticExternalIds: ReadonlyArray<string>, families: AttackRunTechnique['families']): AttackRunTechnique =>
  ({ externalId, tacticExternalIds, families, populationScoped: externalId === 'T1566' });

const REPERTOIRE: ReadonlyArray<AttackRunTechnique> = [
  technique('T1566', ['TA0001'], [IDENTITY, HOST]),
  technique('T1486', ['TA0040'], [HOST]),
];

const GROUPS: ReadonlyArray<AttackRunGroup> = [
  { id: 'accounts', family: IDENTITY, assets: PEOPLE, exposure: 'internal', criticality: 'medium', matchedByScenarioGroup: false },
  { id: 'hosts', family: HOST, assets: 50, exposure: 'internal', criticality: 'medium', matchedByScenarioGroup: false },
];

const DOOR: DoorEstate = {
  techniques: ['T1566'],
  families: [IDENTITY, HOST],
  cves: [{ cveId: 'CVE-2024-0001', threat: 0.5, priced: true }],
  assets: [],
  applicable: [Float64Array.from([0, 0])],
  targetApplicable: [Float64Array.from([0, 0])],
  phishing: {
    personFamily: 0,
    deviceFamily: 1,
    people: PEOPLE,
    targetPeople: 0,
    persons: [{ target: false, devices: [{ family: 1, openings: [{ cve: 0, technique: 0, opening: 0.8 }] }] }],
    cleanPersons: [],
  },
};

interface Posed {
  readonly capabilityExternalId: string,
  readonly prevent: ReadonlyArray<string>,
  readonly strengthRung?: AttackRunControlDeclaration['strengthRung'],
  readonly coverageBucket?: AttackRunControlDeclaration['coverageBucket'],
}

const declarationOf = (posed: Posed): AttackRunControlDeclaration => ({
  capabilityExternalId: posed.capabilityExternalId,
  strengthRung: posed.strengthRung ?? 'L2',
  coverageBucket: posed.coverageBucket ?? 'L3',
});

const lawOf = (posed: ReadonlyArray<Posed>): CompiledAttackRunLaw => compileAttackRunLaw({
  terminalTacticExternalId: 'TA0040',
  actorClass: { capability: 0.7, stealth: 0.4, patience: 0.2, attackRunDays: 5 },
  repertoire: REPERTOIRE,
  groups: GROUPS,
  controls: posed.map((entry): AttackRunControl => ({
    capabilityExternalId: entry.capabilityExternalId,
    preventTechniqueExternalIds: entry.prevent,
    detectTechniqueExternalIds: [],
  })),
  constants: ATTACK_RUN_CONSTANTS,
  door: DOOR,
  phishing: { actorClass: 'default', declaredSusceptibility: null },
  unknownExposureCountsAs: 'internal',
  unknownCriticalityCountsAs: 'low',
});

const specsOf = (posed: ReadonlyArray<Posed>) =>
  posed.map((entry) => controlWorldSpec(declarationOf(entry), { phishingStage: phishingStageNameOf(entry.prevent) }));

interface Setup {
  readonly law: CompiledAttackRunLaw,
  readonly columns: AttackRunWorlds,
  readonly world: PreparedWorld,
}

const setupOf = (posed: ReadonlyArray<Posed>): Setup => {
  const columns = buildAttackRunWorlds({
    controls: specsOf(posed),
    obstacleCount: buildObstacles('TA0040').length,
    reactionTimeHours: { min: 8, likely: 8, max: 8 },
    worlds: 4,
    seed: 'anchors',
    cveIds: DOOR.cves.map((cve) => cve.cveId),
    familyIds: DOOR.families,
  });
  const law = lawOf(posed);
  return { law, columns, world: prepareWorld(law, worldDrawAt(columns, 0)) };
};

const familyIndexOf = (law: CompiledAttackRunLaw, family: string): number => law.inputs.groups.findIndex((group) => group.family === family);

const stageCell = (world: PreparedWorld, stage: number, family: string): number =>
  world.phishingLetThrough[stage * world.law.familyCount + familyIndexOf(world.law, family)];

const preventCell = (world: PreparedWorld, techniqueExternalId: string, family: string): number =>
  world.preventByFamily[world.law.inputs.repertoire.findIndex((entry) => entry.externalId === techniqueExternalId) * world.law.familyCount + familyIndexOf(world.law, family)];

const SEG: Posed = { capabilityExternalId: 'SEG', prevent: ['T1566'] };
const IDP: Posed = { capabilityExternalId: 'IDP', prevent: ['T1078'] };

const UPGRADED_STRENGTH: ControlLever = { strength: 'upgraded', coverage: 'declared' };
const UPGRADED_COVERAGE: ControlLever = { strength: 'declared', coverage: 'upgraded' };

describe('the anchors', () => {
  it('read the measured value of each rung at the stage the source measured', () => {
    expect(PHISHING_STAGE_ANCHORS.SEG).toEqual({ stage: 'delivery', strengthByRung: { L1: 0.89, L2: 0.97, L3: 0.98 } });
    expect(PHISHING_STAGE_ANCHORS.IDP).toEqual({ stage: 'credential', strengthByRung: { L1: 0.76, L2: 0.9, L3: 0.99 } });
  });

  it('apply to a capability at its own stage only', () => {
    expect(phishingStageAnchorOf('SEG', 'delivery')).toEqual({ L1: 0.89, L2: 0.97, L3: 0.98 });
    expect(phishingStageAnchorOf('IDP', 'credential')).not.toBeNull();
    expect(phishingStageAnchorOf('SEG', 'payload')).toBeNull();
    expect(phishingStageAnchorOf('SEG', 'credential')).toBeNull();
    expect(phishingStageAnchorOf('IDP', 'delivery')).toBeNull();
    expect(phishingStageAnchorOf('SEG', null)).toBeNull();
  });

  it('leave every other capability on the shared scale', () => {
    for (const capability of ['SAT', 'SWG', 'IGA', 'EDR', 'UEM']) {
      expect(PHISHING_STAGE_ANCHORS[capability]).toBeUndefined();
      expect(phishingStageAnchorOf(capability, 'delivery')).toBeNull();
    }
  });

  it('name the stage a control with these prevent edges acts at', () => {
    expect(phishingStageNameOf(['T1566.002'])).toBe('delivery');
    expect(phishingStageNameOf(['T1204', 'T1566'])).toBe('delivery');
    expect(phishingStageNameOf(['T1204', 'T1078'])).toBe('credential');
    expect(phishingStageNameOf(['T1203'])).toBe('payload');
    expect(phishingStageNameOf(['T1486'])).toBeNull();
  });
});

describe('the stage efficacy of a declared control', () => {
  it('reads the anchor of the declared rung at coverage one', () => {
    for (const [rung, anchor] of [['L1', 0.89], ['L2', 0.97], ['L3', 0.98]] as const) {
      const [spec] = specsOf([{ ...SEG, strengthRung: rung }]);
      expect(controlStateAt(spec, DECLARED_LEVER).phishingStageEfficacy).toBe(anchor);
    }
    for (const [rung, anchor] of [['L1', 0.76], ['L2', 0.9], ['L3', 0.99]] as const) {
      const [spec] = specsOf([{ ...IDP, strengthRung: rung }]);
      expect(controlStateAt(spec, DECLARED_LEVER).phishingStageEfficacy).toBe(anchor);
    }
  });

  it('keeps the shared scale as the control efficacy, so everything but the stage reads it', () => {
    const [spec] = specsOf([SEG]);
    const state = controlStateAt(spec, DECLARED_LEVER);
    expect(state.preventEfficacy).toBe(declaredStrength('L2'));
    expect(state.detectEfficacy).toBe(declaredStrength('L2'));
    expect(declaredPreventEfficacy(spec)).toBe(declaredStrength('L2'));
  });

  it('multiplies the coverage in as it does the shared strength', () => {
    const [spec] = specsOf([{ ...SEG, coverageBucket: 'L2' }]);
    expect(controlStateAt(spec, DECLARED_LEVER).phishingStageEfficacy).toBe(0.97 * 0.7);
    const [measured] = specsOf([{ ...IDP, coverageBucket: 'L1' }]);
    expect(controlStateAt(measured, DECLARED_LEVER).phishingStageEfficacy).toBe(0.9 * 0.4);
  });

  it('is absent for a control with no anchor at its stage, whose state keeps no extra key', () => {
    for (const posed of [
      { capabilityExternalId: 'SAT', prevent: ['T1566'] },
      { capabilityExternalId: 'SEG', prevent: ['T1204'] },
      { capabilityExternalId: 'SEG', prevent: ['T1486'] },
      { capabilityExternalId: 'IDP', prevent: ['T1566', 'T1078'] },
    ]) {
      const [spec] = specsOf([posed]);
      expect(spec.phishingStage).toBeUndefined();
      expect(controlStateAt(spec, DECLARED_LEVER)).toStrictEqual({
        deployed: true,
        preventEfficacy: declaredStrength('L2'),
        detectEfficacy: declaredStrength('L2'),
      });
    }
  });

  it('is zero at the rung that instantiates no edge, and the lever from it reads the first anchor', () => {
    const [spec] = specsOf([{ ...SEG, strengthRung: 'L0' }]);
    expect(controlStateAt(spec, DECLARED_LEVER).phishingStageEfficacy).toBe(0);
    expect(controlStateAt(spec, UPGRADED_STRENGTH).phishingStageEfficacy).toBe(0.89);
  });
});

describe('what each stage lets through in a prepared world', () => {
  it('lets 0.03 through at delivery for email filtering at L2 and full coverage, on every family it protects', () => {
    const { world } = setupOf([SEG]);
    for (const family of [IDENTITY, HOST]) {
      expect(stageCell(world, PHISHING_STAGE.delivery, family)).toBeCloseTo(0.03, 12);
    }
  });

  it('reads the shared scale for the per-technique product of the same control', () => {
    const { world } = setupOf([SEG]);
    expect(preventCell(world, 'T1566', IDENTITY)).toBe(1 - declaredStrength('L2'));
  });

  it('reads the shared scale for email filtering away from delivery', () => {
    const { world } = setupOf([{ ...SEG, prevent: ['T1204'] }]);
    expect(stageCell(world, PHISHING_STAGE.payload, HOST)).toBe(1 - declaredStrength('L2'));
    expect(stageCell(world, PHISHING_STAGE.delivery, HOST)).toBe(1);
  });

  it('reads the anchor of multi-factor authentication at the credential stage only', () => {
    for (const [rung, letThrough] of [['L1', 0.24], ['L2', 0.1], ['L3', 0.01]] as const) {
      const { world } = setupOf([{ ...IDP, strengthRung: rung }]);
      expect(stageCell(world, PHISHING_STAGE.credential, IDENTITY)).toBeCloseTo(letThrough, 12);
      expect(stageCell(world, PHISHING_STAGE.delivery, IDENTITY)).toBe(1);
    }
  });

  it('reads the shared scale for multi-factor authentication placed at delivery by an edge on T1566', () => {
    const { world } = setupOf([{ ...IDP, prevent: ['T1566', 'T1078'] }]);
    expect(stageCell(world, PHISHING_STAGE.delivery, IDENTITY)).toBe(1 - declaredStrength('L2'));
    expect(stageCell(world, PHISHING_STAGE.credential, IDENTITY)).toBe(1);
  });

  it('keeps a control that acts at one stage out of the others, anchored or not', () => {
    const { world } = setupOf([{ ...SEG, prevent: ['T1204', 'T1566'] }]);
    expect(stageCell(world, PHISHING_STAGE.delivery, HOST)).toBeCloseTo(0.03, 12);
    expect(stageCell(world, PHISHING_STAGE.payload, HOST)).toBe(1);
  });

  it('multiplies the anchored control and an unanchored one at the same stage', () => {
    const training: Posed = { capabilityExternalId: 'SAT', prevent: ['T1566'] };
    const { world } = setupOf([SEG, training]);
    expect(stageCell(world, PHISHING_STAGE.delivery, IDENTITY)).toBeCloseTo(0.03 * (1 - declaredStrength('L2')), 12);
  });

  it('reads the declared rung where two controls stand at different ones, each at its own stage', () => {
    const { world } = setupOf([{ ...SEG, strengthRung: 'L1' }, { ...IDP, strengthRung: 'L3' }]);
    expect(stageCell(world, PHISHING_STAGE.delivery, IDENTITY)).toBeCloseTo(0.11, 12);
    expect(stageCell(world, PHISHING_STAGE.credential, IDENTITY)).toBeCloseTo(0.01, 12);
  });
});

describe('the strength lever and the plan target at the stage', () => {
  it('read the anchor of the next rung', () => {
    for (const [rung, next] of [['L1', 0.97], ['L2', 0.98], ['L3', 0.98], ['L0', 0.89]] as const) {
      const [spec] = specsOf([{ ...SEG, strengthRung: rung }]);
      expect(controlStateAt(spec, UPGRADED_STRENGTH).phishingStageEfficacy).toBe(next);
    }
    for (const [rung, next] of [['L1', 0.9], ['L2', 0.99], ['L3', 0.99]] as const) {
      const [spec] = specsOf([{ ...IDP, strengthRung: rung }]);
      expect(controlStateAt(spec, UPGRADED_STRENGTH).phishingStageEfficacy).toBe(next);
    }
  });

  it('read the shared scale of the next rung for the control efficacy', () => {
    const [spec] = specsOf([SEG]);
    expect(controlStateAt(spec, UPGRADED_STRENGTH).preventEfficacy).toBe(declaredStrength('L3'));
  });

  it('lower what delivery lets through, on the world of the baseline and with nothing else moved', () => {
    const { law, columns, world } = setupOf([SEG, IDP]);
    const draw = worldDrawAt(columns, 0);
    const credential = stageCell(world, PHISHING_STAGE.credential, IDENTITY);
    refreshWorld(world, draw, { controlIndex: 0, state: controlStateAt(columns.controls[0], UPGRADED_STRENGTH) });
    expect(stageCell(world, PHISHING_STAGE.delivery, IDENTITY)).toBeCloseTo(0.02, 12);
    expect(stageCell(world, PHISHING_STAGE.credential, IDENTITY)).toBe(credential);
    expect(law.controls[0].phishingStage).toBe(PHISHING_STAGE.delivery);
  });

  it('read the stage coverage lever on the anchor of the declared rung', () => {
    const [spec] = specsOf([{ ...SEG, coverageBucket: 'L2' }]);
    expect(controlStateAt(spec, UPGRADED_COVERAGE).phishingStageEfficacy).toBe(0.97 * 1);
    expect(controlStateAt(spec, DECLARED_LEVER).phishingStageEfficacy).toBe(0.97 * 0.7);
  });

  it('read the anchor of the target rung, with the target coverage', () => {
    const { columns } = setupOf([SEG]);
    const target = targetStateAt(columns.controls[0], { strengthRung: 'L3', coverageBucket: 'L2' });
    expect(target.phishingStageEfficacy).toBe(0.98 * 0.7);
    expect(target.preventEfficacy).toBe(declaredStrength('L3') * 0.7);
    expect(targetStateAt(columns.controls[0], { strengthRung: 'L1', coverageBucket: 'L3' }).phishingStageEfficacy).toBe(0.89);
  });

  it('read no stage efficacy for the target of a control with no anchor', () => {
    const { columns } = setupOf([{ capabilityExternalId: 'SAT', prevent: ['T1566'] }]);
    expect(targetStateAt(columns.controls[0], { strengthRung: 'L3', coverageBucket: 'L3' })).toStrictEqual({
      deployed: true,
      preventEfficacy: declaredStrength('L3'),
      detectEfficacy: declaredStrength('L3'),
    });
  });
});

describe('knockouts and the world arithmetic at the stage', () => {
  it('lifts the stage back to one when the control is knocked out, and to its starting bits when it returns', () => {
    const { law, columns, world } = setupOf([SEG, IDP]);
    const declared = columns.controls.map((control) => controlStateAt(control, DECLARED_LEVER));
    const start = Float64Array.from(world.phishingLetThrough);
    setControlState(world, 0, { deployed: false, preventEfficacy: 0, detectEfficacy: 0 });
    expect(stageCell(world, PHISHING_STAGE.delivery, IDENTITY)).toBe(1);
    expect(stageCell(world, PHISHING_STAGE.credential, IDENTITY)).toBe(start[PHISHING_STAGE.credential * law.familyCount + familyIndexOf(law, IDENTITY)]);
    setControlState(world, 0, declared[0]);
    expect(stageCell(world, PHISHING_STAGE.delivery, IDENTITY)).toBeCloseTo(start[PHISHING_STAGE.delivery * law.familyCount + familyIndexOf(law, IDENTITY)], 15);
  });

  it('returns to the starting array, bit for bit, when an anchored control is applied and then taken off', () => {
    const { law, columns } = setupOf([SEG, IDP]);
    const undeployed = worldDrawAt(columns, 0);
    const world = prepareWorld(law, {
      ...undeployed,
      deployed: law.controls.map(() => false),
      preventEfficacy: law.controls.map(() => 0),
      detectEfficacy: law.controls.map(() => 0),
      phishingStageEfficacy: law.controls.map(() => undefined),
    });
    const start = Float64Array.from(world.phishingLetThrough);
    columns.controls.forEach((control, index) => {
      const previous = setControlState(world, index, controlStateAt(control, DECLARED_LEVER));
      expect(world.phishingLetThrough).not.toEqual(start);
      setControlState(world, index, previous);
      expect(world.phishingLetThrough).toEqual(start);
    });
  });

  it('is rebuilt from the draw by a refresh', () => {
    const { columns, world } = setupOf([SEG, IDP]);
    const draw = worldDrawAt(columns, 0);
    const fresh = Float64Array.from(world.phishingLetThrough);
    refreshWorld(world, draw, { controlIndex: 0, state: controlStateAt(columns.controls[0], UPGRADED_STRENGTH) });
    expect(world.phishingLetThrough).not.toEqual(fresh);
    refreshWorld(world, draw);
    expect(world.phishingLetThrough).toEqual(fresh);
  });
});

describe('the door memo, keyed on the let-through values', () => {
  it('reads a lever on a control acting at a stage and returns to the baseline bit for bit', () => {
    const { columns, world } = setupOf([SEG]);
    const draw = worldDrawAt(columns, 0);
    const baseline = evaluateAttackRun(world).clearByObstacle[0];
    refreshWorld(world, draw, { controlIndex: 0, state: controlStateAt(columns.controls[0], UPGRADED_STRENGTH) });
    const upgraded = evaluateAttackRun(world).clearByObstacle[0];
    expect(upgraded).toBeLessThan(baseline);
    refreshWorld(world, draw);
    expect(evaluateAttackRun(world).clearByObstacle[0]).toBe(baseline);
  });

  it('is lower under the anchor of email filtering than under the shared scale of the same declaration', () => {
    const anchored = evaluateAttackRun(setupOf([SEG]).world).clearByObstacle[0];
    const shared = evaluateAttackRun(setupOf([{ ...SEG, capabilityExternalId: 'XSP' }]).world).clearByObstacle[0];
    expect(anchored).toBeLessThan(shared);
  });
});

describe('a control with neither anchor among the controls', () => {
  const draws = (posed: ReadonlyArray<Posed>) => worldDrawAt(setupOf(posed).columns, 1);

  it('leaves the draw with no stage efficacy at all', () => {
    const draw = draws([{ capabilityExternalId: 'SAT', prevent: ['T1566'] }, { capabilityExternalId: 'EDR', prevent: ['T1486'] }]);
    expect(draw.phishingStageEfficacy).toEqual([undefined, undefined]);
  });

  it('reads the product of the shared scale at the stage, as the world did before', () => {
    const posed: ReadonlyArray<Posed> = [
      { capabilityExternalId: 'SAT', prevent: ['T1566'], strengthRung: 'L3', coverageBucket: 'L2' },
      { capabilityExternalId: 'IGA', prevent: ['T1566'], strengthRung: 'L1', coverageBucket: 'L3' },
    ];
    const { world } = setupOf(posed);
    const first = 1 - declaredStrength('L3') * 0.7;
    const second = 1 - declaredStrength('L1') * 1;
    expect(stageCell(world, PHISHING_STAGE.delivery, IDENTITY)).toBe(1 * first * second);
  });
});

describe('a run with the anchors', () => {
  const hostTechnique = (externalId: string, tacticExternalId: string): AttackRunTechnique =>
    ({ externalId, tacticExternalIds: [tacticExternalId], families: [HOST] });

  /** A repertoire wide enough for every obstacle of an impact chain, entering by phishing. */
  const RUN_REPERTOIRE: ReadonlyArray<AttackRunTechnique> = [
    ...REPERTOIRE.slice(0, 1),
    hostTechnique('X2', 'TA0006'), hostTechnique('X3', 'TA0007'), hostTechnique('X4', 'TA0008'), hostTechnique('X5', 'TA0040'),
    hostTechnique('E1', 'TA0002'), hostTechnique('S1', 'TA0005'), hostTechnique('P1', 'TA0003'), hostTechnique('C1', 'TA0011'),
    hostTechnique('T1553', 'TA0112'),
  ];

  const control = (capabilityExternalId: string, prevent: ReadonlyArray<string>): EngineRunControl => ({
    controlId: `id-${capabilityExternalId}`,
    capabilityExternalId,
    strengthRung: 'L2',
    coverageBucket: 'L3',
    preventTechniqueExternalIds: prevent,
    detectTechniqueExternalIds: [],
  });

  const inputsOf = (controls: ReadonlyArray<EngineRunControl>): EngineRunInputs => ({
    terminalTacticExternalId: 'TA0040',
    controls,
    actors: [{
      key: 'actor-1',
      name: null,
      actorClass: 'ransomware_operator',
      knobs: { capability: 0.7, stealth: 0.4, patience: 0.2, attackRunDays: 5 },
      share: 1,
      repertoire: RUN_REPERTOIRE,
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
    worlds: 40,
    seed: 'anchors-run',
  });

  const run = (controls: ReadonlyArray<EngineRunControl>) => {
    const engine = createEngineRun(inputsOf(controls));
    engine.advance(40);
    return engine.result();
  };

  it('prices email filtering at the stage anchor, below the same declaration read on the shared scale', () => {
    const anchored = run([control('SEG', ['T1566'])]);
    const shared = run([control('XSP', ['T1566'])]);
    expect(shared.vulnerability.mean).toBeGreaterThan(0);
    expect(anchored.vulnerability.mean).toBeLessThan(shared.vulnerability.mean);
  });

  it('gives the strength lever of email filtering the gain of the next anchor', () => {
    const levers = run([control('SEG', ['T1566'])]).controlValues[0].levers;
    const strength = levers.find((lever) => lever.dimension === 'strength')!;
    expect(strength.upgradedStrengthRung).toBe('L3');
    expect(strength.aleReduction.mean).toBeGreaterThan(0);
  });
});

describe('the awareness controls named through the catalogue edges', () => {
  const NAMED: ReadonlyArray<{ readonly capabilityExternalId: string, readonly strengthRung: 'L2' | 'L3' }> = [
    { capabilityExternalId: 'SEG', strengthRung: 'L2' },
    { capabilityExternalId: 'SAT', strengthRung: 'L2' },
    { capabilityExternalId: 'IDP', strengthRung: 'L3' },
  ];

  const catalogued = (capabilityExternalId: string): Posed => ({
    capabilityExternalId,
    prevent: catalogueCoverage(capabilityExternalId, 'prevent'),
  });

  it('places each at its own stage of the campaign', () => {
    const law = lawOf(NAMED.map((control) => catalogued(control.capabilityExternalId)));
    const at = (stage: number): Array<string> => law.controls
      .filter((entry) => entry.phishingStage === stage)
      .map((entry) => entry.capabilityExternalId);
    expect(at(PHISHING_STAGE.delivery)).toEqual(['SEG', 'SAT']);
    expect(at(PHISHING_STAGE.credential)).toEqual(['IDP']);
    expect(at(PHISHING_STAGE.payload)).toEqual([]);
  });

  it('reads the anchors of its stage for the controls that have one and the shared scale for the others', () => {
    const [seg, sat, idp] = NAMED.map((control) => {
      const posed = catalogued(control.capabilityExternalId);
      return controlWorldSpec(
        { capabilityExternalId: control.capabilityExternalId, strengthRung: control.strengthRung, coverageBucket: 'L3' },
        { phishingStage: phishingStageNameOf(posed.prevent) },
      );
    });
    expect(seg.phishingStage?.strength).toBe(PHISHING_STAGE_ANCHORS.SEG.strengthByRung.L2);
    expect(seg.phishingStage?.byRung).toBe(PHISHING_STAGE_ANCHORS.SEG.strengthByRung);
    expect(idp.phishingStage?.strength).toBe(PHISHING_STAGE_ANCHORS.IDP.strengthByRung.L3);
    expect(sat.phishingStage).toBeUndefined();
    expect(controlStateAt(seg, DECLARED_LEVER).phishingStageEfficacy)
      .toBeCloseTo(PHISHING_STAGE_ANCHORS.SEG.strengthByRung.L2 * seg.coverage, 12);
    expect(controlStateAt(seg, DECLARED_LEVER).preventEfficacy).toBeCloseTo(declaredStrength('L2') * seg.coverage, 12);
    expect(controlStateAt(sat, DECLARED_LEVER).phishingStageEfficacy).toBeUndefined();
  });
});
