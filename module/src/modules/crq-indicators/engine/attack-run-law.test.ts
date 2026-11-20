import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AttackRunActorClass, AttackRunConstants, AttackRunGroup, AttackRunLawInputs, AttackRunTechnique } from './attack-run-law';
import type { AttackRunEvaluation, ObstacleDiagnostic } from './attack-run-evaluation';
import type { DoorEstate } from './attack-run-door';
import type { DeclaredCriticality } from '../../supporting-assets/constants';
import { DECLARED_CRITICALITY_VALUES } from '../../supporting-assets/constants';
import { UNKNOWN_EXPOSURE_COUNTS_AS_VALUES } from '../../attack-surfaces/entry-applicability';
import { compileAttackRunLaw } from './attack-run-law';
import { noiseForAction } from './attack-noise';
import { unknownFlawFloor } from './attack-run-door';
import { evaluateAttackRun, prepareWorld } from './attack-run-evaluation';
import { resourceStepWeight, stepWeight } from './asset-scalars';
import { tacticDepth } from './walk-depth';

/**
 * The validation properties of the specification's section 13 that hold on one world, asserted on
 * the closed forms alone. The ones that need euros live in `engine-run.test.ts`.
 */

const IMPACT = 'TA0040';

const CONSTANTS: AttackRunConstants = {
  visitQuota: 5,
  populationDetectionCap: 7,
  unknownFlawFloorScale: 0.04,
  detectionScale: 0.0383,
  signalGain: 0.3,
  execFloor: 0.3,
  postDetectionRate: 0.7,
  coupleSuccessCap: 0.98,
  actorExploitedCveFloor: 0.9,
};

const RANSOMWARE: AttackRunActorClass = { capability: 0.7, stealth: 0.4, patience: 0.2, attackRunDays: 5 };

const technique = (
  externalId: string,
  tacticExternalIds: ReadonlyArray<string>,
  families: AttackRunTechnique['families'],
  populationScoped = false,
  prevalence?: number,
): AttackRunTechnique => ({ externalId, tacticExternalIds, families, populationScoped, prevalence });

const group = (id: string, family: AttackRunGroup['family'], assets: number, over: Partial<AttackRunGroup> = {}): AttackRunGroup => ({
  id,
  family,
  assets,
  exposure: 'internal',
  criticality: 'medium',
  matchedByScenarioGroup: false,
  ...over,
});

/**
 * The door a repertoire and an estate imply when a test does not state one: every Initial Access
 * technique, applicable wherever its family is present, with no finding opening anything. A world
 * that holds the floor is then the only way in, which is what the helpers below draw by default.
 */
const impliedDoor = (repertoire: ReadonlyArray<AttackRunTechnique>, groups: ReadonlyArray<AttackRunGroup>): DoorEstate => {
  const entries = repertoire.filter((candidate) => candidate.tacticExternalIds.includes('TA0001'));
  const families = [...new Set(groups.map((candidate) => candidate.family))];
  return {
    techniques: entries.map((candidate) => candidate.externalId),
    families,
    cves: [],
    assets: [],
    applicable: entries.map((candidate) => Float64Array.from(families, (family) => (candidate.families.includes(family)
      ? groups.filter((entry) => entry.family === family).reduce((sum, entry) => sum + entry.assets, 0)
      : 0))),
    targetApplicable: entries.map(() => new Float64Array(families.length)),
    phishing: null,
  };
};

const law = (over: Partial<AttackRunLawInputs>): AttackRunLawInputs => {
  const base = {
    terminalTacticExternalId: IMPACT,
    actorClass: RANSOMWARE,
    repertoire: [],
    groups: [],
    controls: [],
    constants: CONSTANTS,
    unknownExposureCountsAs: 'internal',
    unknownCriticalityCountsAs: 'low',
    ...over,
  } satisfies Partial<AttackRunLawInputs>;
  return { ...base, door: over.door ?? impliedDoor(base.repertoire, base.groups) };
};

interface ControlState {
  readonly deployed?: boolean,
  readonly prevent?: number,
  readonly detect?: number,
}

/**
 * One world with everything decided by hand. A knockout uniform of one never fires and one of zero
 * always does, so a test states which posture it is asserting instead of drawing one.
 */
const evaluate = (
  inputs: AttackRunLawInputs,
  states: ReadonlyArray<ControlState> = [],
  over: {
    knockoutUniform?: number,
    reactionTimeHours?: number,
    /** The floor uniform of every family, or of each in the door's family order: below the class floor it is drawn. Zero by default. */
    familyUniform?: number | ReadonlyArray<number>,
    /** Every CVE's exploit uniform: below its threat the exploit circulates. Zero by default. */
    cveUniform?: number,
  } = {},
): { result: AttackRunEvaluation, diagnostics: Array<ObstacleDiagnostic> } => {
  const compiled = compileAttackRunLaw(inputs);
  const world = prepareWorld(compiled, {
    deployed: compiled.controls.map((_, index) => states[index]?.deployed ?? true),
    preventEfficacy: compiled.controls.map((_, index) => states[index]?.prevent ?? 0),
    detectEfficacy: compiled.controls.map((_, index) => states[index]?.detect ?? 0),
    knockoutUniform: compiled.controls.map(() => compiled.obstacles.map(() => over.knockoutUniform ?? 1)),
    reactionTimeHours: { min: over.reactionTimeHours ?? 8, likely: over.reactionTimeHours ?? 8, max: over.reactionTimeHours ?? 8 },
    cveUniform: new Float64Array(inputs.door.cves.length).fill(over.cveUniform ?? 0),
    familyUniform: typeof over.familyUniform === 'object'
      ? Float64Array.from(over.familyUniform)
      : new Float64Array(inputs.door.families.length).fill(over.familyUniform ?? 0),
  });
  const diagnostics: Array<ObstacleDiagnostic> = [];
  return { result: evaluateAttackRun(world, undefined, diagnostics), diagnostics };
};

