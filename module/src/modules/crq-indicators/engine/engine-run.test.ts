import { describe, expect, it, vi } from 'vitest';
import type { AttackRunConstants, AttackRunGroup, AttackRunTechnique } from './attack-run-law';
import type { DoorEstate } from './attack-run-door';
import type { PertRange } from './attack-run-worlds';
import type {
  AttackRunControlLever,
  AttackRunControlValue,
  AttackRunLeverDimension,
  EngineRunActor,
  EngineRunBasket,
  EngineRunBasketDifference,
  EngineRunControl,
  EngineRunCveGroups,
  EngineRunInputs,
  EngineRunPlan,
  EngineRunResult,
} from './engine-run';
import type * as AttackRunEvaluation from './attack-run-evaluation';
import type * as AttackRunDoor from './attack-run-door';
import type { EstateCollapseInput, EstateCountRow, EstateRouteRow } from '../attack-run-estate';
import { prepareCollapse } from '../attack-run-estate';
import { createEngineRun, spreadOf } from './engine-run';
import { pricedFraction } from './priced-fraction';
import { ATTACK_RUN_CALIBRATION_VINTAGE, DETECTED_MAGNITUDE_FACTOR, RESPONSE_COST_FRACTION } from './attack-run-constants';

const evaluations = vi.hoisted(() => ({ count: 0, doorPasses: 0 }));

vi.mock('./attack-run-door', async (importOriginal) => {
  const actual = await importOriginal<typeof AttackRunDoor>();
  return {
    ...actual,
    doorPassByTechnique: (...args: Parameters<typeof actual.doorPassByTechnique>) => {
      evaluations.doorPasses += 1;
      return actual.doorPassByTechnique(...args);
    },
  };
});

vi.mock('./attack-run-evaluation', async (importOriginal) => {
  const actual = await importOriginal<typeof AttackRunEvaluation>();
  return {
    ...actual,
    evaluateAttackRun: (...args: Parameters<typeof actual.evaluateAttackRun>) => {
      evaluations.count += 1;
      return actual.evaluateAttackRun(...args);
    },
  };
});

/**
 * The three answers the product owes, asserted on a run rather than on one world: a value per
 * control on each of its three levers, a signed value per technique, and the outcome split the
 * euros are priced from.
 */

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

const technique = (
  externalId: string,
  tacticExternalIds: ReadonlyArray<string>,
  families: AttackRunTechnique['families'] = ['host'],
): AttackRunTechnique => ({ externalId, tacticExternalIds, families });

const REPERTOIRE: ReadonlyArray<AttackRunTechnique> = [
  technique('X1', ['TA0001']),
  technique('X2', ['TA0006']),
  technique('X3', ['TA0007']),
  technique('X4', ['TA0008']),
  technique('X5', ['TA0040']),
  technique('E1', ['TA0002']),
  technique('S1', ['TA0005']),
  technique('P1', ['TA0003']),
  technique('C1', ['TA0011']),
  technique('T1553', ['TA0112']),
];

const GROUPS: ReadonlyArray<AttackRunGroup> = [
  { id: 'jewels', family: 'host', assets: 8, exposure: 'internal', criticality: 'high', matchedByScenarioGroup: true },
  { id: 'desktops', family: 'host', assets: 200, exposure: 'internal', criticality: 'low', matchedByScenarioGroup: false },
];

/** Several independent flaws, so the share of worlds that open the door is spread rather than all or nothing. */
const DOOR: DoorEstate = {
  techniques: ['X1'],
  families: ['host'],
  cves: Array.from({ length: 6 }, (_, index) => ({ cveId: `CVE-2024-000${index}`, threat: 0.5, priced: true })),
  assets: Array.from({ length: 6 }, (_, index) => ({ family: 0, openings: [{ cve: index, technique: 0, opening: 0.6 }], target: false })),
  applicable: [Float64Array.from([20])],
  targetApplicable: [Float64Array.from([0])],
  phishing: null,
};

/**
 * A door the draws cannot move: the only asset carries a flaw whose exploit is certain, and it is
 * also the only asset the floor could expose. A run of one world then prices it exactly as a run of
 * many does, which is what an enumeration of the deployments needs.
 */
const CERTAIN_DOOR: DoorEstate = {
  techniques: ['X1'],
  families: ['host'],
  cves: [{ cveId: 'CVE-2024-0001', threat: 1, priced: true }],
  assets: [{ family: 0, openings: [{ cve: 0, technique: 0, opening: 1 }], target: false }],
  applicable: [Float64Array.from([1])],
  targetApplicable: [Float64Array.from([0])],
  phishing: null,
};

const control = (
  capabilityExternalId: string,
  prevent: ReadonlyArray<string>,
  detect: ReadonlyArray<string>,
  over: Partial<EngineRunControl> = {},
): EngineRunControl => ({
  controlId: `id-${capabilityExternalId}`,
  capabilityExternalId,
  strengthRung: 'L2',
  coverageBucket: 'L2',
  preventTechniqueExternalIds: prevent,
  detectTechniqueExternalIds: detect,
  ...over,
});

const actor = (over: Partial<EngineRunActor> = {}): EngineRunActor => ({
  key: 'actor-1',
  name: 'Ransomware crew',
  actorClass: 'ransomware_operator',
  knobs: { capability: 0.7, stealth: 0.4, patience: 0.2, attackRunDays: 5 },
  share: 1,
  repertoire: REPERTOIRE,
  groups: GROUPS,
  ...over,
});

const inputsOf = (over: Partial<EngineRunInputs> = {}): EngineRunInputs => ({
  terminalTacticExternalId: 'TA0040',
  controls: [
    control('EDR', ['X1', 'X4', 'E1'], ['X1', 'X3', 'X4', 'X5']),
    control('PAM', ['X2'], ['X2']),
    control('NGFW', ['X4'], ['X4']),
  ],
  actors: [actor()],
  tef: { min: 0.5, likely: 1, max: 3 },
  lossDrivers: [{ min: 100000, likely: 400000, max: 2000000 }],
  reactionTimeHours: { min: 0.5, likely: 8, max: 96 },
  constants: CONSTANTS,
  door: DOOR,
  phishing: { declaredSusceptibility: null },
  unknownExposureCountsAs: 'internal',
  unknownCriticalityCountsAs: 'low',
  worlds: 200,
  seed: 'run',
  ...over,
});

const leverOf = (value: AttackRunControlValue, dimension: AttackRunLeverDimension): AttackRunControlLever | undefined =>
  value.levers.find((lever) => lever.dimension === dimension);

const runAll = (inputs: EngineRunInputs): EngineRunResult => {
  const run = createEngineRun(inputs);
  while (!run.done()) {
    run.advance(8);
  }
  return run.result();
};

