import { describe, expect, it } from 'vitest';
import type { AttackRunControl, AttackRunGroup, AttackRunLawInputs, AttackRunTechnique, CompiledAttackRunLaw } from './attack-run-law';
import type { AttackRunControlDeclaration } from './attack-run-worlds';
import type { DoorEstate } from './attack-run-door';
import type { PhishingDoor, PhishingWorld } from './attack-run-phishing';
import type { AttackRunWorldDraw, PreparedWorld } from './attack-run-evaluation';
import { ATTACK_RUN_CONSTANTS, PHISHING_CONSTANTS, PHISHING_STAGE_TECHNIQUES } from './attack-run-constants';
import { compileAttackRunLaw, PHISHING_STAGE } from './attack-run-law';
import { evaluateAttackRun, phishingLetThroughOf, prepareWorld, refreshWorld, setControlState } from './attack-run-evaluation';
import { phishingPass, phishingSusceptibility } from './attack-run-phishing';
import { buildAttackRunWorlds, controlWorldSpec, declaredPreventEfficacy, declaredStrength, worldDrawAt } from './attack-run-worlds';

/**
 * Which controls act at each stage of a phishing campaign, what each stage lets through in a
 * prepared world, and the share of an untrained population a declared simulation rate implies.
 * Nothing here reads a stage in the door: the stages are asserted on the compiled law and the world,
 * and composed with the pure phishing pass only where a case needs the entry they feed.
 */

const IDENTITY = 'identity';
const HOST = 'host';
const MOBILE = 'mobile_device';
const FAMILIES = [IDENTITY, HOST, MOBILE] as const;

const technique = (externalId: string, tacticExternalIds: ReadonlyArray<string>, families: AttackRunTechnique['families']): AttackRunTechnique =>
  ({ externalId, tacticExternalIds, families });

/** T1566 is the one stage technique a repertoire plays; T1078, T1204 and T1203 stay outside it. */
const REPERTOIRE: ReadonlyArray<AttackRunTechnique> = [
  technique('T1566', ['TA0001'], [IDENTITY, HOST, MOBILE]),
  technique('T1486', ['TA0040'], [HOST]),
];

const GROUPS: ReadonlyArray<AttackRunGroup> = FAMILIES.map((family) => ({
  id: family,
  family,
  assets: 10,
  exposure: 'internal',
  criticality: 'medium',
  matchedByScenarioGroup: false,
}));

const DOOR: DoorEstate = {
  techniques: ['T1566'],
  families: [...FAMILIES],
  cves: [],
  assets: [],
  applicable: [Float64Array.from([10, 10, 10])],
  targetApplicable: [new Float64Array(3)],
  phishing: null,
};

const control = (
  capabilityExternalId: string,
  preventTechniqueExternalIds: ReadonlyArray<string>,
  declaredPrevent?: number,
): AttackRunControl => ({
  capabilityExternalId,
  preventTechniqueExternalIds,
  detectTechniqueExternalIds: [],
  ...(declaredPrevent === undefined ? {} : { declaredPreventEfficacy: declaredPrevent }),
});