describe('the one rule and the obstacles', () => {
  /*
   * Each attempt plays one technique of the door, drawn in proportion to its prevalence over the
   * whole door. Asserted against the arithmetic rather than a stored number: the technique a
   * control covers contributes its own pass, weighted by its share of the attempts.
   */
  it('draws one technique per attempt in proportion to its prevalence over the door', () => {
    const inputs = law({
      repertoire: [
        technique('X1', ['TA0001'], ['host'], false, 0.6),
        technique('X2', ['TA0001'], ['host'], false, 0.3),
        technique('X3', ['TA0001'], ['host'], false, 0.2),
        technique('X4', ['TA0001'], ['network_device'], false, 0.5),
      ],
      groups: [group('hosts', 'host', 1), group('switches', 'network_device', 1)],
      controls: [{ capabilityExternalId: 'EDR', preventTechniqueExternalIds: ['X2'], detectTechniqueExternalIds: [] }],
    });
    const { result } = evaluate(inputs, [{ prevent: 0.5 }]);

    const open = CONSTANTS.coupleSuccessCap;
    expect(result.clearByObstacle[0]).toBeCloseTo((0.6 * open + 0.3 * 0.5 + 0.2 * open + 0.5 * open) / 1.6, 12);
  });

  /*
   * Validation property 2. A richly documented attacker gets no more attempts than a sparsely
   * documented one: techniques of the same strength leave the reach where it was however many there are.
   */
  it('gives a longer repertoire no more attempts', () => {
    const doors = (count: number): AttackRunLawInputs => law({
      repertoire: Array.from({ length: count }, (_, index) => technique(`X${index}`, ['TA0001'], ['host'], false, 0.3)),
      groups: [group('hosts', 'host', 10)],
      controls: [{ capabilityExternalId: 'EDR', preventTechniqueExternalIds: Array.from({ length: count }, (_, index) => `X${index}`), detectTechniqueExternalIds: [] }],
    });
    const clear = (count: number): number => evaluate(doors(count), [{ prevent: 0.9 }]).result.clearByObstacle[0];
    expect(clear(5)).toBeCloseTo(clear(1), 12);
    expect(clear(1)).toBeLessThan(1);
  });

  /*
   * The CTI documents most actors on a few tactics only. Read as a probability of trying, a tactic
   * that 4 actors in 100 document would pass for a tactic 96 cannot play, at every step of the chain.
   * Only the proportions among the documented techniques count.
   */
  it('attempts a step however few of the population are documented for it', () => {
    const inputs = (scale: number): AttackRunLawInputs => law({
      repertoire: [
        technique('X1', ['TA0001'], ['host'], false, 0.03 * scale),
        technique('X2', ['TA0001'], ['host'], false, 0.02 * scale),
        technique('X3', ['TA0001'], ['host'], false, 0),
      ],
      controls: [{ capabilityExternalId: 'EDR', preventTechniqueExternalIds: ['X2'], detectTechniqueExternalIds: [] }],
      groups: [group('hosts', 'host', 1)],
    });
    const states = [{ prevent: 0.5 }];
    expect(evaluate(inputs(1), states).result.clearByObstacle[0]).toBeCloseTo(0.6 * CONSTANTS.coupleSuccessCap + 0.4 * 0.5, 12);
    expect(evaluate(inputs(20), states).result.clearByObstacle[0]).toBeCloseTo(evaluate(inputs(1), states).result.clearByObstacle[0], 12);
  });

  /*
   * The door is one campaign over the whole estate: it grows with the assets an attack can reach
   * and not with the size of the estate around them, so a fleet that grows without any more
   * exposure leaves it where it was.
   */
  it('prices the door on the assets an attack can reach, not on the estate around them', () => {
    const door = (reachable: number): DoorEstate => ({
      techniques: ['X1'],
      families: ['host', 'network_device'],
      cves: [],
      assets: [],
      applicable: [Float64Array.from([reachable, 0])],
      targetApplicable: [Float64Array.from([0, 0])],
      phishing: null,
    });
    const estate = (scale: number, reachable: number): AttackRunLawInputs => law({
      repertoire: [technique('X1', ['TA0001'], ['host']), technique('X2', ['TA0001'], ['network_device'])],
      groups: [group('hosts', 'host', 40 * scale), group('switches', 'network_device', 10 * scale)],
      controls: [{ capabilityExternalId: 'EDR', preventTechniqueExternalIds: ['X1'], detectTechniqueExternalIds: [] }],
      door: door(reachable),
    });
    const clear = (scale: number, reachable: number): number => evaluate(estate(scale, reachable), [{ prevent: 0.9 }]).result.clearByObstacle[0];
    expect(clear(100, 3)).toBe(clear(1, 3));
    expect(clear(1, 3)).toBeCloseTo(0.5 * (1 - 0.9 ** 3), 12);
    expect(clear(1, 30)).toBeGreaterThan(clear(1, 3));
  });

  /*
   * Section 5: two controls covering one technique multiply on the prevent side, and the detect
   * side is the complement of the same product because one sensor seeing is enough.
   */
  it('multiplies prevention and complements detection', () => {
    const inputs = law({
      repertoire: [technique('X1', ['TA0001'], ['host'])],
      groups: [group('hosts', 'host', 10)],
      controls: [
        { capabilityExternalId: 'EDR', preventTechniqueExternalIds: ['X1'], detectTechniqueExternalIds: ['X1'] },
        { capabilityExternalId: 'NGFW', preventTechniqueExternalIds: ['X1'], detectTechniqueExternalIds: ['X1'] },
      ],
    });
    const { result, diagnostics } = evaluate(inputs, [{ prevent: 0.5, detect: 0.5 }, { prevent: 0.4, detect: 0.4 }]);

    const prevented = (1 - 0.5) * (1 - 0.4);
    expect(result.clearByObstacle[0]).toBeCloseTo(1 - (1 - prevented) ** 10, 12);

    const detected = 1 - (1 - 0.5) * (1 - 0.4);
    const signal = 0.5 * detected;
    expect(diagnostics[0].ownDetection).toBeCloseTo(CONSTANTS.detectionScale * signal, 12);
  });

  /*
   * Section 5.1 survives past the door: the actor-exploited CVE floors the prevent side of the
   * obstacles that follow it, and the ordinary path stands where it is already the better of the two.
   */
  it('floors the success of a later obstacle the group carries an actor-exploited CVE for', () => {
    const inputs = (share: number): AttackRunLawInputs => law({
      repertoire: [technique('X1', ['TA0001'], ['host']), technique('X2', ['TA0006'], ['host'])],
      groups: [group('hosts', 'host', 10, { cveFloors: share === 0 ? [] : [{ techniqueExternalId: 'X2', share }] })],
    });
    const floored = evaluate(inputs(1)).result.clearByObstacle[1];
    const ordinary = evaluate(inputs(0)).result.clearByObstacle[1];
    expect(floored).toBeCloseTo(1 - (1 - CONSTANTS.actorExploitedCveFloor) ** CONSTANTS.visitQuota, 12);
    expect(floored).toBeGreaterThan(ordinary);
  });

  /* Only the holders exploiting the CVE are floored, so the success mixes the two readings by their share. */
  it('floors only the share of the holders that exploit the CVE, and gives each later obstacle its own visits', () => {
    const { result } = evaluate(law({
      repertoire: [technique('X1', ['TA0001'], ['host']), technique('X2', ['TA0006'], ['host'])],
      groups: [group('hosts', 'host', 10, { cveFloors: [{ techniqueExternalId: 'X2', share: 0.25 }] })],
    }));
    const ordinary = RANSOMWARE.capability * CONSTANTS.execFloor;
    const success = ordinary + 0.25 * (CONSTANTS.actorExploitedCveFloor - ordinary);
    expect(result.clearByObstacle[1]).toBeCloseTo(1 - (1 - success) ** CONSTANTS.visitQuota, 12);
  });

  /*
   * The door prices the estate's own exposure, so a route an actor holds a CVE for opens nothing
   * there: the floor of the actor's CVE is the business of the obstacles after it.
   */
  it('reads no actor-exploited CVE floor at the door', () => {
    const inputs = (share: number): AttackRunLawInputs => law({
      repertoire: [technique('X1', ['TA0001'], ['host'])],
      groups: [group('hosts', 'host', 10, { cveFloors: share === 0 ? [] : [{ techniqueExternalId: 'X1', share }] })],
    });
    expect(evaluate(inputs(1)).result.clearByObstacle[0]).toBe(evaluate(inputs(0)).result.clearByObstacle[0]);
  });

  /*
   * The scenario group multiplies the step weight and never replaces it. Replacement was a
   * confirmed defect: criticality reaches full strength at high depth, which is exactly where the
   * replacement happened, so a crown jewel and a forgotten sensor contributed identically to the
   * obstacle that decides the loss.
   */
  it('multiplies the step weight by the scenario-group boost at a resource-touching obstacle', () => {
    const inputs = law({
      repertoire: [technique('X1', ['TA0040'], ['host']), technique('X2', ['TA0001'], ['host']),
        technique('X3', ['TA0006'], ['host']), technique('X4', ['TA0007'], ['host']), technique('X5', ['TA0008'], ['host'])],
      groups: [
        group('jewels', 'host', 10, { matchedByScenarioGroup: true, criticality: 'high' }),
        group('desktops', 'host', 10, { criticality: 'low' }),
      ],
    });
    const { diagnostics } = evaluate(inputs);
    const terminal = diagnostics[diagnostics.length - 1];
    const depth = tacticDepth(IMPACT, IMPACT);
    const weightOf = (criticality: DeclaredCriticality, matched: boolean): number =>
      10 * stepWeight('internal', criticality, depth) * resourceStepWeight(matched);
    const jewels = weightOf('high', true);
    const desktops = weightOf('low', false);
    expect(terminal.groups[0].weightShare).toBeCloseTo(jewels / (jewels + desktops), 12);
  });
});