describe('the run', () => {
  it('prices the outcomes in the order the specification asserts', () => {
    expect(RESPONSE_COST_FRACTION).toBeGreaterThan(0);
    expect(RESPONSE_COST_FRACTION).toBeLessThan(DETECTED_MAGNITUDE_FACTOR);
    expect(DETECTED_MAGNITUDE_FACTOR).toBeLessThan(1);
  });

  it('splits the outcomes into a partition and prices the loss events from it', () => {
    const result = runAll(inputsOf());
    const { blocked, evicted, impactDetected, impactUndetected } = result.outcomes;
    expect(blocked + evicted + impactDetected + impactUndetected).toBeCloseTo(1, 12);
    expect(result.lef.mean).toBeGreaterThan(0);
    expect(result.ale.mean).toBeGreaterThan(0);
    expect(result.ale.p5).toBeLessThan(result.ale.p95);
    expect(result.calibrationVintage).toBe(ATTACK_RUN_CALIBRATION_VINTAGE);
  });

  it('reads each percentile at the floor of its rank over the sorted worlds', () => {
    const hundred = Float64Array.from({ length: 100 }, (_, index) => (index * 37) % 100);
    expect(spreadOf(hundred)).toEqual({ mean: 49.5, p5: 5, p10: 10, p50: 50, p90: 90, p95: 95 });

    const seven = Float64Array.from([60, 10, 40, 0, 30, 50, 20]);
    expect(spreadOf(seven)).toEqual({ mean: 30, p5: 0, p10: 0, p50: 30, p90: 60, p95: 60 });
  });

  it('reads the p10 to p90 band inside the p5 to p95 tails, around the median', () => {
    const result = runAll(inputsOf({ controls: [control('EDR', ['X1', 'X4', 'E1'], [])] }));
    const spreads = [
      result.lef,
      result.ale,
      ...result.controlValues.flatMap((value) => value.levers.map((lever) => lever.aleReduction)),
    ];
    for (const { p5, p10, p50, p90, p95 } of spreads) {
      expect(p5).toBeLessThanOrEqual(p10);
      expect(p10).toBeLessThanOrEqual(p50);
      expect(p50).toBeLessThanOrEqual(p90);
      expect(p90).toBeLessThanOrEqual(p95);
    }
    expect(result.ale.p10).toBeLessThan(result.ale.p90);
    expect(result.lef.p10).toBeLessThan(result.lef.p90);
  });

  it('replays identically on the same seed and moves on another', () => {
    expect(runAll(inputsOf())).toEqual(runAll(inputsOf()));
    expect(runAll(inputsOf({ seed: 'other' })).ale.mean).not.toBe(runAll(inputsOf()).ale.mean);
  });

  it('answers the same whether it pauses between worlds or at every step inside one', () => {
    const inputs = inputsOf({
      worlds: 24,
      plans: [{ planId: 'fw', moves: [{ controlId: 'id-NGFW', targetStrengthRung: 'L3', targetCoverageBucket: 'L3' }] }],
    });
    const stepped = createEngineRun(inputs);
    let pauses = 0;
    while (!stepped.done()) {
      stepped.advanceUntil(() => true);
      pauses += 1;
    }
    expect(pauses).toBeGreaterThan(inputs.worlds * 2);
    expect(stepped.result()).toEqual(runAll(inputs));
  });

  /*
   * Validation property 5. A control whose covered techniques do not intersect the actor's
   * repertoire is worth exactly zero, and the run says why: an unexplained zero next to a control
   * the tenant paid for reads as a defect of the engine rather than as a fact about the actor.
   */
  it('reports an actor-scoped zero rather than a silent one', () => {
    const result = runAll(inputsOf({
      controls: [
        control('EDR', ['X1'], ['X1']),
        control('PAM', ['Y9'], ['Y9']),
      ],
    }));
    const pam = result.controlValues.find((value) => value.capabilityExternalId === 'PAM')!;
    expect(leverOf(pam, 'coverage')!.aleReduction.mean).toBe(0);
    expect(leverOf(pam, 'coverage')!.zeroReason).toBe('actor-repertoire');
    const edr = result.controlValues.find((value) => value.capabilityExternalId === 'EDR')!;
    expect(leverOf(edr, 'coverage')!.aleReduction.mean).toBeGreaterThan(0);
    expect(leverOf(edr, 'coverage')!.zeroReason).toBeNull();
  });

  /* A lever with nowhere left to go is reported as such, not as an unexplained zero either. */
  it('names the levers that are already at their ceiling', () => {
    const result = runAll(inputsOf({
      controls: [control('EDR', ['X1'], ['X1'], { strengthRung: 'L3', coverageBucket: 'L3' })],
    }));
    const [edr] = result.controlValues;
    expect(leverOf(edr, 'strength')!.zeroReason).toBe('already-maximal');
    expect(leverOf(edr, 'coverage')!.zeroReason).toBe('already-maximal');
    expect(leverOf(edr, 'strength')!.aleReduction.mean).toBe(0);
    expect(leverOf(edr, 'coverage')!.aleReduction.mean).toBe(0);
  });

  /*
   * A control the tenant has not declared is the one it is most likely to be about to buy, and it
   * is exactly where the three single-axis levers all read zero: it protects no asset, so raising a
   * rung changes nothing, and it has no strength, so widening a coverage changes nothing either.
   * The anchor step is the only move that answers.
   */
  it('asks an undeclared control the only question it can answer', () => {
    const result = runAll(inputsOf({
      controls: [
        control('EDR', ['X1', 'X4'], ['X1', 'X4'], { strengthRung: 'L0', coverageBucket: 'L0' }),
        control('PAM', ['X2'], ['X2']),
      ],
    }));
    const [edr] = result.controlValues;
    expect(edr.levers.map((lever) => lever.dimension)).toEqual(['deploy']);
    const deploy = leverOf(edr, 'deploy')!;
    expect(deploy.aleReduction.mean).toBeGreaterThan(0);
    expect(deploy.upgradedStrengthRung).toBe('L1');
    expect(deploy.upgradedCoverageBucket).toBe('L1');
    expect(deploy.zeroReason).toBeNull();
    // A declared control is never asked the anchor step: it is already past it.
    expect(result.controlValues[1].levers.map((lever) => lever.dimension)).toEqual(['strength', 'coverage']);
  });

  /*
   * Validation property 4 on the two levers that have somewhere to go: strengthening or widening a
   * control never raises the ALE. The draws are monotone in the declaration world by world, so this
   * holds on the spread and not only on the mean.
   */
  it('never raises the ALE when a control is strengthened or widened', () => {
    const result = runAll(inputsOf({ controls: [control('EDR', ['X1', 'X4', 'E1'], []), control('PAM', ['X2'], [])] }));
    for (const value of result.controlValues) {
      for (const lever of value.levers) {
        expect(lever.aleReduction.p5, `${value.capabilityExternalId} ${lever.dimension}`).toBeGreaterThanOrEqual(0);
      }
      expect(leverOf(value, 'strength')!.aleReduction.mean).toBeGreaterThan(0);
    }
  });

  /*
   * The same property on the function that has to work hardest for it. Behind a prevention that
   * already holds, a sensor buys almost nothing, and an eviction arm counting the attack runs that
   * prevention was going to stop anyway would make it buy strictly less than nothing.
   */
  it('never raises the ALE when a detect-only control is improved behind a strong prevention', () => {
    const result = runAll(inputsOf({
      controls: [
        control('NGFW', ['X1', 'X2', 'X3', 'X4', 'X5'], [], { strengthRung: 'L3', coverageBucket: 'L3' }),
        control('PAM', ['X1', 'X2', 'X3', 'X4', 'X5'], [], { strengthRung: 'L3', coverageBucket: 'L3' }),
        control('EDR', [], ['X1', 'X2', 'X3', 'X4', 'X5']),
      ],
    }));
    const edr = result.controlValues.find((value) => value.capabilityExternalId === 'EDR')!;
    expect(result.outcomes.blocked).toBeGreaterThan(0.99);
    expect(leverOf(edr, 'strength')!.aleReduction.mean).toBeGreaterThanOrEqual(0);
    expect(leverOf(edr, 'coverage')!.aleReduction.mean).toBeGreaterThanOrEqual(0);
    expect(leverOf(edr, 'coverage')!.zeroReason).toBeNull();
  });

  /*
   * Validation property 28: a posture that contests the impairment technique in prevention keeps
   * the capabilities it protects standing more often, so its ALE is strictly lower than the same
   * posture without those edges.
   */
  it('rewards a posture covering Defense Impairment in prevention', () => {
    const without = runAll(inputsOf({ controls: [control('EDR', ['X1', 'X4'], ['X1', 'X4'])] }));
    const with_ = runAll(inputsOf({ controls: [control('EDR', ['X1', 'X4', 'T1553'], ['X1', 'X4'])] }));
    expect(with_.ale.mean).toBeLessThan(without.ale.mean);
  });

  /*
   * Section 10: an interdicted technique keeps its place and its share of the quota, so even at a
   * node crowded above the quota, where one more technique lowers every other one's chance of being
   * played, neither reading comes out negative.
   */
  it('prices every technique by what preventing and what detecting it are worth', () => {
    const crowding = Array.from({ length: 6 }, (_, index) => technique(`D${index}`, ['TA0006']));
    const result = runAll(inputsOf({ actors: [actor({ repertoire: [...REPERTOIRE, ...crowding] })] }));
    const values = result.techniqueValues;
    const floor = -1e-9 * result.ale.mean;
    expect(values).toHaveLength(REPERTOIRE.length + crowding.length);
    expect(values.every((value) => value.preventValue >= floor && value.detectValue >= floor)).toBe(true);
    expect(values.find((value) => value.techniqueExternalId === 'X5')!.preventValue).toBeGreaterThan(0);
  });

  /*
   * Every actor of the mixture is enumerated inside each world rather than sampled, so the shares
   * decompose the run's own outcome split exactly.
   */
  it('decomposes the outcome split over the mixture exactly', () => {
    const result = runAll(inputsOf({
      actors: [
        actor({ key: 'a', share: 0.7 }),
        actor({ key: 'b', share: 0.3, actorClass: 'state_sponsored', knobs: { capability: 0.9, stealth: 0.85, patience: 0.9, attackRunDays: 90 } }),
      ],
    }));
    const blocked = result.actors.reduce((sum, entry) => sum + entry.share * entry.outcomes.blocked, 0);
    expect(result.outcomes.blocked).toBeCloseTo(blocked, 12);
    expect(result.actors.map((entry) => entry.key)).toEqual(['a', 'b']);
  });

  it('mixes the paths into shares summing to 1, each actor weighing by its share', () => {
    const result = runAll(inputsOf({
      actors: [
        actor({ key: 'a', share: 0.7 }),
        actor({ key: 'b', share: 0.3, actorClass: 'state_sponsored', knobs: { capability: 0.9, stealth: 0.85, patience: 0.9, attackRunDays: 90 } }),
      ],
    }));
    const { stoppedAtInitialAccess, direct, long, withoutInitialAccess } = result.paths;
    expect(stoppedAtInitialAccess + direct + long + withoutInitialAccess).toBeCloseTo(1, 12);
    const longOf = result.actors.reduce((sum, entry) => sum + entry.share * entry.paths.long, 0);
    expect(long).toBeCloseTo(longOf, 12);
    expect(result.actors[0].paths.stoppedAtInitialAccess + result.actors[0].paths.long).toBeCloseTo(1, 12);
  });

  it('weighs an actor of share 0 nothing in the paths', () => {
    const blind = actor({ key: 'blind', share: 0, repertoire: REPERTOIRE.filter((candidate) => candidate.externalId !== 'X1') });
    const result = runAll(inputsOf({ door: CERTAIN_DOOR, controls: [], actors: [actor({ key: 'sees', share: 1 }), blind] }));
    expect(result.actors[1].paths.stoppedAtInitialAccess).toBe(1);
    expect(result.paths.stoppedAtInitialAccess).toBeCloseTo(result.actors[0].paths.stoppedAtInitialAccess, 12);
    expect(result.paths.long).toBeCloseTo(result.actors[0].paths.long, 12);
  });

  it('sends a fallen target down the direct path, and nothing down it without one', () => {
    const targeted: DoorEstate = {
      ...CERTAIN_DOOR,
      assets: CERTAIN_DOOR.assets.map((asset) => ({ ...asset, target: true })),
      targetApplicable: [Float64Array.from([1])],
      phishing: null,
    };
    const withTarget = runAll(inputsOf({ door: targeted, controls: [] }));
    expect(withTarget.paths.direct).toBeCloseTo(0.98, 12);
    expect(withTarget.paths.long).toBe(0);
    expect(withTarget.paths.stoppedAtInitialAccess).toBeCloseTo(0.02, 12);
    const withoutTarget = runAll(inputsOf({ door: CERTAIN_DOOR, controls: [] }));
    expect(withoutTarget.paths.direct).toBe(0);
    expect(withoutTarget.paths.long).toBeCloseTo(0.98, 12);
  });

  it('prices no technique held by nobody, which only the path around the door plays', () => {
    const flood = { ...technique('Z1', ['TA0040']), prevalence: 0 };
    const result = runAll(inputsOf({ actors: [actor({ repertoire: [...REPERTOIRE, flood] })] }));
    expect(result.techniqueValues.map((value) => value.techniqueExternalId)).toEqual(REPERTOIRE.map((entry) => entry.externalId));
  });

  describe('the techniques of the path around the door', () => {
    const FLOOD = [{ ...technique('T1498', ['TA0040']), prevalence: 0 }, { ...technique('T1499', ['TA0040']), prevalence: 0 }];
    const EDGE: ReadonlyArray<AttackRunGroup> = [{ ...GROUPS[0], exposure: 'internet_facing' }];
    const aroundDoor = (share: number, groups: ReadonlyArray<AttackRunGroup> = EDGE) => runAll(inputsOf({
      controls: [control('EDR', ['T1498', 'T1499'], ['T1498', 'T1499'])],
      actors: [actor({ repertoire: [...REPERTOIRE, ...FLOOD], groups })],
      withoutInitialAccess: { key: 'outside_perimeter', share, techniqueExternalIds: ['T1498', 'T1499'] },
    }));
    const valueOf = (result: EngineRunResult, externalId: string) => result.techniqueValues.find((value) => value.techniqueExternalId === externalId);

    it('prices the techniques it plays although nobody holds them, with a positive prevent value', () => {
      const result = aroundDoor(1);
      expect(result.techniqueValues.map((value) => value.techniqueExternalId)).toEqual([...REPERTOIRE, ...FLOOD].map((entry) => entry.externalId));
      expect(valueOf(result, 'T1498')!.preventValue).toBeGreaterThan(0);
      expect(valueOf(result, 'T1499')!.preventValue).toBeGreaterThan(0);
      expect(result.actors[0].playedTechniqueExternalIds).toContain('T1498');
    });

    it('prices none of them when no attack takes the path, or when no group can be attacked on it', () => {
      const idle = aroundDoor(0);
      expect(idle.techniqueValues.map((value) => value.techniqueExternalId)).toEqual(REPERTOIRE.map((entry) => entry.externalId));
      expect(idle.actors[0].playedTechniqueExternalIds).not.toContain('T1498');
      const shut = aroundDoor(1, GROUPS);
      expect(shut.techniqueValues.map((value) => value.techniqueExternalId)).toEqual(REPERTOIRE.map((entry) => entry.externalId));
    });

    it('still prices no technique held by nobody that the path does not play', () => {
      const stray = { ...technique('Z1', ['TA0040']), prevalence: 0 };
      const result = runAll(inputsOf({
        actors: [actor({ repertoire: [...REPERTOIRE, ...FLOOD, stray], groups: EDGE })],
        withoutInitialAccess: { key: 'outside_perimeter', share: 1, techniqueExternalIds: ['T1498', 'T1499'] },
      }));
      expect(valueOf(result, 'Z1')).toBeUndefined();
      expect(valueOf(result, 'T1498')).toBeDefined();
    });

    it('reports no exceeded reaction window for an actor whose attacks all take it, and the long chain one otherwise', () => {
      expect(aroundDoor(1).actors[0].reactionTimeExceededShare).toBeNull();
      expect(aroundDoor(0.05).actors[0].reactionTimeExceededShare).toBe(aroundDoor(0).actors[0].reactionTimeExceededShare);
      expect(aroundDoor(0).actors[0].reactionTimeExceededShare).not.toBeNull();
    });
  });

  it('names the obstacles an actor cannot play', () => {
    const result = runAll(inputsOf({
      actors: [actor({ repertoire: REPERTOIRE.filter((candidate) => !candidate.tacticExternalIds.includes('TA0007')) })],
    }));
    expect(result.actors[0].unplayableObstacleKeys).toEqual(['knowledge']);
    expect(result.actors[0].outcomes.impactDetected + result.actors[0].outcomes.impactUndetected).toBe(0);
  });
});