const lawOf = (controls: ReadonlyArray<AttackRunControl>, over: Partial<AttackRunLawInputs> = {}): CompiledAttackRunLaw =>
  compileAttackRunLaw({
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

interface State {
  readonly deployed?: boolean,
  readonly prevent?: number,
}

const drawOf = (law: CompiledAttackRunLaw, states: ReadonlyArray<State>): AttackRunWorldDraw => ({
  deployed: law.controls.map((_, index) => states[index]?.deployed ?? true),
  preventEfficacy: law.controls.map((_, index) => states[index]?.prevent ?? 0),
  detectEfficacy: law.controls.map(() => 0),
  knockoutUniform: law.controls.map(() => law.obstacles.map(() => 1)),
  reactionTimeHours: { min: 8, likely: 8, max: 8 },
  cveUniform: new Float64Array(0),
  familyUniform: new Float64Array(DOOR.families.length),
});

const worldOf = (law: CompiledAttackRunLaw, states: ReadonlyArray<State> = []): PreparedWorld => prepareWorld(law, drawOf(law, states));

const familyIndexOf = (law: CompiledAttackRunLaw, family: string): number =>
  law.inputs.groups.findIndex((group) => group.family === family);

const stageCell = (world: PreparedWorld, stage: number, family: string): number =>
  world.phishingLetThrough[stage * world.law.familyCount + familyIndexOf(world.law, family)];

const indexOfControl = (law: CompiledAttackRunLaw, capabilityExternalId: string): number =>
  law.controls.findIndex((candidate) => candidate.capabilityExternalId === capabilityExternalId);

describe('the techniques that name a stage', () => {
  it('names delivery by T1566, the credential branch by T1078 and the payload branch by T1204 and T1203', () => {
    expect(PHISHING_STAGE_TECHNIQUES).toEqual({ delivery: ['T1566'], credential: ['T1078'], payload: ['T1204', 'T1203'] });
  });
});

describe('which control acts at which stage', () => {
  const stagesOf = (law: CompiledAttackRunLaw): Array<number> => law.controls.map((entry) => entry.phishingStage);
  const { delivery, credential, payload } = PHISHING_STAGE;

  it('puts email filtering and awareness at delivery, multi-factor at credentials, mobile device management at the payload', () => {
    const law = lawOf([
      control('SEG', ['T1566']),
      control('IDP', ['T1078']),
      control('UEM', ['T1203']),
      control('SAT', ['T1566']),
    ]);
    expect(stagesOf(law)).toEqual([delivery, credential, payload, delivery]);
  });

  it('counts a control with edges on T1566 and on T1204 once, at delivery', () => {
    const law = lawOf([control('EDR', ['T1204', 'T1566'])]);
    expect(stagesOf(law)).toEqual([delivery]);
  });

  it('puts a control with edges on T1078 and on T1204 at the credential branch, the first stage that holds it', () => {
    const law = lawOf([control('IDP', ['T1204', 'T1078'])]);
    expect(stagesOf(law)).toEqual([credential]);
  });

  it('folds a sub-technique onto its parent', () => {
    const law = lawOf([control('SEG', ['T1566.002']), control('UEM', ['T1204.002'])]);
    expect(stagesOf(law)).toEqual([delivery, payload]);
  });

  it('reads edges on techniques the repertoire does not play', () => {
    const law = lawOf([control('IDP', ['T1078']), control('UEM', ['T1204'])]);
    expect(law.inputs.repertoire.map((entry) => entry.externalId)).not.toContain('T1078');
    expect(stagesOf(law)).toEqual([credential, payload]);
  });

  it('leaves a control with no phishing edge at no stage', () => {
    const law = lawOf([control('EDR', ['T1486'])]);
    expect(stagesOf(law)).toEqual([-1]);
  });
});

describe('edges on techniques the repertoire does not play', () => {
  it('change no per-technique product, no covering list and no reached technique', () => {
    const plain = lawOf([control('IDP', ['T1486']), control('UEM', ['T1486'])]);
    const withEdges = lawOf([
      control('IDP', ['T1486', 'T1078']),
      control('UEM', ['T1486', 'T1204', 'T1203']),
    ]);
    expect(withEdges.controls.map((entry) => entry.preventTechniques)).toEqual(plain.controls.map((entry) => entry.preventTechniques));
    expect(withEdges.preventControlsByTechnique).toEqual(plain.preventControlsByTechnique);
    const states: Array<State> = [{ prevent: 0.5 }, { prevent: 0.3 }];
    expect(worldOf(withEdges, states).preventByFamily).toEqual(worldOf(plain, states).preventByFamily);
  });

  it('leave an evaluation as it was, bit for bit', () => {
    const states: Array<State> = [{ prevent: 0.5 }, { prevent: 0.3 }, { prevent: 0.6 }];
    const plain = lawOf([control('IDP', ['T1486']), control('UEM', ['T1486']), control('SEG', ['T1486'])]);
    const withEdges = lawOf([
      control('IDP', ['T1486', 'T1078']),
      control('UEM', ['T1486', 'T1204', 'T1203']),
      control('SEG', ['T1486', 'T1204']),
    ]);
    expect(evaluateAttackRun(worldOf(withEdges, states))).toEqual(evaluateAttackRun(worldOf(plain, states)));
  });
});

describe('what each stage lets through in a prepared world', () => {
  const law = lawOf([
    control('SEG', ['T1566']),
    control('IDP', ['T1078']),
    control('UEM', ['T1204']),
    control('SAT', ['T1566']),
  ]);
  const SEG = indexOfControl(law, 'SEG');
  const IDP = indexOfControl(law, 'IDP');
  const UEM = indexOfControl(law, 'UEM');
  const SAT = indexOfControl(law, 'SAT');
  const states: Array<State> = [];
  states[SEG] = { prevent: 0.4 };
  states[IDP] = { prevent: 0.5 };
  states[UEM] = { prevent: 0.25 };
  states[SAT] = { prevent: 0.3 };

  it('holds three cells per family and starts every one at one', () => {
    const world = worldOf(lawOf([control('SEG', ['T1566'])]), [{ prevent: 0 }]);
    expect(world.phishingLetThrough.length).toBe(3 * world.law.familyCount);
    expect([...world.phishingLetThrough].every((value) => value === 1)).toBe(true);
  });

  it('multiplies the controls of a stage on the families each one protects, and on no other', () => {
    const world = worldOf(law, states);
    // Email filtering and awareness both protect identity, host and mobile devices.
    expect(stageCell(world, PHISHING_STAGE.delivery, IDENTITY)).toBeCloseTo(0.6 * 0.7, 15);
    expect(stageCell(world, PHISHING_STAGE.delivery, HOST)).toBeCloseTo(0.6 * 0.7, 15);
    expect(stageCell(world, PHISHING_STAGE.delivery, MOBILE)).toBeCloseTo(0.6 * 0.7, 15);
    // Multi-factor protects identity and hosts, not mobile devices.
    expect(stageCell(world, PHISHING_STAGE.credential, IDENTITY)).toBe(0.5);
    expect(stageCell(world, PHISHING_STAGE.credential, HOST)).toBe(0.5);
    expect(stageCell(world, PHISHING_STAGE.credential, MOBILE)).toBe(1);
    // Endpoint management protects hosts and mobile devices, not identities.
    expect(stageCell(world, PHISHING_STAGE.payload, MOBILE)).toBe(0.75);
    expect(stageCell(world, PHISHING_STAGE.payload, HOST)).toBe(0.75);
    expect(stageCell(world, PHISHING_STAGE.payload, IDENTITY)).toBe(1);
  });

  it('counts a control present at coverage zero for nothing', () => {
    const world = worldOf(law, states.map((state) => ({ ...state, deployed: false })));
    expect([...world.phishingLetThrough].every((value) => value === 1)).toBe(true);
  });

  it('returns to the starting array, bit for bit, when a control is applied and then taken off', () => {
    const undeployed = law.controls.map(() => ({ deployed: false, prevent: 0 }));
    const world = worldOf(law, undeployed);
    const start = Float64Array.from(world.phishingLetThrough);
    law.controls.forEach((_, index) => {
      const previous = setControlState(world, index, { deployed: true, preventEfficacy: 0.37, detectEfficacy: 0 });
      expect(world.phishingLetThrough).not.toEqual(start);
      setControlState(world, index, previous);
      expect(world.phishingLetThrough).toEqual(start);
    });
  });

  it('lifts the credential branch back to one on the families a knocked-out multi-factor control protected, and on those alone', () => {
    const second = lawOf([control('IDP', ['T1078']), control('UEM', ['T1078'])]);
    const world = worldOf(second, [{ prevent: 0.5 }, { prevent: 0.2 }]);
    expect(stageCell(world, PHISHING_STAGE.credential, IDENTITY)).toBe(0.5);
    expect(stageCell(world, PHISHING_STAGE.credential, HOST)).toBeCloseTo(0.5 * 0.8, 15);
    expect(stageCell(world, PHISHING_STAGE.credential, MOBILE)).toBe(0.8);
    setControlState(world, 0, { deployed: false, preventEfficacy: 0, detectEfficacy: 0 });
    expect(stageCell(world, PHISHING_STAGE.credential, IDENTITY)).toBe(1);
    expect(stageCell(world, PHISHING_STAGE.credential, HOST)).toBe(0.8);
    expect(stageCell(world, PHISHING_STAGE.credential, MOBILE)).toBe(0.8);
  });

  it('is rebuilt from the draw by a refresh, like every product of the world', () => {
    const draw = drawOf(law, states);
    const world = prepareWorld(law, draw);
    const fresh = Float64Array.from(world.phishingLetThrough);
    setControlState(world, SEG, { deployed: true, preventEfficacy: 0.9, detectEfficacy: 0 });
    expect(world.phishingLetThrough).not.toEqual(fresh);
    refreshWorld(world, draw);
    expect(world.phishingLetThrough).toEqual(fresh);
  });
});

describe('an interdiction of the delivery technique', () => {
  const law = lawOf([control('SEG', ['T1566']), control('IDP', ['T1078']), control('UEM', ['T1204'])]);
  const world = worldOf(law, [{ prevent: 0.4 }, { prevent: 0.5 }, { prevent: 0.25 }]);
  const phishing = law.inputs.repertoire.findIndex((entry) => entry.externalId === 'T1566');
  const other = law.inputs.repertoire.findIndex((entry) => entry.externalId === 'T1486');
  const read = (interdictedPrevent: number, stage: number, family: string): number =>
    phishingLetThroughOf({ world, law, interdictedPrevent }, stage, familyIndexOf(law, family));

  it('reads delivery as zero on every family, without touching the world', () => {
    const before = Float64Array.from(world.phishingLetThrough);
    for (const family of FAMILIES) {
      expect(read(phishing, PHISHING_STAGE.delivery, family)).toBe(0);
    }
    expect(world.phishingLetThrough).toEqual(before);
  });

  it('leaves the credential and the payload branches as the world holds them', () => {
    expect(read(phishing, PHISHING_STAGE.credential, IDENTITY)).toBe(0.5);
    expect(read(phishing, PHISHING_STAGE.payload, MOBILE)).toBe(0.75);
  });

  it('reads the world when nothing is interdicted, or another technique is', () => {
    expect(read(-1, PHISHING_STAGE.delivery, IDENTITY)).toBe(0.6);
    expect(read(other, PHISHING_STAGE.delivery, IDENTITY)).toBe(0.6);
  });
});

describe('an interdiction of the technique that names the credential or the payload stage', () => {
  const law = lawOf([control('SEG', ['T1566']), control('IDP', ['T1078']), control('UEM', ['T1204'])], {
    repertoire: [
      ...REPERTOIRE,
      technique('T1078', ['TA0005'], [IDENTITY, HOST]),
      technique('T1204', ['TA0002'], [HOST, MOBILE]),
      technique('T1203', ['TA0002'], [HOST]),
    ],
  });
  const world = worldOf(law, [{ prevent: 0.4 }, { prevent: 0.5 }, { prevent: 0.25 }]);
  const positionOf = (externalId: string): number => law.inputs.repertoire.findIndex((entry) => entry.externalId === externalId);
  const read = (interdicted: string, stage: number, family: string): number =>
    phishingLetThroughOf({ world, law, interdictedPrevent: positionOf(interdicted) }, stage, familyIndexOf(law, family));

  it('closes the stage its technique names on every family, and leaves the other two as the world holds them', () => {
    for (const family of FAMILIES) {
      expect(read('T1078', PHISHING_STAGE.credential, family)).toBe(0);
      expect(read('T1204', PHISHING_STAGE.payload, family)).toBe(0);
      expect(read('T1203', PHISHING_STAGE.payload, family)).toBe(0);
    }
    expect(read('T1078', PHISHING_STAGE.delivery, IDENTITY)).toBe(0.6);
    expect(read('T1078', PHISHING_STAGE.payload, MOBILE)).toBe(0.75);
    expect(read('T1204', PHISHING_STAGE.delivery, IDENTITY)).toBe(0.6);
    expect(read('T1204', PHISHING_STAGE.credential, IDENTITY)).toBe(0.5);
  });
});

describe('the share of an untrained population a declared rate implies', () => {
  const DEFAULT = PHISHING_CONSTANTS.defaultSusceptibility;

  it('reads the default when no rate is declared, whatever the training', () => {
    expect(phishingSusceptibility(null, 1, DEFAULT)).toBe(DEFAULT);
    expect(phishingSusceptibility(null, 0.3, DEFAULT)).toBe(DEFAULT);
  });

  it('reads the declared rate as it is when no training is declared', () => {
    expect(phishingSusceptibility(0.1, 1, DEFAULT)).toBe(0.1);
  });

  it('backs the training out of a rate measured under it', () => {
    expect(phishingSusceptibility(0.1, 0.5, DEFAULT)).toBeCloseTo(0.2, 15);
  });

  it('caps the untrained share at one', () => {
    expect(phishingSusceptibility(0.9, 0.2, DEFAULT)).toBe(1);
    expect(phishingSusceptibility(1, 1, DEFAULT)).toBe(1);
  });

  it('reads a rate of zero as zero, even when the training lets nothing through', () => {
    expect(phishingSusceptibility(0, 0.5, DEFAULT)).toBe(0);
    expect(phishingSusceptibility(0, 0, DEFAULT)).toBe(0);
  });

  it('reads a positive rate under a training that lets nothing through as one', () => {
    expect(phishingSusceptibility(0.05, 0, DEFAULT)).toBe(1);
  });
});

describe('what the training lets through, read once from the declared posture', () => {
  it('is one on every family when no control trains', () => {
    const law = lawOf([control('SEG', ['T1566'], 0.4), control('IDP', ['T1078'], 0.5)]);
    expect([...law.phishingTrainingLetThrough]).toEqual([1, 1, 1]);
  });

  it('multiplies what the awareness training lets through, on the families it protects', () => {
    const law = lawOf([control('SAT', ['T1566'], 0.5), control('SEG', ['T1566'], 0.4)]);
    expect([...law.phishingTrainingLetThrough]).toEqual([0.5, 0.5, 0.5]);
  });

  it('counts a training control that has no delivery edge for nothing', () => {
    const law = lawOf([control('SAT', ['T1204'], 0.5)]);
    expect([...law.phishingTrainingLetThrough]).toEqual([1, 1, 1]);
  });

  it('counts a training control with no declared efficacy for nothing', () => {
    const law = lawOf([control('SAT', ['T1566'])]);
    expect([...law.phishingTrainingLetThrough]).toEqual([1, 1, 1]);
  });

  it('refuses a training control with no declared efficacy once a simulation rate is declared', () => {
    const declared = { phishing: { actorClass: 'default' as const, declaredSusceptibility: 0.12 } };
    expect(() => lawOf([control('SAT', ['T1566'])], declared)).toThrow();
    expect(() => lawOf([control('SAT', ['T1566'], 0.5)], declared)).not.toThrow();
    expect(() => lawOf([control('SEG', ['T1566'])], declared)).not.toThrow();
  });

  it('leaves a family the training does not protect at one', () => {
    const law = lawOf([control('SAT', ['T1566'], 0.5)], {
      groups: [...GROUPS, { ...GROUPS[0], id: 'network', family: 'network_device' }],
    });
    expect(law.phishingTrainingLetThrough[familyIndexOf(law, 'network_device')]).toBe(1);
    expect(law.phishingTrainingLetThrough[familyIndexOf(law, IDENTITY)]).toBe(0.5);
  });

  it('equals the delivery product of a world that holds the training alone, bit for bit', () => {
    const declaration: AttackRunControlDeclaration = {
      capabilityExternalId: 'SAT',
      strengthRung: 'L2',
      coverageBucket: 'L2',
    };
    const spec = controlWorldSpec(declaration);
    const columns = buildAttackRunWorlds({
      controls: [spec],
      obstacleCount: 5,
      reactionTimeHours: { min: 8, likely: 8, max: 8 },
      worlds: 4,
      seed: 'training',
      cveIds: [],
      familyIds: [...FAMILIES],
    });
    const law = lawOf([control('SAT', ['T1566'], declaredPreventEfficacy(spec))]);
    const world = prepareWorld(law, worldDrawAt(columns, 0));
    for (const family of FAMILIES) {
      expect(law.phishingTrainingLetThrough[familyIndexOf(law, family)]).toBe(stageCell(world, PHISHING_STAGE.delivery, family));
    }
    expect(law.phishingTrainingLetThrough[0]).toBeLessThan(1);
  });
});

describe('the declared efficacy a law is handed', () => {
  it('is the efficacy the world reads at the declaration, bit for bit', () => {
    const declarations: ReadonlyArray<AttackRunControlDeclaration> = [
      { capabilityExternalId: 'SAT', strengthRung: 'L2', coverageBucket: 'L2' },
      { capabilityExternalId: 'SEG', strengthRung: 'L3', coverageBucket: 'L3' },
      { capabilityExternalId: 'IDP', strengthRung: 'L1', coverageBucket: 'L1' },
    ];
    const specs = declarations.map((declaration) => controlWorldSpec(declaration));
    const columns = buildAttackRunWorlds({
      controls: specs,
      obstacleCount: 5,
      reactionTimeHours: { min: 8, likely: 8, max: 8 },
      worlds: 4,
      seed: 'declared',
      cveIds: [],
      familyIds: [],
    });
    const draw = worldDrawAt(columns, 2);
    specs.forEach((spec, index) => {
      expect(declaredPreventEfficacy(spec)).toBe(draw.preventEfficacy[index]);
    });
  });

  it('is zero for a control declared at no coverage', () => {
    expect(declaredPreventEfficacy(controlWorldSpec({
      capabilityExternalId: 'SAT',
      strengthRung: 'L3',
      coverageBucket: 'L0',
    }))).toBe(0);
  });

  it('is the strength times the coverage', () => {
    const spec = controlWorldSpec({ capabilityExternalId: 'SAT', strengthRung: 'L2', coverageBucket: 'L2' });
    expect(declaredPreventEfficacy(spec)).toBe(declaredStrength('L2') * 0.7);
  });
});

describe('a declared simulation rate against the stages', () => {
  const PEOPLE = 100;
  const DECLARED = 0.1;
  const IDENTITY_INDEX = 0;

  const door: PhishingDoor = { personFamily: IDENTITY_INDEX, deviceFamily: 1, people: PEOPLE, targetPeople: 0, persons: [], cleanPersons: [] };

  /** The entry the stages and the declared rate give, for a world whose state the caller has set. */
  const entryOf = (world: PreparedWorld, declared: number | null): number => {
    const family = familyIndexOf(world.law, IDENTITY);
    const phishing: PhishingWorld = {
      exploited: () => false,
      floorHeld: () => false,
      delivery: world.phishingLetThrough[PHISHING_STAGE.delivery * world.law.familyCount + family],
      credential: 1,
      payload: () => 1,
      susceptibility: phishingSusceptibility(declared, world.law.phishingTrainingLetThrough[family], PHISHING_CONSTANTS.defaultSusceptibility),
      campaignSize: 10,
      cap: 0.98,
    };
    return phishingPass(door, phishing, PHISHING_CONSTANTS).other;
  };

  const untrained = (): PreparedWorld => worldOf(lawOf([control('SEG', ['T1566'], 0.4), control('SAT', ['T1566'])]), [{ prevent: 0.4 }, { prevent: 0 }]);

  it('reads the rate as the untrained share when no training is declared, so deploying the training lowers the entry', () => {
    const world = untrained();
    const family = familyIndexOf(world.law, IDENTITY);
    expect(phishingSusceptibility(DECLARED, world.law.phishingTrainingLetThrough[family], 0.07)).toBe(DECLARED);
    const before = entryOf(world, DECLARED);
    setControlState(world, indexOfControl(world.law, 'SAT'), { deployed: true, preventEfficacy: 0.5, detectEfficacy: 0 });
    expect(entryOf(world, DECLARED)).toBeLessThan(before);
  });

  it('gives, at the declared posture, the entry the rate gives without the training, to rounding', () => {
    const declared = worldOf(
      lawOf([control('SEG', ['T1566'], 0.4), control('SAT', ['T1566'], 0.5)]),
      [{ prevent: 0.4 }, { prevent: 0.5 }],
    );
    const withoutTraining = worldOf(lawOf([control('SEG', ['T1566'], 0.4)]), [{ prevent: 0.4 }]);
    expect(entryOf(declared, DECLARED)).toBeCloseTo(entryOf(withoutTraining, DECLARED), 12);
  });

  it('keeps a gain for the training strength lever, the untrained share staying where the declaration put it', () => {
    const world = worldOf(
      lawOf([control('SEG', ['T1566'], 0.4), control('SAT', ['T1566'], 0.5)]),
      [{ prevent: 0.4 }, { prevent: 0.5 }],
    );
    const before = entryOf(world, DECLARED);
    setControlState(world, indexOfControl(world.law, 'SAT'), { deployed: true, preventEfficacy: 0.7, detectEfficacy: 0 });
    expect(before - entryOf(world, DECLARED)).toBeGreaterThan(0);
  });

  it('caps the untrained share at one under a strong training', () => {
    const world = worldOf(lawOf([control('SAT', ['T1566'], 0.8)]), [{ prevent: 0.8 }]);
    const family = familyIndexOf(world.law, IDENTITY);
    expect(phishingSusceptibility(0.9, world.law.phishingTrainingLetThrough[family], 0.07)).toBe(1);
  });
});