describe('the step weights of a group of unknown exposure or criticality', () => {
  /*
   * Obstacle 1 (credentials) is a depth step, weighing by exposure and criticality; obstacle 0 (the
   * door) weighs by exposure alone and carries the detection share. Two groups of one family differ
   * by one attribute only, so a share compares to the share of a twin law whose group A is declared.
   */
  const repertoire = [
    technique('X1', ['TA0001'], ['host']), technique('X2', ['TA0006'], ['host']),
    technique('X3', ['TA0007'], ['host']), technique('X4', ['TA0008'], ['host']),
    technique('X5', ['TA0040'], ['host']),
  ];
  type UnknownSettings = Pick<AttackRunLawInputs, 'unknownExposureCountsAs' | 'unknownCriticalityCountsAs'>;
  const sharesOf = (groups: ReadonlyArray<AttackRunGroup>, obstacle: number, settings: Partial<UnknownSettings> = {}): Array<number> =>
    compileAttackRunLaw(law({ terminalTacticExternalId: IMPACT, repertoire, groups, ...settings }))
      .obstacles[obstacle].groups.map((entry) => entry.weightShare);

  it('reads obstacle 1 at a depth strictly between the door and the objective', () => {
    const depth = tacticDepth('TA0006', IMPACT);
    expect(depth).toBeGreaterThan(0);
    expect(depth).toBeLessThan(1);
  });

  describe('of unknown exposure', () => {
    const pair = (exposure: AttackRunGroup['exposure']): Array<AttackRunGroup> => [
      group('a', 'host', 10, { exposure }),
      group('b', 'host', 10, { exposure: 'internet_facing' }),
    ];

    it.each(UNKNOWN_EXPOSURE_COUNTS_AS_VALUES)('reads an unknown exposure as %s at the door and at a depth step under that setting', (setting) => {
      for (const obstacle of [0, 1]) {
        expect(sharesOf(pair('unknown'), obstacle, { unknownExposureCountsAs: setting })).toEqual(sharesOf(pair(setting), obstacle));
      }
    });

    it('shares the same way between groups that are all unknown, whatever the setting', () => {
      const unknowns = [
        group('a', 'host', 10, { exposure: 'unknown', criticality: 'low' }),
        group('b', 'host', 10, { exposure: 'unknown', criticality: 'high' }),
      ];
      for (const obstacle of [0, 1]) {
        const internal = sharesOf(unknowns, obstacle, { unknownExposureCountsAs: 'internal' });
        const exposed = sharesOf(unknowns, obstacle, { unknownExposureCountsAs: 'internet_facing' });
        expect(exposed[0]).toBeCloseTo(internal[0], 12);
        expect(exposed[1]).toBeCloseTo(internal[1], 12);
      }
    });
  });

  describe('of unknown criticality', () => {
    const pair = (criticality: AttackRunGroup['criticality']): Array<AttackRunGroup> => [
      group('a', 'host', 10, { criticality }),
      group('b', 'host', 10, { criticality: 'high' }),
    ];

    it.each(DECLARED_CRITICALITY_VALUES)('reads an unknown criticality as %s at a depth step under that setting', (band) => {
      expect(sharesOf(pair('unknown'), 1, { unknownCriticalityCountsAs: band })).toEqual(sharesOf(pair(band), 1));
    });

    it('leaves the share at the door alone, where criticality weighs nothing', () => {
      const declared = sharesOf(pair('unknown'), 0);
      for (const band of DECLARED_CRITICALITY_VALUES) {
        expect(sharesOf(pair('unknown'), 0, { unknownCriticalityCountsAs: band })).toEqual(declared);
      }
    });

    it('never moves the share of a declared criticality with the setting', () => {
      const declared = [group('a', 'host', 10, { criticality: 'medium' }), group('b', 'host', 10, { criticality: 'high' })];
      expect(sharesOf(declared, 1, { unknownCriticalityCountsAs: 'very_high' })).toEqual(sharesOf(declared, 1, { unknownCriticalityCountsAs: 'low' }));
    });
  });
});