/**
 * A treatment plan is a whole posture, priced once on the run's own worlds against the run's own
 * baseline. Everything asserted here is a property of that difference rather than of its size:
 * that it never goes the wrong way, that it is exactly zero where the plan asks for nothing, and
 * that it reproduces.
 */
describe('a treatment plan priced as one posture', () => {
  const PLAN_CONTROLS = [
    control('EDR', ['X1', 'X4', 'E1'], ['X1', 'X3']),
    control('PAM', ['X2'], ['X2']),
    control('NGFW', ['X4'], ['X4'], { strengthRung: 'L3', coverageBucket: 'L3' }),
  ];

  const plan = (planId: string, moves: EngineRunPlan['moves']): EngineRunPlan => ({ planId, moves });

  const withPlans = (plans: ReadonlyArray<EngineRunPlan>): EngineRunResult =>
    runAll(inputsOf({ controls: PLAN_CONTROLS, plans }));

  const valueOf = (result: EngineRunResult, planId: string) =>
    result.planValues.find((value) => value.planId === planId)!;

  it('never raises the ALE, on the 5th percentile and not only on the mean', () => {
    const result = withPlans([
      plan('all', [
        { controlId: 'id-EDR', targetStrengthRung: 'L3', targetCoverageBucket: 'L3' },
        { controlId: 'id-PAM', targetStrengthRung: 'L3', targetCoverageBucket: 'L3' },
        { controlId: 'id-NGFW', targetStrengthRung: 'L3', targetCoverageBucket: 'L3' },
      ]),
      plan('one-axis', [{ controlId: 'id-EDR', targetStrengthRung: 'L3', targetCoverageBucket: null }]),
    ]);
    for (const value of result.planValues) {
      expect(value.aleReduction.p5, value.planId).toBeGreaterThanOrEqual(0);
      expect(value.aleReduction.p10, value.planId).toBeGreaterThanOrEqual(value.aleReduction.p5);
      expect(value.aleReduction.p90, value.planId).toBeLessThanOrEqual(value.aleReduction.p95);
      expect(value.aleReduction.mean, value.planId).toBeGreaterThan(0);
    }
  });

  /*
   * The basket is worth less than the sum of its parts, and that is the whole reason it is priced
   * as one evaluation: each deployed control multiplies its own silence into the family product, so
   * the second control on a technique only quietens what the first left.
   */
  it('is worth less than the sum of the single-control plans it is made of', () => {
    const result = withPlans([
      plan('edr', [{ controlId: 'id-EDR', targetStrengthRung: 'L3', targetCoverageBucket: 'L3' }]),
      plan('pam', [{ controlId: 'id-PAM', targetStrengthRung: 'L3', targetCoverageBucket: 'L3' }]),
      plan('both', [
        { controlId: 'id-EDR', targetStrengthRung: 'L3', targetCoverageBucket: 'L3' },
        { controlId: 'id-PAM', targetStrengthRung: 'L3', targetCoverageBucket: 'L3' },
      ]),
    ]);
    const parts = valueOf(result, 'edr').aleReduction.mean + valueOf(result, 'pam').aleReduction.mean;
    expect(valueOf(result, 'both').aleReduction.mean).toBeGreaterThan(0);
    expect(valueOf(result, 'both').aleReduction.mean).toBeLessThan(parts);
  });

  /* A plan whose single move is the one-step upgrade of one control answers what that control's own
   * strength lever answers, at the coverage the lever holds. */
  it('agrees with the strength lever of a control on its one-step move', () => {
    const result = withPlans([plan('one-step', [
      { controlId: 'id-PAM', targetStrengthRung: 'L3', targetCoverageBucket: 'L2' },
    ])]);
    const pam = result.controlValues.find((value) => value.capabilityExternalId === 'PAM')!;
    const lever = leverOf(pam, 'strength')!;
    expect(lever.aleReduction.mean).toBeGreaterThan(0);
    /*
     * Not equality: the lever mixes the two coverage arms analytically while the plan reads the one
     * shared deployment column, so the same move is answered over the same worlds by two
     * estimators. The agreement is what is asserted, within a tenth of the lever.
     */
    const priced = valueOf(result, 'one-step').aleReduction.mean;
    expect(Math.abs(priced - lever.aleReduction.mean) / lever.aleReduction.mean).toBeLessThan(0.1);
  });

  it('prices a plan whose every target is already held at zero', () => {
    const result = withPlans([plan('held', [
      { controlId: 'id-EDR', targetStrengthRung: 'L2', targetCoverageBucket: 'L2' },
      { controlId: 'id-NGFW', targetStrengthRung: 'L3', targetCoverageBucket: 'L3' },
    ])]);
    expect(valueOf(result, 'held').aleReduction).toEqual({ mean: 0, p5: 0, p10: 0, p50: 0, p90: 0, p95: 0 });
  });

  it('prices a plan that moves no control of this run at zero', () => {
    const result = withPlans([plan('elsewhere', [
      { controlId: 'id-ANTIVIRUS', targetStrengthRung: 'L3', targetCoverageBucket: 'L3' },
    ])]);
    expect(valueOf(result, 'elsewhere').aleReduction).toEqual({ mean: 0, p5: 0, p10: 0, p50: 0, p90: 0, p95: 0 });
  });

  /*
   * A target is a commitment and not a floor, so a plan naming less than what is in place is a
   * reduction and prices as one. A plan the estate has overtaken is that same row, and reads as the
   * downgrade it has become rather than as nothing.
   */
  it('prices a target below the declaration as the reduction it names', () => {
    const result = withPlans([
      plan('reduction', [{ controlId: 'id-NGFW', targetStrengthRung: 'L1', targetCoverageBucket: 'L1' }]),
      plan('mixed', [{ controlId: 'id-EDR', targetStrengthRung: 'L1', targetCoverageBucket: 'L3' }]),
      plan('widen-only', [{ controlId: 'id-EDR', targetStrengthRung: null, targetCoverageBucket: 'L3' }]),
    ]);

    // A plan that lowers a control raises the exposure, so its saving is the negative of a gain.
    expect(valueOf(result, 'reduction').aleReduction.mean).toBeLessThan(0);
    // The axes are independent: widening coverage while lowering strength buys less than widening alone.
    expect(valueOf(result, 'mixed').aleReduction.mean)
      .toBeLessThan(valueOf(result, 'widen-only').aleReduction.mean);
  });

  it('replays the same figures on the same inputs', () => {
    const plans = [
      plan('b-plan', [{ controlId: 'id-PAM', targetStrengthRung: 'L3', targetCoverageBucket: 'L3' }]),
      plan('a-plan', [{ controlId: 'id-EDR', targetStrengthRung: 'L3', targetCoverageBucket: null }]),
    ];
    expect(withPlans(plans).planValues).toEqual(withPlans(plans).planValues);
  });

  /* The declared and the upgraded arms are what the calibration stands on, so pricing a plan must
   * leave every per-control figure of the same run exactly where it was. */
  it('leaves the per-control levers untouched', () => {
    const without = runAll(inputsOf({ controls: PLAN_CONTROLS }));
    const with_ = withPlans([plan('all', [
      { controlId: 'id-EDR', targetStrengthRung: 'L3', targetCoverageBucket: 'L3' },
      { controlId: 'id-PAM', targetStrengthRung: 'L3', targetCoverageBucket: 'L3' },
    ])]);
    expect(with_.controlValues).toEqual(without.controlValues);
    expect(with_.ale).toEqual(without.ale);
    expect(with_.techniqueValues).toEqual(without.techniqueValues);
    expect(without.planValues).toEqual([]);
  });
});