describe('the door as one campaign over the estate', () => {
  const doorOf = (over: Partial<DoorEstate> & Pick<DoorEstate, 'techniques' | 'families' | 'applicable'>): DoorEstate => ({
    cves: [],
    assets: [],
    targetApplicable: over.applicable.map((row) => new Float64Array(row.length)),
    ...over,
    phishing: over.phishing ?? null,
  });

  it('never falls to a technique the estate offers nothing to', () => {
    const inputs = law({
      repertoire: [technique('T1190', ['TA0001'], ['host', 'web_application'])],
      groups: [group('hosts', 'host', 40), group('edge', 'web_application', 3)],
      door: doorOf({ techniques: ['T1190'], families: ['host', 'web_application'], applicable: [Float64Array.from([0, 0])] }),
    });
    const { result } = evaluate(inputs, [], { familyUniform: 0, cveUniform: 0 });
    expect(result.clearByObstacle[0]).toBe(0);
    expect(result.reach).toBe(0);
  });

  it('keeps the share of the attempts a technique with nothing to attack takes', () => {
    const inputs = law({
      repertoire: [
        technique('T1190', ['TA0001'], ['host'], false, 0.6),
        technique('T1566', ['TA0001'], ['host'], false, 0.4),
      ],
      groups: [group('hosts', 'host', 10)],
      door: doorOf({ techniques: ['T1190', 'T1566'], families: ['host'], applicable: [Float64Array.from([2]), Float64Array.from([0])] }),
    });
    expect(evaluate(inputs).result.clearByObstacle[0]).toBeCloseTo(0.6 * (1 - (1 - CONSTANTS.coupleSuccessCap) ** 2), 12);
  });

  it('draws the exploit of a flaw from the world and opens only the assets that carry it', () => {
    const inputs = law({
      repertoire: [technique('T1190', ['TA0001'], ['host'])],
      groups: [group('hosts', 'host', 10)],
      controls: [{ capabilityExternalId: 'EDR', preventTechniqueExternalIds: ['T1190'], detectTechniqueExternalIds: [] }],
      door: doorOf({
        techniques: ['T1190'],
        families: ['host'],
        cves: [{ cveId: 'CVE-2024-1', threat: 0.3, priced: true }],
        assets: [{ family: 0, openings: [{ cve: 0, technique: 0, opening: 0.5 }], target: false }, { family: 0, openings: [{ cve: 0, technique: 0, opening: 0.5 }], target: false }],
        applicable: [Float64Array.from([2])],
      }),
    });
    const states = [{ prevent: 0.2 }];
    const unlucky = evaluate(inputs, states, { cveUniform: 0.4, familyUniform: 1 });
    const lucky = evaluate(inputs, states, { cveUniform: 0.2, familyUniform: 1 });
    const each = 0.8 * 0.5;
    expect(unlucky.result.clearByObstacle[0]).toBe(0);
    expect(lucky.result.clearByObstacle[0]).toBeCloseTo(1 - (1 - each) ** 2, 12);
  });

  /*
   * The door reads where the estate is open and what the defence lets through, never how able the
   * attacker is: the capability only decides how often a family holds a flaw nobody listed.
   */
  it('reads no capability, which only sets how often the floor of a family is drawn', () => {
    const inputs = (capability: number): AttackRunLawInputs => law({
      actorClass: { ...RANSOMWARE, capability },
      repertoire: [technique('T1190', ['TA0001'], ['host'])],
      groups: [group('hosts', 'host', 10)],
      controls: [{ capabilityExternalId: 'EDR', preventTechniqueExternalIds: ['T1190'], detectTechniqueExternalIds: [] }],
    });
    const states = [{ prevent: 0.5 }];
    expect(evaluate(inputs(0.2), states, { familyUniform: 0 }).result.clearByObstacle[0])
      .toBe(evaluate(inputs(0.9), states, { familyUniform: 0 }).result.clearByObstacle[0]);

    const between = (unknownFlawFloor(0.2, CONSTANTS.unknownFlawFloorScale) + unknownFlawFloor(0.9, CONSTANTS.unknownFlawFloorScale)) / 2;
    expect(evaluate(inputs(0.2), states, { familyUniform: between }).result.clearByObstacle[0]).toBe(0);
    expect(evaluate(inputs(0.9), states, { familyUniform: between }).result.clearByObstacle[0]).toBeGreaterThan(0);
  });

  it('decides the floor of each family on that family\'s own uniform, whatever order the groups come in', () => {
    const inputs = law({
      repertoire: [technique('T1190', ['TA0001'], ['host', 'web_application'])],
      groups: [group('hosts', 'host', 10), group('edge', 'web_application', 10)],
      controls: [{ capabilityExternalId: 'OSH', preventTechniqueExternalIds: ['T1190'], detectTechniqueExternalIds: [] }],
      door: doorOf({ techniques: ['T1190'], families: ['web_application', 'host'], applicable: [Float64Array.from([0, 3])] }),
    });
    const hostOnly = evaluate(inputs, [{ prevent: 0.5 }], { familyUniform: [1, 0] });
    expect(hostOnly.result.clearByObstacle[0]).toBeCloseTo(1 - 0.5 ** 3, 12);
    const webOnly = evaluate(inputs, [{ prevent: 0.5 }], { familyUniform: [0, 1] });
    expect(webOnly.result.clearByObstacle[0]).toBe(0);
  });

  it('reads the defence of the family the assets are in', () => {
    const inputs = law({
      repertoire: [technique('T1190', ['TA0001'], ['host', 'web_application'])],
      groups: [group('hosts', 'host', 10), group('edge', 'web_application', 10)],
      controls: [{ capabilityExternalId: 'OSH', preventTechniqueExternalIds: ['T1190'], detectTechniqueExternalIds: [] }],
      door: doorOf({ techniques: ['T1190'], families: ['web_application', 'host'], applicable: [Float64Array.from([4, 4])] }),
    });
    const { result } = evaluate(inputs, [{ prevent: 0.5 }]);
    expect(result.clearByObstacle[0]).toBeCloseTo(1 - ((1 - CONSTANTS.coupleSuccessCap) ** 4) * (0.5 ** 4), 12);
  });

  /*
   * Valid accounts needs credentials as an obstacle further down the walk, and is also a way in: the
   * door plays it, and a technique with no asset a campaign can land on is never played.
   */
  it('plays valid accounts at the door', () => {
    const inputs = law({
      repertoire: [technique('T1078', ['TA0001', 'TA0004'], ['identity'])],
      groups: [group('accounts', 'identity', 5)],
    });
    expect(compileAttackRunLaw(inputs).unplayableObstacleKeys).not.toContain('foothold');
    expect(evaluate(inputs).result.clearByObstacle[0]).toBeCloseTo(1 - (1 - CONSTANTS.coupleSuccessCap) ** 5, 12);
  });

  it('never plays a technique no asset can be landed on, nor shares its attempts with it', () => {
    const onlyPhysical = law({
      repertoire: [technique('T1200', ['TA0001'], ['host'])],
      groups: [group('hosts', 'host', 5)],
    });
    expect(compileAttackRunLaw(onlyPhysical).unplayableObstacleKeys).toContain('foothold');

    const withPhysical = law({
      repertoire: [technique('T1200', ['TA0001'], ['host']), technique('T1190', ['TA0001'], ['host'])],
      groups: [group('hosts', 'host', 5)],
      door: doorOf({ techniques: ['T1190'], families: ['host'], applicable: [Float64Array.from([1])] }),
    });
    expect(evaluate(withPhysical).result.clearByObstacle[0]).toBeCloseTo(CONSTANTS.coupleSuccessCap, 12);
  });

  it('folds a sub-technique of the repertoire onto the parent the estate offers, each under its own defence', () => {
    const inputs = law({
      repertoire: [technique('T1566', ['TA0001'], ['host']), technique('T1566.001', ['TA0001'], ['host'])],
      groups: [group('hosts', 'host', 10)],
      controls: [{ capabilityExternalId: 'EDR', preventTechniqueExternalIds: ['T1566.001'], detectTechniqueExternalIds: [] }],
      door: doorOf({ techniques: ['T1566'], families: ['host'], applicable: [Float64Array.from([1])] }),
    });
    expect(evaluate(inputs, [{ prevent: 0.5 }]).result.clearByObstacle[0])
      .toBeCloseTo(0.5 * CONSTANTS.coupleSuccessCap + 0.5 * 0.5, 12);
  });

  /*
   * The door's detection is what it always was, with its cap of opportunities on the population
   * given its own constant: a refit of the visits of the later steps does not move it.
   */
  it('keeps the detection of the door and caps a wave on the population cap, not on the visits', () => {
    const inputs = law({
      repertoire: [technique('T1189', ['TA0001'], ['host'], true)],
      groups: [group('hosts', 'host', 50)],
      controls: [{ capabilityExternalId: 'EDR', preventTechniqueExternalIds: [], detectTechniqueExternalIds: ['T1189'] }],
      constants: { ...CONSTANTS, visitQuota: 9, populationDetectionCap: 3 },
    });
    const { diagnostics } = evaluate(inputs, [{ detect: 0.5 }]);

    const reached = RANSOMWARE.capability * CONSTANTS.execFloor;
    expect(Math.sqrt(50 * (1 - reached))).toBeGreaterThan(3);
    const probability = CONSTANTS.detectionScale * (noiseForAction('TA0001', 'T1189') ?? 0) * 0.5;
    expect(probability).toBeGreaterThan(0);
    expect(diagnostics[0].ownDetection).toBeCloseTo(1 - (1 - probability) ** 3, 12);
  });

  it('gives a phishing campaign nothing to detect and no noise to carry on an estate with no person', () => {
    const inputs = law({
      repertoire: [technique('T1566', ['TA0001'], ['host'], true)],
      groups: [group('hosts', 'host', 50)],
      controls: [{ capabilityExternalId: 'EDR', preventTechniqueExternalIds: [], detectTechniqueExternalIds: ['T1566'] }],
      door: doorOf({ techniques: ['T1566'], families: ['host'], applicable: [Float64Array.from([0])], phishing: null }),
    });
    const { result, diagnostics } = evaluate(inputs, [{ detect: 0.5 }]);
    expect(result.clearByObstacle[0]).toBe(0);
    expect(diagnostics[0].ownDetection).toBe(0);
    expect(diagnostics[0].emitted).toBe(0);
  });
});

describe('the five functions', () => {
  const withFunctions = (over: Partial<AttackRunLawInputs> = {}): AttackRunLawInputs => law({
    repertoire: [
      technique('X1', ['TA0001'], ['host', 'network_device']),
      technique('X2', ['TA0006'], ['host', 'network_device']),
      technique('X3', ['TA0007'], ['host', 'network_device']),
      technique('X4', ['TA0008'], ['host', 'network_device']),
      technique('X5', ['TA0040'], ['host', 'network_device']),
      technique('E1', ['TA0002'], ['host', 'network_device']),
      technique('S1', ['TA0005'], ['host', 'network_device']),
      technique('P1', ['TA0003'], ['host', 'network_device']),
      technique('C1', ['TA0011'], ['host', 'network_device']),
    ],
    groups: [group('hosts', 'host', 10), group('switches', 'network_device', 10)],
    ...over,
  });

  /*
   * A function is established where it is used, so on a homogeneous estate every obstacle returns
   * the same value and the per-obstacle refinement costs nothing. That degenerate equality is the
   * check that the refinement is a refinement rather than a new law.
   */
  it('reads the same value at every obstacle of a homogeneous estate', () => {
    const { diagnostics } = evaluate(withFunctions({ groups: [group('fleet', 'host', 200)] }));
    const factors = diagnostics.map((obstacle) => obstacle.groups[0].toolFactor);
    expect(new Set(factors).size).toBe(1);
    expect(factors[0]).toBeGreaterThan(CONSTANTS.execFloor);
  });

  /*
   * Section 7.2: the eviction gate is a conjunction. An implant with no channel is inert and a
   * channel with no implant is gone once the host is cleaned, so covering either lowers the
   * anchoring, and a tenant covering neither anchors hardest of all.
   */
  it('lowers the anchoring when either half of the eviction gate is covered', () => {
    const covering = (techniqueExternalIds: ReadonlyArray<string>): number => evaluate(
      withFunctions({
        controls: [{ capabilityExternalId: 'EDR', preventTechniqueExternalIds: techniqueExternalIds, detectTechniqueExternalIds: [] }],
      }),
      [{ prevent: 0.8 }],
    ).result.anchoring;
    const neither = covering([]);
    expect(covering(['P1'])).toBeLessThan(neither);
    expect(covering(['C1'])).toBeLessThan(neither);
    expect(covering(['P1', 'C1'])).toBeLessThan(covering(['P1']));
  });
});

describe('sabotage', () => {
  /*
   * `T1553` takes the endpoint agent down in the shipped relation and nothing in this repertoire
   * targets multi-factor authentication, which is what makes "a capability falls only to what
   * targets it" assertable rather than merely stated.
   */
  const saboteur = (over: Partial<AttackRunLawInputs> = {}): AttackRunLawInputs => law({
    repertoire: [
      technique('X1', ['TA0001'], ['host']),
      technique('X2', ['TA0006'], ['host']),
      technique('X3', ['TA0007'], ['host']),
      technique('X4', ['TA0008'], ['host']),
      technique('X5', ['TA0040'], ['host']),
      technique('T1553', ['TA0112'], ['host']),
    ],
    groups: [group('hosts', 'host', 50)],
    controls: [
      { capabilityExternalId: 'EDR', preventTechniqueExternalIds: ['X1', 'X5'], detectTechniqueExternalIds: ['X1', 'X5'] },
      { capabilityExternalId: 'IDP', preventTechniqueExternalIds: ['X2'], detectTechniqueExternalIds: ['X2'] },
    ],
    ...over,
  });

  it('never takes down a capability the repertoire does not target', () => {
    const { diagnostics } = evaluate(saboteur(), [{ prevent: 0.6, detect: 0.5 }, { prevent: 0.6, detect: 0.5 }], { knockoutUniform: 0 });
    for (const obstacle of diagnostics) {
      expect(obstacle.knockedCapabilityExternalIds).not.toContain('IDP');
    }
    expect(diagnostics.some((obstacle) => obstacle.knockedCapabilityExternalIds.includes('EDR'))).toBe(true);
  });

  /*
   * A knocked-out capability is absent, on both functions at once. A knockout reaching prevention
   * alone would make sabotage a pure success bonus, so the detection has to fall with the reach.
   */
  it('takes a knocked-out capability out of prevention and detection together', () => {
    const states = [{ prevent: 0.6, detect: 0.5 }, { prevent: 0.6, detect: 0.5 }];
    const intact = evaluate(saboteur(), states, { knockoutUniform: 1 });
    const sabotaged = evaluate(saboteur(), states, { knockoutUniform: 0 });
    expect(sabotaged.result.reach).toBeGreaterThan(intact.result.reach);
    expect(sabotaged.diagnostics[0].ownDetection).toBeLessThan(intact.diagnostics[0].ownDetection);
  });

  /*
   * The establishments read the intact posture: an attacker cannot use a sabotage it has not yet
   * succeeded at to help itself succeed. The knockout of the door therefore does not raise the
   * establishment of the obstacle that follows it, which is what a law with a fixed point instead
   * of a closed form would do.
   */
  it('decides every knockout against the undegraded posture', () => {
    const states = [{ prevent: 0.6, detect: 0.5 }, { prevent: 0.6, detect: 0.5 }];
    const { diagnostics } = evaluate(saboteur(), states, { knockoutUniform: 0 });
    const knocked = diagnostics.map((obstacle) => obstacle.knockedCapabilityExternalIds.join(','));
    expect(new Set(knocked).size).toBe(1);
  });

  /*
   * Validation property 26, and the only one a per-capability average would break. The knockout is
   * one Bernoulli draw shared by everything the capability covers, so the techniques it alone
   * contests pass **together**. Averaging it into an effective strength, which is the optimisation
   * a future reader will reach for, deletes exactly that: the comparison below holds the expected
   * efficacy identical and differs only in whether the capability is down as a bit or as a fraction.
   */
  it('keeps the common mode a per-capability average would delete', () => {
    const states = [{ prevent: 0.6, detect: 0.5 }, { prevent: 0.6, detect: 0.5 }];
    /* The door reads the posture through a single asset, so that it moves with the bit instead of
     * saturating at one whichever way the knockout falls: the correlation is between the door and
     * the objective, and a door at one carries none. */
    const sensitiveDoor: DoorEstate = { techniques: ['X1'], families: ['host'], cves: [], assets: [], applicable: [Float64Array.from([1])], targetApplicable: [Float64Array.from([0])], phishing: null };
    /* One sabotage technique at the quota, so the establishment is the bare success of one play:
     * capability 0.7 against an uncontested product, under a tooling factor at its floor. */
    const established = RANSOMWARE.capability * CONSTANTS.execFloor;
    expect(evaluate(saboteur({ door: sensitiveDoor }), states, { knockoutUniform: established - 0.01 }).diagnostics[0]
      .knockedCapabilityExternalIds).toContain('EDR');
    expect(evaluate(saboteur({ door: sensitiveDoor }), states, { knockoutUniform: established + 0.01 }).diagnostics[0]
      .knockedCapabilityExternalIds).toHaveLength(0);

    const drawn = established * evaluate(saboteur({ door: sensitiveDoor }), states, { knockoutUniform: 0 }).result.reach
      + (1 - established) * evaluate(saboteur({ door: sensitiveDoor }), states, { knockoutUniform: 1 }).result.reach;
    /* The same posture with the knockout averaged in: `SAB1` is a Defense Impairment technique the
     * relation maps to nothing, so it emits the same noise and takes nothing down, and EDR carries
     * its expected efficacy instead. */
    const averaged = evaluate(
      saboteur({
        door: sensitiveDoor,
        repertoire: saboteur().repertoire.map((candidate) => (candidate.externalId === 'T1553'
          ? technique('SAB1', ['TA0112'], ['host'])
          : candidate)),
      }),
      [
        { prevent: 0.6 * (1 - established), detect: 0.5 * (1 - established) },
        { prevent: 0.6, detect: 0.5 },
      ],
    ).result.reach;
    expect(drawn).toBeGreaterThan(averaged);
  });

  /*
   * One attempt plays the class's impairment techniques by prevalence, as every obstacle plays its
   * own: the class impairs the way its documented actors do on average. A technique added to the
   * repertoire takes its share of that attempt from the others, so one taking down nothing the
   * posture holds lowers the knockouts they land.
   */
  it('shares one impairment attempt among the techniques the class plays', () => {
    const states = [{ prevent: 0.6, detect: 0.5 }, { prevent: 0.6, detect: 0.5 }];
    const alone = saboteur();
    const shared = saboteur({ repertoire: [...alone.repertoire, technique('SAB1', ['TA0112'], ['host'])] });
    // Between T1553's establishment alone and its half share beside an equally prevalent technique.
    const uniform = { knockoutUniform: 0.75 * RANSOMWARE.capability * CONSTANTS.execFloor };
    expect(evaluate(alone, states, uniform).diagnostics[0].knockedCapabilityExternalIds).toContain('EDR');
    expect(evaluate(shared, states, uniform).diagnostics[0].knockedCapabilityExternalIds).toHaveLength(0);
  });

  /*
   * Anti-tampering is worth something: a posture covering the impairment technique in prevention
   * contests the attempt, so its own capability survives more often and the reach falls.
   */
  it('rewards a posture that contests the impairment technique itself', () => {
    const unprotected = saboteur();
    const protectedEdges = saboteur({
      controls: [
        {
          capabilityExternalId: 'EDR',
          preventTechniqueExternalIds: ['X1', 'X5', 'T1553'],
          detectTechniqueExternalIds: ['X1', 'X5'],
        },
        { capabilityExternalId: 'IDP', preventTechniqueExternalIds: ['X2'], detectTechniqueExternalIds: ['X2'] },
      ],
    });
    const states = [{ prevent: 0.6, detect: 0.5 }, { prevent: 0.6, detect: 0.5 }];
    /* The establishment reads 0.21 against the unprotected posture and 0.084 against the protected
     * one, so a uniform between the two is exactly where the anti-tampering edge earns its keep. */
    const uniform = 0.15;
    expect(evaluate(protectedEdges, states, { knockoutUniform: uniform }).result.reach)
      .toBeLessThan(evaluate(unprotected, states, { knockoutUniform: uniform }).result.reach);
  });
});