/**
 * A budget review is priced as paired differences between baskets of the same run, so what is
 * asserted is the arithmetic those differences owe one another rather than their size.
 */
describe('baskets differenced against one another', () => {
  const BASKET_CONTROLS = [
    control('EDR', ['X1', 'X4', 'E1'], ['X1', 'X3']),
    control('PAM', ['X2'], ['X2']),
  ];

  const basket = (basketId: string, moves: EngineRunBasket['moves']): EngineRunBasket => ({ basketId, moves });
  const difference = (key: string, minuendBasketId: string | null, subtrahendBasketId: string | null): EngineRunBasketDifference =>
    ({ key, minuendBasketId, subtrahendBasketId });

  const BASKETS = [
    basket('edr-at-start', [{ controlId: 'id-EDR', targetStrengthRung: 'L1', targetCoverageBucket: 'L1' }]),
    basket('edr-absent', [{ controlId: 'id-EDR', targetStrengthRung: 'L0', targetCoverageBucket: 'L0' }]),
    basket('pam-absent', [{ controlId: 'id-PAM', targetStrengthRung: 'L0', targetCoverageBucket: 'L0' }]),
    basket('both-absent', [
      { controlId: 'id-EDR', targetStrengthRung: 'L0', targetCoverageBucket: 'L0' },
      { controlId: 'id-PAM', targetStrengthRung: 'L0', targetCoverageBucket: 'L0' },
    ]),
  ];

  const withBaskets = (basketDifferences: ReadonlyArray<EngineRunBasketDifference>): EngineRunResult =>
    runAll(inputsOf({ controls: BASKET_CONTROLS, baskets: BASKETS, basketDifferences }));

  const valueOf = (result: EngineRunResult, key: string) =>
    result.basketDifferenceValues.find((value) => value.key === key)!.value;

  it('answers exactly zero for a posture against itself', () => {
    const result = withBaskets([difference('same', 'edr-at-start', 'edr-at-start'), difference('baseline', null, null)]);
    expect(valueOf(result, 'same')).toEqual({ mean: 0, p5: 0, p10: 0, p50: 0, p90: 0, p95: 0 });
    expect(valueOf(result, 'baseline')).toEqual({ mean: 0, p5: 0, p10: 0, p50: 0, p90: 0, p95: 0 });
  });

  /*
   * A control funded by a build line and a run line is worth (start to absent) in the run line plus
   * (end to start) in the build line, which must be its value from end to absent and nothing more.
   */
  it('telescopes a run figure and a build figure on the same control into that control from the run posture to absent', () => {
    const result = withBaskets([
      difference('run', 'edr-absent', 'edr-at-start'),
      difference('build', 'edr-at-start', null),
      difference('whole', 'edr-absent', null),
    ]);
    expect(valueOf(result, 'build').mean).toBeGreaterThan(0);
    expect(valueOf(result, 'run').mean).toBeGreaterThan(0);
    expect(valueOf(result, 'run').mean + valueOf(result, 'build').mean).toBeCloseTo(valueOf(result, 'whole').mean, 6);
  });

  it('spreads a difference as the difference itself, world by world', () => {
    const result = withBaskets([difference('whole', 'edr-absent', null)]);
    const value = valueOf(result, 'whole');
    expect(value.p10).toBeLessThanOrEqual(value.mean);
    expect(value.p90).toBeGreaterThanOrEqual(value.p10);
    expect(value.p5).toBeGreaterThanOrEqual(0);
  });

  /* Each control removed alone leaves the other one covering what they share, so removing both at
   * once costs more than the two removals added up, and a sum of line figures is no ensemble. */
  it('prices two controls removed together as more than the sum of each removed alone', () => {
    const result = withBaskets([
      difference('edr', 'edr-absent', null),
      difference('pam', 'pam-absent', null),
      difference('both', 'both-absent', null),
    ]);
    expect(valueOf(result, 'both').mean).toBeGreaterThan(0);
    expect(valueOf(result, 'both').mean).toBeGreaterThan(valueOf(result, 'edr').mean + valueOf(result, 'pam').mean);
  });

  it('leaves the baseline, the levers and the plans of the same run untouched', () => {
    const plans: ReadonlyArray<EngineRunPlan> = [{ planId: 'plan', moves: [{ controlId: 'id-PAM', targetStrengthRung: 'L3', targetCoverageBucket: 'L3' }] }];
    const without = runAll(inputsOf({ controls: BASKET_CONTROLS, plans }));
    const with_ = runAll(inputsOf({ controls: BASKET_CONTROLS, plans, baskets: BASKETS, basketDifferences: [difference('whole', 'edr-absent', null)] }));
    expect(with_.ale).toEqual(without.ale);
    expect(with_.controlValues).toEqual(without.controlValues);
    expect(with_.planValues).toEqual(without.planValues);
    expect(without.basketDifferenceValues).toEqual([]);
  });

  it('refuses a difference naming a basket the run was not given', () => {
    expect(() => withBaskets([difference('lost', 'nowhere', null)])).toThrow();
  });

  it('leaves the baseline, its annual loss, the levers, the plans and the differences untouched when it draws a basket\'s annual loss', () => {
    const plans: ReadonlyArray<EngineRunPlan> = [{ planId: 'plan', moves: [{ controlId: 'id-PAM', targetStrengthRung: 'L3', targetCoverageBucket: 'L3' }] }];
    const basketDifferences = [difference('build', 'edr-at-start', null), difference('run', 'edr-absent', 'edr-at-start')];
    const without = runAll(inputsOf({ controls: BASKET_CONTROLS, plans, baskets: BASKETS, basketDifferences }));
    const with_ = runAll(inputsOf({ controls: BASKET_CONTROLS, plans, baskets: BASKETS, basketDifferences, annualLossBaskets: ['edr-at-start', 'both-absent'] }));
    expect(with_.ale).toEqual(without.ale);
    expect(with_.annualLoss).toEqual(without.annualLoss);
    expect(with_.controlValues).toEqual(without.controlValues);
    expect(with_.planValues).toEqual(without.planValues);
    expect(with_.basketDifferenceValues).toEqual(without.basketDifferenceValues);
    expect(without.basketAnnualLosses).toEqual([]);
    expect(with_.basketAnnualLosses.map((entry) => entry.basketId)).toEqual(['edr-at-start', 'both-absent']);
  });

  it('draws more annual loss without the build work than with it, where the build work reduced risk', () => {
    const result = runAll(inputsOf({ controls: BASKET_CONTROLS, baskets: BASKETS, annualLossBaskets: ['edr-at-start'] }));
    const [withoutBuild] = result.basketAnnualLosses;
    expect(withoutBuild.annualLoss.years).toBe(result.annualLoss.years);
    expect(withoutBuild.annualLoss.mean).toBeGreaterThan(result.annualLoss.mean);
    expect(withoutBuild.annualLoss.lossYearShare).toBeGreaterThanOrEqual(result.annualLoss.lossYearShare);
    const at = (distribution: typeof result.annualLoss, probability: number) =>
      distribution.quantiles.find((quantile) => quantile.probability === probability)!.loss;
    expect(at(withoutBuild.annualLoss, 0.9)).toBeGreaterThan(at(result.annualLoss, 0.9));
  });

  /* A basket moving nothing draws on the run's own seeds from the run's own rates, so its years are
   * the run's own, draw for draw: the pairing a without-build curve is read against. */
  it('draws a basket that moves nothing exactly as the run\'s own annual loss', () => {
    const asDeclared = basket('edr-as-declared', [{ controlId: 'id-EDR', targetStrengthRung: 'L2', targetCoverageBucket: 'L2' }]);
    const result = runAll(inputsOf({ controls: BASKET_CONTROLS, baskets: [...BASKETS, asDeclared], annualLossBaskets: ['edr-as-declared'] }));
    expect(result.basketAnnualLosses[0].annualLoss).toEqual(result.annualLoss);
  });

  it('refuses an annual loss naming a basket the run was not given', () => {
    expect(() => createEngineRun(inputsOf({ controls: BASKET_CONTROLS, baskets: BASKETS, annualLossBaskets: ['nowhere'] }))).toThrow();
  });
});