describe('detection, the race and the outcomes', () => {
  const chain = (over: Partial<AttackRunLawInputs> = {}): AttackRunLawInputs => law({
    repertoire: [
      technique('X1', ['TA0001'], ['host']),
      technique('X2', ['TA0006'], ['host']),
      technique('X3', ['TA0007'], ['host']),
      technique('X4', ['TA0008'], ['host']),
      technique('X5', ['TA0040'], ['host']),
      technique('E1', ['TA0002'], ['host']),
      technique('P1', ['TA0003'], ['host']),
      technique('C1', ['TA0011'], ['host']),
    ],
    groups: [group('fleet', 'host', 200)],
    controls: [{ capabilityExternalId: 'EDR', preventTechniqueExternalIds: ['X1', 'X4'], detectTechniqueExternalIds: ['X1', 'X2', 'X3', 'X4', 'X5'] }],
    ...over,
  });

  const states = [{ prevent: 0.5, detect: 0.5 }];

  /* Validation property 14: the first-detection positions and `unseen` are a partition. */
  it('partitions the first detection exactly', () => {
    const { result } = evaluate(chain(), states);
    const total = result.firstDetectionAtObstacle.reduce((sum, share) => sum + share, result.firstDetectionAtAnchoring) + result.unseen;
    expect(total).toBeCloseTo(1, 12);
  });

  /*
   * Validation property 15, probed through the one knob that reaches the accumulator and nothing
   * else. At gain zero the two extremes of class patience must agree bit for bit: any leak of the
   * accumulator into a second expression separates them. Asserted by equality, because a tolerance
   * would hide exactly the leak this exists to catch.
   */
  it('returns the memoryless law exactly at gain zero', () => {
    const memoryless = { ...CONSTANTS, signalGain: 0 };
    const patient = chain({ constants: memoryless, actorClass: { ...RANSOMWARE, patience: 0.95 } });
    const restless = chain({ constants: memoryless, actorClass: { ...RANSOMWARE, patience: 0 } });
    expect(evaluate(patient, states).result.outcomes).toEqual(evaluate(restless, states).result.outcomes);
  });

  it('lets patience move the result once the gain is on, so the probe above has teeth', () => {
    const amplified = { ...CONSTANTS, signalGain: 3 };
    const patient = chain({ constants: amplified, actorClass: { ...RANSOMWARE, patience: 0.95 } });
    const restless = chain({ constants: amplified, actorClass: { ...RANSOMWARE, patience: 0 } });
    expect(evaluate(patient, states).result.unseen).not.toBe(evaluate(restless, states).result.unseen);
  });

  /* Validation property 18: the defence warms up, it does not start warm. */
  it('never amplifies the door', () => {
    const low = evaluate(chain({ constants: { ...CONSTANTS, signalGain: 0 } }), states);
    const high = evaluate(chain({ constants: { ...CONSTANTS, signalGain: 6 } }), states);
    expect(high.diagnostics[0].accumulatorBefore).toBe(0);
    expect(high.diagnostics[0].ownDetection).toBe(low.diagnostics[0].ownDetection);
    expect(high.diagnostics[1].ownDetection).toBeGreaterThan(low.diagnostics[1].ownDetection);
  });

  /*
   * Validation property 16, asserted structurally rather than through an output: the accumulator
   * enters exactly one expression, and no comparison of it against a constant, no enumerated
   * detection state and no transition function exists. A behavioural test cannot see the difference
   * between a hazard and a ladder until the ladder has already shipped.
   */
  it('reads the accumulator in exactly one expression', () => {
    const source = readFileSync(fileURLToPath(new URL('./attack-run-evaluation.ts', import.meta.url)), 'utf8')
      .replaceAll(/\/\*[\s\S]*?\*\//g, '')
      .replaceAll(/\/\/.*$/gm, '');
    const uses = source.split('\n').filter((line) => /\baccumulator\b/.test(line));
    expect(uses.some((line) => /accumulator\s*[<>]|[<>]=?\s*accumulator|accumulator\s*[=!]==/.test(line))).toBe(false);
    expect(source).toContain('constants.signalGain * accumulator');
    expect(source.match(/signalGain/g)).toHaveLength(1);
  });

  /*
   * Validation property 17: being seen never ends an attack run. A run the defender is certain to see
   * still lands an impact wherever the reaction time exceeds every remaining window.
   */
  it('keeps a strictly positive impact probability when the defender always sees and never arrives', () => {
    const certain = chain({ constants: { ...CONSTANTS, detectionScale: 1000 } });
    const { result } = evaluate(certain, states, { reactionTimeHours: 100000 });
    expect(result.unseen).toBeCloseTo(0, 6);
    expect(result.eviction).toBe(0);
    expect(result.outcomes.impactDetected).toBeGreaterThan(0);
  });

  /*
   * The remaining window is read from the position of the first detection, so a detection landing
   * at the objective buys nothing: there is no attack run left to react in.
   */
  it('buys nothing with a detection at the terminal obstacle', () => {
    const terminalOnly = chain({
      controls: [{ capabilityExternalId: 'EDR', preventTechniqueExternalIds: [], detectTechniqueExternalIds: ['X5'] }],
    });
    const { result } = evaluate(terminalOnly, [{ prevent: 0, detect: 0.9 }], { reactionTimeHours: 0.01 });
    const terminal = result.firstDetectionAtObstacle[result.firstDetectionAtObstacle.length - 1];
    expect(terminal).toBeGreaterThan(0);
    expect(result.eviction).toBeCloseTo(
      (result.firstDetectionAtObstacle.slice(0, -1).reduce((sum, share) => sum + share, result.firstDetectionAtAnchoring))
      * (1 - result.anchoring),
      12,
    );
  });

  /*
   * The undetected arm reads the joint "cleared everything and never seen" quantity. Rebuilding it
   * from the marginal detection and the marginal reach pulls in the blocked-and-seen paths, which
   * have no business in a conditional on success.
   */
  it('reads the joint quantity for the undetected arm', () => {
    const { result } = evaluate(chain(), states);
    const postDetection = 1 - Math.exp(-CONSTANTS.postDetectionRate * result.detectPosture);
    expect(result.outcomes.impactUndetected).toBeCloseTo(
      result.reachedUnseen * (1 - postDetection) * (1 - result.eviction),
      12,
    );
    expect(result.reachedUnseen).toBeLessThanOrEqual(result.reach);
  });

  /* Section 6: an obstacle the repertoire cannot play stops the attack run and is named. */
  it('names the obstacle a repertoire cannot play', () => {
    const compiled = compileAttackRunLaw(chain({
      repertoire: chain().repertoire.filter((candidate) => !candidate.tacticExternalIds.includes('TA0007')),
    }));
    expect(compiled.unplayableObstacleKeys).toEqual(['knowledge']);
    expect(evaluate(chain({
      repertoire: chain().repertoire.filter((candidate) => !candidate.tacticExternalIds.includes('TA0007')),
    }), states).result.reach).toBe(0);
  });

  /*
   * The detection of an obstacle is resolved once for that obstacle and not replayed per visit: the
   * visits are different assets, but the rule is the same rule. Raising the visit quota therefore
   * moves the reach and leaves the obstacle's own detection exactly where it was.
   */
  it('resolves an obstacle detection once however many assets are visited', () => {
    const few = evaluate(chain({ constants: { ...CONSTANTS, visitQuota: 2 } }), states);
    const many = evaluate(chain({ constants: { ...CONSTANTS, visitQuota: 20 } }), states);
    expect(many.diagnostics[1].clear).toBeGreaterThan(few.diagnostics[1].clear);
    expect(many.diagnostics[1].ownDetection).toBe(few.diagnostics[1].ownDetection);
  });

  /* The door reads the whole estate, so the visits of the obstacles after it are not its business. */
  it('leaves the door where it was whatever the visit quota', () => {
    const few = evaluate(chain({ constants: { ...CONSTANTS, visitQuota: 2 } }), states);
    const many = evaluate(chain({ constants: { ...CONSTANTS, visitQuota: 20 } }), states);
    expect(many.diagnostics[0].clear).toBe(few.diagnostics[0].clear);
    expect(many.diagnostics[0].ownDetection).toBe(few.diagnostics[0].ownDetection);
  });
});

describe('the chains an attack can take', () => {
  const impactRepertoire = [
    technique('X1', ['TA0001'], ['host']),
    technique('X2', ['TA0006'], ['host']),
    technique('X3', ['TA0007'], ['host']),
    technique('X4', ['TA0008'], ['host']),
    technique('X5', ['TA0040'], ['host']),
    technique('E1', ['TA0002'], ['host']),
  ];
  const impactChain = (over: Partial<AttackRunLawInputs> = {}): AttackRunLawInputs => law({
    repertoire: impactRepertoire,
    groups: [group('fleet', 'host', 20, { exposure: 'internet_facing' })],
    ...over,
  });
  const keysOf = (compiled: ReturnType<typeof compileAttackRunLaw>): Array<string> => compiled.obstacles.map((obstacle) => obstacle.key);
  const WITHOUT_DOOR = { key: 'outside_perimeter', share: 1, techniqueExternalIds: ['T1498', 'T1499'] };
  const flood = (prevalence?: number, families: AttackRunTechnique['families'] = ['host']): Array<AttackRunTechnique> => [
    technique('T1498', ['TA0040'], families, false, prevalence),
    technique('T1499', ['TA0040'], families, false, 0),
  ];

  describe('the direct chain', () => {
    it('is the door and the terminal tactic for an impact', () => {
      const compiled = compileAttackRunLaw(impactChain());
      expect(keysOf(compiled)).toEqual(['foothold', 'credentials', 'knowledge', 'deep_access', 'TA0040']);
      expect(compiled.chains.direct).toEqual([0, keysOf(compiled).indexOf('TA0040')]);
    });

    it('is the door, the gathered data and the exfiltration for an exfiltration', () => {
      const compiled = compileAttackRunLaw(impactChain({
        terminalTacticExternalId: 'TA0010',
        repertoire: [...impactRepertoire, technique('X6', ['TA0009'], ['host']), technique('X7', ['TA0010'], ['host'])],
      }));
      const keys = keysOf(compiled);
      expect(compiled.chains.direct).toEqual([0, keys.indexOf('gathered_data'), keys.indexOf('TA0010')]);
    });

    it('reuses the compiled obstacles of the long chain', () => {
      const compiled = compileAttackRunLaw(impactChain());
      const [door, terminal] = compiled.chains.direct!.map((index) => compiled.obstacles[index]);
      expect(door).toBe(compiled.obstacles[0]);
      expect(terminal).toBe(compiled.obstacles[compiled.obstacles.length - 1]);
    });
  });

  describe('the chain without initial access', () => {
    it('is absent when no input is given', () => {
      expect(compileAttackRunLaw(impactChain({ repertoire: [...impactRepertoire, ...flood(0.4)] })).chains.withoutInitialAccess).toBeNull();
    });

    it('is absent for a share of zero', () => {
      const compiled = compileAttackRunLaw(impactChain({
        repertoire: [...impactRepertoire, ...flood(0.4)],
        withoutInitialAccess: { ...WITHOUT_DOOR, share: 0 },
      }));
      expect(compiled.chains.withoutInitialAccess).toBeNull();
    });

    it('plays only the path techniques the class holds, renormalised among them', () => {
      const compiled = compileAttackRunLaw(impactChain({
        repertoire: [...impactRepertoire, ...flood(0.4)],
        withoutInitialAccess: { ...WITHOUT_DOOR, share: 0.3 },
      }));
      const { obstacle, share } = compiled.chains.withoutInitialAccess!;
      const played = obstacle.techniques.map((index) => compiled.inputs.repertoire[index].externalId);
      expect(share).toBe(0.3);
      expect(obstacle.key).toBe('TA0040');
      expect(played).toEqual(['T1498']);
      expect(obstacle.groups.map((entry) => entry.choice)).toEqual([[1]]);
      expect(obstacle.unplayable).toBe(false);
    });

    it('splits the attempts equally when the class holds none of the path techniques', () => {
      const compiled = compileAttackRunLaw(impactChain({
        repertoire: [...impactRepertoire, ...flood(0)],
        withoutInitialAccess: WITHOUT_DOOR,
      }));
      const { obstacle } = compiled.chains.withoutInitialAccess!;
      expect(obstacle.groups.map((entry) => entry.choice)).toEqual([[0.5, 0.5]]);
      expect(obstacle.unplayable).toBe(false);
    });

    it('skips a held technique the estate cannot play and falls back on the ones it can', () => {
      const compiled = compileAttackRunLaw(impactChain({
        repertoire: [
          ...impactRepertoire,
          technique('T1498', ['TA0040'], ['network_device'], false, 0.4),
          technique('T1499', ['TA0040'], ['host'], false, 0),
        ],
        withoutInitialAccess: WITHOUT_DOOR,
      }));
      const { obstacle } = compiled.chains.withoutInitialAccess!;
      expect(obstacle.techniques.map((index) => compiled.inputs.repertoire[index].externalId)).toEqual(['T1499']);
      expect(obstacle.groups.map((entry) => entry.choice)).toEqual([[1]]);
    });

    it('is unplayable when no family of the estate carries a path technique', () => {
      const compiled = compileAttackRunLaw(impactChain({
        repertoire: [...impactRepertoire, ...flood(0.4, ['network_device'])],
        withoutInitialAccess: WITHOUT_DOOR,
      }));
      expect(compiled.chains.withoutInitialAccess!.obstacle.unplayable).toBe(true);
    });

    it('plays a path technique on the families its path declares, uncontested ones included', () => {
      const repertoire = [
        ...impactRepertoire,
        { ...technique('T1498', ['TA0040'], ['host'], false, 0.4), pathFamilies: ['host', 'web_application'] as const },
      ];
      const compiled = compileAttackRunLaw(impactChain({
        repertoire,
        groups: [group('fleet', 'host', 20, { exposure: 'internet_facing' }), group('sites', 'web_application', 4, { exposure: 'internet_facing' })],
        withoutInitialAccess: { key: 'outside_perimeter', share: 1, techniqueExternalIds: ['T1498'] },
      }));
      const { obstacle } = compiled.chains.withoutInitialAccess!;
      const terminal = compiled.obstacles[compiled.obstacles.length - 1];
      expect(obstacle.groups.map((entry) => entry.groupIndex)).toEqual([0, 1]);
      expect(terminal.groups.map((entry) => entry.groupIndex)).toEqual([0]);
    });

    describe('the exposure of the groups it plays on', () => {
      const flooded = (groups: ReadonlyArray<AttackRunGroup>, settings: Partial<Pick<AttackRunLawInputs, 'unknownExposureCountsAs'>> = {}) => compileAttackRunLaw(impactChain({
        repertoire: [...impactRepertoire, ...flood(0.4)],
        groups,
        withoutInitialAccess: WITHOUT_DOOR,
        ...settings,
      })).chains.withoutInitialAccess!.obstacle;

      it('plays T1498 and T1499 on an internet-facing group and not on an internal one', () => {
        expect(flooded([group('edge', 'host', 3, { exposure: 'internet_facing' })]).unplayable).toBe(false);
        expect(flooded([group('lan', 'host', 3, { exposure: 'internal' })]).unplayable).toBe(true);
      });

      it('lets the tenant setting decide for an unknown exposure', () => {
        const unknown = [group('mixed', 'host', 3, { exposure: 'unknown' })];
        expect(flooded(unknown, { unknownExposureCountsAs: 'internal' }).unplayable).toBe(true);
        expect(flooded(unknown, { unknownExposureCountsAs: 'internet_facing' }).unplayable).toBe(false);
      });

      it('keeps only the exposed groups in the obstacle', () => {
        const obstacle = flooded([
          group('lan', 'host', 20, { exposure: 'internal' }),
          group('edge', 'host', 2, { exposure: 'internet_facing' }),
        ]);
        expect(obstacle.groups.map((entry) => entry.groupIndex)).toEqual([1]);
        expect(obstacle.groups[0].weightShare).toBe(1);
      });

      it('plays T1657 on a group whatever its exposure', () => {
        for (const exposure of ['internal', 'internet_facing', 'unknown'] as const) {
          const compiled = compileAttackRunLaw(impactChain({
            repertoire: [...impactRepertoire, technique('T1657', ['TA0040'], ['host'], false, 0)],
            groups: [group('fleet', 'host', 3, { exposure })],
            withoutInitialAccess: { key: 'access_held_or_outside_perimeter', share: 0.05, techniqueExternalIds: ['T1657'] },
          }));
          expect(compiled.chains.withoutInitialAccess!.obstacle.unplayable).toBe(false);
        }
      });

      it('leaves the techniques of the long chain on every group', () => {
        const compiled = compileAttackRunLaw(impactChain({
          repertoire: [...impactRepertoire, ...flood(0)],
          groups: [group('lan', 'host', 20, { exposure: 'internal' })],
          withoutInitialAccess: WITHOUT_DOOR,
        }));
        const terminal = compiled.obstacles[compiled.obstacles.length - 1];
        expect(terminal.groups.map((entry) => entry.groupIndex)).toEqual([0]);
      });
    });

    it('stays unplayable at an obstacle whose tactic the path techniques do not serve', () => {
      const compiled = compileAttackRunLaw(impactChain({
        terminalTacticExternalId: 'TA0010',
        repertoire: [...impactRepertoire, technique('X6', ['TA0009'], ['host']), technique('X7', ['TA0010'], ['host']), ...flood(0.4)],
        withoutInitialAccess: WITHOUT_DOOR,
      }));
      expect(compiled.chains.withoutInitialAccess!.obstacle.unplayable).toBe(true);
    });
  });

  describe('a technique held at prevalence zero', () => {
    it('changes nothing in the long chain, the door layers or the unplayable obstacles', () => {
      const without = compileAttackRunLaw(impactChain());
      const withPath = compileAttackRunLaw(impactChain({
        repertoire: [...impactRepertoire, ...flood(0)],
        withoutInitialAccess: WITHOUT_DOOR,
      }));
      expect(withPath.obstacles).toEqual(without.obstacles);
      expect(withPath.unplayableObstacleKeys).toEqual(without.unplayableObstacleKeys);
      expect(withPath.door.layers).toEqual(without.door.layers);
      expect(withPath.chains.direct).toEqual(without.chains.direct);
      for (const name of ['tooling', 'discretion', 'sabotage', 'persistence', 'channel'] as const) {
        expect(withPath.functions[name]).toEqual(without.functions[name]);
      }
    });

    it('leaves the terminal obstacle unplayable when it is all the repertoire holds there', () => {
      const withoutTerminal = impactRepertoire.filter((candidate) => candidate.externalId !== 'X5');
      const compiled = compileAttackRunLaw(impactChain({
        repertoire: [...withoutTerminal, ...flood(0)],
        withoutInitialAccess: { ...WITHOUT_DOOR, share: 0.05 },
      }));
      expect(compiled.unplayableObstacleKeys).toEqual(['TA0040']);
      expect(compiled.chains.withoutInitialAccess!.obstacle.unplayable).toBe(false);
    });
  });
});

describe('forgoing a CVE after the door', () => {
  const repertoire = [
    technique('X1', ['TA0001'], ['host']),
    technique('X2', ['TA0006'], ['host']),
    technique('X3', ['TA0007'], ['host']),
    technique('X4', ['TA0008'], ['host']),
    technique('X5', ['TA0040'], ['host']),
  ];
  const CVES = [{ cveId: 'c1', threat: 0.5, priced: true }, { cveId: 'c2', threat: 0.5, priced: true }];
  const FULL = [{ techniqueExternalId: 'X2', share: 0.6 }, { techniqueExternalId: 'X5', share: 0.5 }];
  const baseGroup = group('hosts', 'host', 10, { exposure: 'internet_facing' });

  const doorWith = (cves: ReadonlyArray<{ cveId: string, threat: number, priced: boolean }>, openings: ReadonlyArray<ReadonlyArray<number>>): DoorEstate => ({
    ...impliedDoor(repertoire, [baseGroup]),
    cves,
    assets: [{
      family: 0,
      openings: openings.map(([cve, opening]) => ({ cve, technique: 0, opening: opening / 10 })),
      target: false,
    }],
  });

  const lawA = compileAttackRunLaw(law({
    repertoire,
    groups: [{ ...baseGroup, cveFloors: FULL }],
    door: doorWith(CVES, [[0, 5], [1, 4]]),
  }));
  const lawB = compileAttackRunLaw(law({
    repertoire,
    groups: [{ ...baseGroup, cveFloors: FULL }],
    door: doorWith([CVES[0]], [[0, 5]]),
  }));

  const worldOf = (compiled: ReturnType<typeof compileAttackRunLaw>, cveUniform: ReadonlyArray<number>) => prepareWorld(compiled, {
    deployed: [],
    preventEfficacy: [],
    detectEfficacy: [],
    knockoutUniform: [],
    reactionTimeHours: { min: 8, likely: 8, max: 8 },
    cveUniform: Float64Array.from(cveUniform),
    familyUniform: new Float64Array(1).fill(1),
  });

  const closeTo = (actual: AttackRunEvaluation, expected: AttackRunEvaluation): void => {
    for (const key of ['blocked', 'evicted', 'impactDetected', 'impactUndetected'] as const) {
      expect(actual.outcomes[key], key).toBeCloseTo(expected.outcomes[key], 12);
    }
    for (const key of ['stoppedAtInitialAccess', 'direct', 'long', 'withoutInitialAccess'] as const) {
      expect(actual.paths[key], key).toBeCloseTo(expected.paths[key], 12);
    }
  };

  it('evaluates as the law whose door lacks it, the floors kept, where its exploit is drawn', () => {
    const uniforms = [0.1, 0.1];
    const forgone = evaluateAttackRun(worldOf(lawA, uniforms), undefined, undefined, 1);
    closeTo(forgone, evaluateAttackRun(worldOf(lawB, [uniforms[0]])));
    expect(forgone.outcomes.blocked).not.toBe(evaluateAttackRun(worldOf(lawA, uniforms)).outcomes.blocked);
  });

  it('answers the baseline exactly where its exploit is not drawn', () => {
    const uniforms = [0.1, 0.9];
    expect(evaluateAttackRun(worldOf(lawA, uniforms), undefined, undefined, 1)).toStrictEqual(evaluateAttackRun(worldOf(lawA, uniforms)));
  });
});