/** The PERT mean, against which `magnitude` and `tef` are checked independently of the engine. */
const pertMean = (range: PertRange): number => (range.min + 4 * range.likely + range.max) / 6;

describe('the magnitude', () => {
  it('draws its mean from one loss driver, at the PERT mean of that driver', () => {
    const driver = { min: 100000, likely: 400000, max: 2000000 };
    const result = runAll(inputsOf({ worlds: 2000, lossDrivers: [driver] }));
    const expected = pertMean(driver);
    expect(Math.abs(result.magnitude.mean - expected) / expected).toBeLessThan(0.01);
  });

  it('sums the means of several loss drivers', () => {
    const drivers = [
      { min: 100000, likely: 400000, max: 2000000 },
      { min: 50000, likely: 100000, max: 300000 },
    ];
    const result = runAll(inputsOf({ worlds: 2000, lossDrivers: drivers }));
    const expected = drivers.reduce((sum, driver) => sum + pertMean(driver), 0);
    expect(Math.abs(result.magnitude.mean - expected) / expected).toBeLessThan(0.01);
  });

  it('spreads around its mean', () => {
    const result = runAll(inputsOf({ worlds: 2000, lossDrivers: [{ min: 100000, likely: 400000, max: 2000000 }] }));
    expect(result.magnitude.p10).toBeLessThan(result.magnitude.mean);
    expect(result.magnitude.mean).toBeLessThan(result.magnitude.p90);
  });

  it('is zero without a loss driver', () => {
    const result = runAll(inputsOf({ lossDrivers: [] }));
    expect(result.magnitude).toEqual({ mean: 0, p5: 0, p10: 0, p50: 0, p90: 0, p95: 0 });
  });

  /*
   * What the Overview decomposition stands on: the mean ALE is recoverable from the TEF, the priced
   * fraction of the outcome split and the magnitude, none of which multiply exactly world by world.
   */
  it('recovers the mean ALE from the TEF, the priced fraction and the magnitude', () => {
    const tef = { min: 0.5, likely: 1, max: 3 };
    const result = runAll(inputsOf({ worlds: 4000, tef }));
    const expected = pertMean(tef) * pricedFraction(result.outcomes) * result.magnitude.mean;
    expect(Math.abs(result.ale.mean - expected) / expected).toBeLessThan(0.03);
  });
});

/**
 * With no impairment technique, a door the draws cannot move and a frequency and magnitude held to
 * one value, a run is deterministic, so a lever has to answer what two runs declaring its two
 * postures answer.
 */
describe('a control lever against the run of its upgraded posture', () => {
  const inputsWith = (controls: ReadonlyArray<EngineRunControl>): EngineRunInputs => inputsOf({
    controls,
    actors: [actor({ repertoire: REPERTOIRE.filter((candidate) => candidate.externalId !== 'T1553') })],
    lossDrivers: [{ min: 1000000, likely: 1000000, max: 1000000 }],
    tef: { min: 1, likely: 1, max: 1 },
    reactionTimeHours: { min: 8, likely: 8, max: 8 },
    door: CERTAIN_DOOR,
    worlds: 1,
  });
  const CONTROLS = [
    control('EDR', ['X1', 'X4'], ['X1', 'X4'], { coverageBucket: 'L1' }),
    control('PAM', ['X2'], ['X2'], { coverageBucket: 'L2' }),
    control('NGFW', ['X3'], ['X3'], { coverageBucket: 'L1', strengthRung: 'L1' }),
    control('WAF', ['X5'], ['X5'], { coverageBucket: 'L2', strengthRung: 'L3' }),
  ];
  const aleWith = (index: number, over: Partial<EngineRunControl>): number =>
    runAll(inputsWith(CONTROLS.map((entry, other) => (other === index ? { ...entry, ...over } : entry)))).ale.mean;
  const closeTo = (actual: number, expected: number): void => {
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(expected)));
  };

  it('prices the coverage lever at the upgraded coverage and the strength lever at the declared one', () => {
    const declared = runAll(inputsWith(CONTROLS));
    CONTROLS.forEach((entry, index) => {
      const value = declared.controlValues[index];
      const coverage = leverOf(value, 'coverage')!.aleReduction.mean;
      closeTo(coverage, declared.ale.mean - aleWith(index, { coverageBucket: leverOf(value, 'coverage')!.upgradedCoverageBucket }));
      expect(coverage, entry.capabilityExternalId).toBeGreaterThanOrEqual(0);
      if (entry.strengthRung !== 'L3') {
        closeTo(
          leverOf(value, 'strength')!.aleReduction.mean,
          declared.ale.mean - aleWith(index, { strengthRung: leverOf(value, 'strength')!.upgradedStrengthRung }),
        );
      }
    });
    expect(leverOf(declared.controlValues[0], 'coverage')!.aleReduction.mean).toBeGreaterThan(0);
  });

  it('prices the anchor step at the first rung and the first coverage together', () => {
    const anchored = [control('EDR', ['X1', 'X4'], ['X1', 'X4'], { strengthRung: 'L0', coverageBucket: 'L0' }), ...CONTROLS.slice(1)];
    const declared = runAll(inputsWith(anchored));
    const deploy = leverOf(declared.controlValues[0], 'deploy')!;
    const deployed = runAll(inputsWith([{ ...anchored[0], strengthRung: 'L1', coverageBucket: 'L1' }, ...CONTROLS.slice(1)]));
    closeTo(deploy.aleReduction.mean, declared.ale.mean - deployed.ale.mean);
    expect(deploy.aleReduction.mean).toBeGreaterThan(0);
  });

  it('lowers the ALE at every step up a control\'s coverage', () => {
    const ladder = (['L0', 'L1', 'L2', 'L3'] as const).map((coverageBucket) => runAll(inputsOf({
      controls: [control('EDR', ['X1', 'X4', 'E1'], ['X1', 'X3', 'X4', 'X5'], { coverageBucket }), control('PAM', ['X2'], ['X2'])],
    })).ale);
    for (let step = 1; step < ladder.length; step += 1) {
      expect(ladder[step].mean).toBeLessThan(ladder[step - 1].mean);
      expect(ladder[step].p5).toBeLessThanOrEqual(ladder[step - 1].p5);
    }
  });
});

describe('the what-if of a flaw', () => {
  /** An actor citing the first flaw of the door: its jewels keep a floored route on credentials, which only that flaw gives. */
  const FLOORED_GROUPS: ReadonlyArray<AttackRunGroup> = [
    { ...GROUPS[0], cveFloors: [{ techniqueExternalId: 'X2', share: 1 }] },
    GROUPS[1],
  ];
  const CVE_GROUPS: ReadonlyArray<EngineRunCveGroups> = [{
    cveId: DOOR.cves[0].cveId,
    groups: GROUPS,
  }];

  const inputs = inputsOf({
    worlds: 1,
    lossDrivers: [{ min: 1000000, likely: 1000000, max: 1000000 }],
    tef: { min: 1, likely: 1, max: 1 },
    reactionTimeHours: { min: 8, likely: 8, max: 8 },
    actors: [actor({ groups: FLOORED_GROUPS, cveGroups: CVE_GROUPS })],
  });

  /**
   * The same run with one flaw gone, from the door and from every floor it gave: every other CVE
   * keeps its column, since the uniforms are keyed by id.
   */
  const withoutCve = (run: EngineRunInputs, removed: number): EngineRunInputs => {
    const removedId = run.door.cves[removed].cveId;
    return {
      ...run,
      door: {
        ...run.door,
        cves: run.door.cves.filter((_, index) => index !== removed),
        assets: run.door.assets.map((asset) => ({
          ...asset,
          openings: asset.openings
            .filter((opening) => opening.cve !== removed)
            .map((opening) => ({ ...opening, cve: opening.cve > removed ? opening.cve - 1 : opening.cve })),
        })),
      },
      actors: run.actors.map((member) => {
        const own = member.cveGroups?.find((entry) => entry.cveId === removedId);
        return {
          ...member,
          groups: own === undefined
            ? member.groups
            : own.groups,
          cveGroups: member.cveGroups?.filter((entry) => entry.cveId !== removedId),
        };
      }),
    };
  };

  const valueOf = (result: EngineRunResult, cveId: string) =>
    result.cveValues.find((value) => value.cveId === cveId)!;

  it('prices a flaw at the ALE of the run minus the ALE of the same run without it, on one world and on many', () => {
    for (const worlds of [1, 200]) {
      const run = { ...inputs, worlds };
      const base = runAll(run);
      expect(base.cveValues).toHaveLength(DOOR.cves.length);
      DOOR.cves.forEach((cve, index) => {
        const removed = runAll(withoutCve(run, index));
        const truth = base.ale.mean - removed.ale.mean;
        expect(valueOf(base, cve.cveId).aleReductionMean, `${cve.cveId} over ${worlds} worlds`)
          .toBeCloseTo(truth, 6);
      });
    }
  });

  describe('a flaw whose dismissal regroups the estate', () => {
    /*
     * Two hosts with no floor and two that floor X2 through the flaw alone are two groups of 2 as
     * declared and one group of 4 once the flaw is dismissed, which a rerun builds. Group size reads
     * non-linearly (a population-scoped technique reaches a group with `(1 - p) ** assets`), so the
     * what-if has to read the merged group, not the declared partition with the mask swapped.
     */
    const FLOOR_ONLY = 'CVE-2024-0900';
    const host = (criticality: EstateCountRow['criticality'], assets: number): EstateCountRow =>
      ({ categoryId: 'host', exposure: 'internal', criticality, count: assets });
    const routeOf = (assetId: string, cveRowId: string): EstateRouteRow => ({
      supportingAssetId: assetId,
      categoryId: 'host',
      exposure: 'internal',
      criticality: 'high',
      matchedByScenarioGroup: true,
      cveExternalId: cveRowId,
      cveRowId,
      techniqueExternalId: 'X2',
    });
    const estateOf = (cveRowId: string): EstateCollapseInput => ({
      counts: [host('high', 4), host('low', 200)],
      scenarioGroupCounts: [host('high', 4)],
      routes: [routeOf('asset-3', cveRowId), routeOf('asset-4', cveRowId)],
      members: [{ share: 1, cveExternalIds: new Set([cveRowId]), techniqueExternalIds: new Set(['X2']) }],
    });
    const scoped = REPERTOIRE.map((entry) => (entry.externalId === 'X2' ? { ...entry, populationScoped: true } : entry));

    const runOf = (cveRowId: string) => {
      const collapse = prepareCollapse(estateOf(cveRowId));
      const own = collapse.without(cveRowId)!;
      /* The estate as a rerun after the dismissal builds it, from the routes without the CVE. */
      const dismissed = prepareCollapse({ ...estateOf(cveRowId), routes: [] }).groups;
      expect(collapse.groups.map((group) => group.assets).sort()).toEqual([2, 2, 200]);
      return { collapse, own, dismissed };
    };

    it('prices the flaw at the ALE of a run on the estate its dismissal leaves, to the rounding', () => {
      const cveRowId = DOOR.cves[0].cveId;
      const { collapse, own, dismissed } = runOf(cveRowId);
      const run = {
        ...inputs,
        worlds: 40,
        actors: [actor({ repertoire: scoped, groups: collapse.groups, cveGroups: [{ cveId: cveRowId, groups: own }] })],
      };
      const base = runAll(run);
      const rerun = runAll({ ...withoutCve(run, 0), actors: [actor({ repertoire: scoped, groups: dismissed })] });
      const truth = base.ale.mean - rerun.ale.mean;
      expect(truth).toBeGreaterThan(0);
      expect(Math.abs(valueOf(base, cveRowId).aleReductionMean - truth)).toBeLessThanOrEqual(1e-12 * base.ale.mean);
    });

    it('prices a flaw that gives the floor alone the same way', () => {
      const { collapse, own, dismissed } = runOf(FLOOR_ONLY);
      const run = {
        ...inputs,
        worlds: 40,
        floorCves: [{ cveId: FLOOR_ONLY }],
        actors: [actor({ repertoire: scoped, groups: collapse.groups, cveGroups: [{ cveId: FLOOR_ONLY, groups: own }] })],
      };
      const base = runAll(run);
      const rerun = runAll({ ...run, floorCves: [], actors: [actor({ repertoire: scoped, groups: dismissed })] });
      const truth = base.ale.mean - rerun.ale.mean;
      expect(truth).toBeGreaterThan(0);
      expect(Math.abs(valueOf(base, FLOOR_ONLY).aleReductionMean - truth)).toBeLessThanOrEqual(1e-12 * base.ale.mean);
    });
  });

  describe('a door flaw below the silence threshold', () => {
    const host = (criticality: EstateCountRow['criticality'], assets: number): EstateCountRow =>
      ({ categoryId: 'host', exposure: 'internal', criticality, count: assets });
    const routeOf = (assetId: string, cveRowId: string): EstateRouteRow => ({
      supportingAssetId: assetId,
      categoryId: 'host',
      exposure: 'internal',
      criticality: 'high',
      matchedByScenarioGroup: true,
      cveExternalId: cveRowId,
      cveRowId,
      techniqueExternalId: 'X2',
    });
    const estateOf = (cveRowId: string): EstateCollapseInput => ({
      counts: [host('high', 4), host('low', 200)],
      scenarioGroupCounts: [host('high', 4)],
      routes: [routeOf('asset-3', cveRowId), routeOf('asset-4', cveRowId)],
      members: [{ share: 1, cveExternalIds: new Set([cveRowId]), techniqueExternalIds: new Set(['X2']) }],
    });
    const silent = (cveRowId: string): DoorEstate => ({
      ...DOOR,
      cves: DOOR.cves.map((cve, index) => (index === 0 ? { ...cve, cveId: cveRowId, threat: 0.03, priced: false } : cve)),
    });

    it('prices a cited one with a law of its own at the ALE of a run without its routes and its exploit', () => {
      const cveRowId = DOOR.cves[0].cveId;
      const collapse = prepareCollapse(estateOf(cveRowId));
      const own = collapse.without(cveRowId)!;
      const run = {
        ...inputs,
        worlds: 40,
        door: silent(cveRowId),
        actors: [actor({ groups: collapse.groups, cveGroups: [{ cveId: cveRowId, groups: own }] })],
      };
      const base = runAll(run);
      const dismissed = prepareCollapse({ ...estateOf(cveRowId), routes: [] }).groups;
      const rerun = runAll({ ...withoutCve(run, 0), actors: [actor({ groups: dismissed })] });
      const truth = base.ale.mean - rerun.ale.mean;
      expect(truth).toBeGreaterThan(0);
      expect(Math.abs(valueOf(base, cveRowId).aleReductionMean - truth)).toBeLessThanOrEqual(1e-12 * base.ale.mean);
    });

    it('stays without a row when no actor cites it', () => {
      const cveRowId = DOOR.cves[0].cveId;
      const result = runAll({ ...inputs, worlds: 40, door: silent(cveRowId), actors: [actor({ groups: FLOORED_GROUPS })] });
      expect(result.cveValues.map((value) => value.cveId)).not.toContain(cveRowId);
    });
  });

  /** The evaluations the CVE what-ifs add to a run: the same run with and without them. */
  const cveEvaluationsOf = (run: EngineRunInputs): number => {
    const count = (cves: boolean): number => {
      evaluations.count = 0;
      runAll({ ...run, whatIfs: { techniques: false, cves, leverControlIds: new Set() } });
      return evaluations.count;
    };
    return count(true) - count(false);
  };

  /** The door passes the CVE what-ifs add to a run: the same run with and without them. */
  const cveDoorPassesOf = (run: EngineRunInputs): number => {
    const count = (cves: boolean): number => {
      evaluations.doorPasses = 0;
      runAll({ ...run, whatIfs: { techniques: false, cves, leverControlIds: new Set() } });
      return evaluations.doorPasses;
    };
    return count(true) - count(false);
  };

  describe('the door pass of a flaw with a law of its own', () => {
    const worlds = 40;
    /** The priced flaw, and one certain unpriced flaw that keeps the door open (so the ALE is positive) in every world. */
    const single = (threat: number): DoorEstate => ({
      ...DOOR,
      cves: [{ ...DOOR.cves[0], threat }, { cveId: 'CVE-2024-0700', threat: 1, priced: false }],
      assets: [DOOR.assets[0], { family: 0, openings: [{ cve: 1, technique: 0, opening: 1 }], target: false }],
    });

    it('is not computed again in the worlds where the exploit is not drawn', () => {
      const run = { ...inputs, worlds, door: single(0) };
      expect(valueOf(runAll(run), DOOR.cves[0].cveId).aleReductionMean).toBeGreaterThan(0);
      expect(cveDoorPassesOf(run)).toBe(0);
    });

    it('is computed only in the worlds where the exploit is drawn', () => {
      expect(cveDoorPassesOf({ ...inputs, worlds, door: single(0.5) })).toBe(worlds / 2);
    });

    it('is not computed for a flaw that opens nothing at the door', () => {
      const floorOnly = {
        ...inputs,
        worlds,
        door: single(0),
        floorCves: [{ cveId: 'CVE-2024-0900' }],
        actors: [actor({ groups: FLOORED_GROUPS, cveGroups: [{ cveId: 'CVE-2024-0900', groups: GROUPS }] })],
      };
      expect(cveDoorPassesOf(floorOnly)).toBe(0);
    });
  });

  it('evaluates a flaw with a law of its own once per world when it moves the ALE', () => {
    const worlds = 40;
    const single: DoorEstate = {
      ...DOOR,
      cves: [{ ...DOOR.cves[0], threat: 1 }],
      assets: DOOR.assets.slice(0, 1),
    };
    const run = { ...inputs, worlds, door: single };
    expect(valueOf(runAll(run), DOOR.cves[0].cveId).aleReductionMean).toBeGreaterThan(0);
    expect(cveEvaluationsOf(run)).toBe(worlds);
  });

  it('evaluates a flaw that moves nothing once per world, and answers exactly zero', () => {
    const worlds = 40;
    const unplayed = technique('X6', ['TA0010']);
    const dead: DoorEstate = {
      ...DOOR,
      cves: [{ cveId: 'CVE-2024-0001', threat: 1, priced: false }, { cveId: 'CVE-2024-0100', threat: 1, priced: true }],
      assets: [{ family: 0, openings: [{ cve: 0, technique: 0, opening: 1 }, { cve: 1, technique: 0, opening: 0 }], target: false }],
    };
    const flooredGroups = GROUPS.map((group) => ({ ...group, cveFloors: [{ techniqueExternalId: 'X6', share: 1 }] }));
    const floored = actor({
      repertoire: [...REPERTOIRE, unplayed],
      groups: flooredGroups,
      cveGroups: [{
        cveId: 'CVE-2024-0100',
        groups: GROUPS,
      }],
    });
    const run = { ...inputs, worlds, door: dead, actors: [floored] };
    expect(valueOf(runAll(run), 'CVE-2024-0100')).toEqual({
      cveId: 'CVE-2024-0100',
      aleReductionMean: 0,
      aleReductionP10: 0,
      aleReductionP90: 0,
    });
    expect(cveEvaluationsOf(run)).toBe(worlds);
  });

  it('prices a flaw that changes nothing at exactly zero, not a rounding residue', () => {
    const dead: DoorEstate = {
      ...DOOR,
      cves: [...DOOR.cves, { cveId: 'CVE-2024-0100', threat: 1, priced: true }],
      assets: [...DOOR.assets, { family: 0, openings: [{ cve: DOOR.cves.length, technique: 0, opening: 0 }], target: false }],
    };
    const result = runAll({ ...inputs, worlds: 50, door: dead });
    expect(valueOf(result, 'CVE-2024-0100')).toEqual({
      cveId: 'CVE-2024-0100',
      aleReductionMean: 0,
      aleReductionP10: 0,
      aleReductionP90: 0,
    });
  });

  it('prices a flaw whose floor sits on a technique no step plays at exactly zero', () => {
    const unplayed = technique('X6', ['TA0010']);
    const dead: DoorEstate = {
      ...DOOR,
      cves: [...DOOR.cves, { cveId: 'CVE-2024-0100', threat: 1, priced: true }],
      assets: [...DOOR.assets, { family: 0, openings: [{ cve: DOOR.cves.length, technique: 0, opening: 0 }], target: false }],
    };
    const flooredGroups = GROUPS.map((group) => ({ ...group, cveFloors: [{ techniqueExternalId: 'X6', share: 1 }] }));
    const floored = actor({
      repertoire: [...REPERTOIRE, unplayed],
      groups: flooredGroups,
      cveGroups: [{
        cveId: 'CVE-2024-0100',
        groups: GROUPS,
      }],
    });
    const result = runAll({ ...inputs, worlds: 50, door: dead, actors: [floored] });
    expect(valueOf(result, 'CVE-2024-0100')).toEqual({
      cveId: 'CVE-2024-0100',
      aleReductionMean: 0,
      aleReductionP10: 0,
      aleReductionP90: 0,
    });
  });

  it('prices a flaw whose own groups only split the reference ones differently at exactly zero', () => {
    const unplayed = technique('X6', ['TA0010']);
    const dead: DoorEstate = {
      ...DOOR,
      cves: [...DOOR.cves, { cveId: 'CVE-2024-0100', threat: 1, priced: true }],
      assets: [...DOOR.assets, { family: 0, openings: [{ cve: DOOR.cves.length, technique: 0, opening: 0 }], target: false }],
    };
    const floor = [{ techniqueExternalId: 'X6', share: 1 }];
    const [jewels, desktops] = GROUPS;
    const reference = [
      { ...jewels, id: 'plain-jewels', assets: 5 },
      { ...jewels, id: 'floored-jewels', assets: 3, cveFloors: floor },
      { ...desktops, id: 'plain-desktops', assets: 37 },
      { ...desktops, id: 'floored-desktops', assets: 163, cveFloors: floor },
    ];
    const floored = actor({
      repertoire: [...REPERTOIRE, unplayed],
      groups: reference,
      cveGroups: [{ cveId: 'CVE-2024-0100', groups: GROUPS }],
    });
    const result = runAll({ ...inputs, worlds: 50, door: dead, actors: [floored] });
    expect(valueOf(result, 'CVE-2024-0100')).toEqual({
      cveId: 'CVE-2024-0100',
      aleReductionMean: 0,
      aleReductionP10: 0,
      aleReductionP90: 0,
    });
  });

  it('prices a flaw whose exploit is never drawn at zero when no group floors on it', () => {
    const quiet: DoorEstate = {
      ...DOOR,
      cves: DOOR.cves.map((cve, index) => (index === 1 ? { ...cve, threat: 0 } : cve)),
    };
    const result = runAll({ ...inputs, worlds: 100, door: quiet });
    expect(valueOf(result, DOOR.cves[1].cveId).aleReductionMean).toBe(0);
    expect(valueOf(result, DOOR.cves[2].cveId).aleReductionMean).toBeGreaterThan(0);
  });

  it('values a cited flaw whose exploit is never drawn at the floor it gives', () => {
    const quiet: DoorEstate = {
      ...DOOR,
      cves: DOOR.cves.map((cve, index) => (index === 0 ? { ...cve, threat: 0 } : cve)),
    };
    const run = { ...inputs, worlds: 100, door: quiet };
    const value = valueOf(runAll(run), DOOR.cves[0].cveId).aleReductionMean;
    const removed = runAll(withoutCve(run, 0));
    expect(value).toBeGreaterThan(0);
    expect(value).toBeCloseTo(runAll(run).ale.mean - removed.ale.mean, 6);
  });

  describe('a cited flaw that opens no entry at the door', () => {
    const FLOOR_ONLY = 'CVE-2024-0900';
    const FLOOR_ONLY_GROUPS: ReadonlyArray<EngineRunCveGroups> = [{
      cveId: FLOOR_ONLY,
      groups: GROUPS,
    }];
    const floorOnly = {
      ...inputs,
      worlds: 100,
      floorCves: [{ cveId: FLOOR_ONLY }],
      actors: [actor({ groups: FLOORED_GROUPS, cveGroups: FLOOR_ONLY_GROUPS })],
    };

    it('values it at the floor it gives', () => {
      const result = runAll(floorOnly);
      const without = runAll({ ...floorOnly, floorCves: [], actors: [actor({ groups: GROUPS })] });
      const truth = result.ale.mean - without.ale.mean;
      expect(result.cveValues.map((value) => value.cveId)).toEqual([...DOOR.cves.map((cve) => cve.cveId), FLOOR_ONLY]);
      expect(truth).toBeGreaterThan(0);
      expect(valueOf(result, FLOOR_ONLY).aleReductionMean).toBeCloseTo(truth, 6);
    });

    it('values it at exactly zero when its floor moves nothing', () => {
      const unplayed = technique('X6', ['TA0010']);
      const flooredGroups = GROUPS.map((group) => ({ ...group, cveFloors: [{ techniqueExternalId: 'X6', share: 1 }] }));
      const run = {
        ...floorOnly,
        actors: [actor({
          repertoire: [...REPERTOIRE, unplayed],
          groups: flooredGroups,
          cveGroups: [{
            cveId: FLOOR_ONLY,
            groups: GROUPS,
          }],
        })],
      };
      expect(valueOf(runAll(run), FLOOR_ONLY)).toEqual({ cveId: FLOOR_ONLY, aleReductionMean: 0, aleReductionP10: 0, aleReductionP90: 0 });
    });

    it('never touches the door, whatever it is asked, and leaves the headline where it was', () => {
      const withFlaw = runAll(floorOnly);
      const withoutFlaw = runAll({ ...floorOnly, floorCves: [], actors: [actor({ groups: FLOORED_GROUPS })] });
      expect(withFlaw.ale).toEqual(withoutFlaw.ale);
      expect(withFlaw.vulnerability).toEqual(withoutFlaw.vulnerability);
      for (const value of withoutFlaw.cveValues) {
        expect(valueOf(withFlaw, value.cveId)).toEqual(value);
      }
    });

    it('is not priced by a run that skips the CVE what-ifs', () => {
      const skipped = runAll({ ...floorOnly, whatIfs: { techniques: false, cves: false, leverControlIds: new Set() } });
      expect(skipped.cveValues).toEqual([]);
    });
  });

  it('never raises the ALE, on the 10th percentile and not only on the mean', () => {
    const result = runAll({ ...inputs, worlds: 200 });
    for (const value of result.cveValues) {
      expect(value.aleReductionP10, value.cveId).toBeGreaterThanOrEqual(0);
      expect(value.aleReductionP90, value.cveId).toBeGreaterThanOrEqual(value.aleReductionP10);
      expect(value.aleReductionMean, value.cveId).toBeGreaterThan(0);
    }
  });

  it('prices no flaw the door does not mark as priced, and leaves the ALE of the run where it was', () => {
    const run = { ...inputs, worlds: 100, actors: [actor({ groups: FLOORED_GROUPS })] };
    const everyFlaw = runAll(run);
    const silent: DoorEstate = {
      ...DOOR,
      cves: DOOR.cves.map((cve, index) => (index === 0 ? { ...cve, priced: false } : cve)),
    };
    const result = runAll({ ...run, door: silent });

    expect(result.cveValues.map((value) => value.cveId)).toEqual(DOOR.cves.slice(1).map((cve) => cve.cveId));
    expect(result.ale).toEqual(everyFlaw.ale);
    expect(result.vulnerability).toEqual(everyFlaw.vulnerability);
    for (const value of result.cveValues) {
      expect(value).toEqual(valueOf(everyFlaw, value.cveId));
    }
  });

  it('prices no flaw on a door that lists none', () => {
    const result = runAll({ ...inputs, worlds: 20, door: { ...DOOR, cves: [], assets: [] } });
    expect(result.cveValues).toEqual([]);
  });

  it('answers the same whether the run pauses between worlds or at every step', () => {
    const run = createEngineRun({ ...inputs, worlds: 20 });
    while (!run.done()) {
      run.advanceUntil(() => true);
    }
    expect(run.result().cveValues).toEqual(runAll({ ...inputs, worlds: 20 }).cveValues);
  });
});

describe('the annual loss', () => {
  /*
   * The sampled mean and the ALE estimate the same expectation from different draws. Over ten seeds
   * at a thousand worlds their ratio spreads by 1.7%, so 5% is three standard errors.
   */
  it('averages to the ALE of the run', () => {
    const result = runAll(inputsOf({ worlds: 1000 }));
    expect(result.annualLoss.years).toBe(10000);
    expect(Math.abs(result.annualLoss.mean / result.ale.mean - 1)).toBeLessThan(0.05);
  });

  it('carries a loss event in a share 1 − e^−LEF of the years', () => {
    const result = runAll(inputsOf({
      controls: [],
      tef: { min: 1.5, likely: 1.5, max: 1.5 },
      reactionTimeHours: { min: 8, likely: 8, max: 8 },
      door: CERTAIN_DOOR,
      worlds: 1000,
    }));
    /* Every world reads one LEF, which leaves the count the only draw between the two. */
    expect(result.lef.p5).toBe(result.lef.p95);
    const nonZero = 1 - Math.exp(-result.lef.mean);
    const standardError = Math.sqrt(nonZero * (1 - nonZero) / result.annualLoss.years);
    expect(Math.abs(result.annualLoss.lossEventYearShare - nonZero)).toBeLessThan(3 * standardError);
  });

  it('counts the years an attack stopped in time costs its response among the years with a loss', () => {
    const result = runAll(inputsOf({ worlds: 1000 }));
    expect(result.outcomes.evicted).toBeGreaterThan(0);
    expect(result.annualLoss.lossYearShare).toBeGreaterThan(result.annualLoss.lossEventYearShare);
  });

  it('keeps the same quantiles on a rerun with the same seed', () => {
    expect(runAll(inputsOf()).annualLoss).toEqual(runAll(inputsOf()).annualLoss);
    expect(runAll(inputsOf({ seed: 'other' })).annualLoss.quantiles).not.toEqual(runAll(inputsOf()).annualLoss.quantiles);
  });

  it('answers zero for a scenario with no frequency or no loss estimate', () => {
    for (const unpriced of [inputsOf({ tef: null }), inputsOf({ lossDrivers: [] })]) {
      const { annualLoss } = runAll(unpriced);
      expect(annualLoss.mean).toBe(0);
      expect(annualLoss.quantiles.every((quantile) => quantile.loss === 0)).toBe(true);
    }
  });
});
