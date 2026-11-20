import { describe, expect, it } from 'vitest';
import type { AttackRunActorClass, AttackRunConstants, AttackRunGroup, AttackRunLawInputs, AttackRunTechnique } from './attack-run-law';
import type { DoorEstate } from './attack-run-door';
import type { AttackRunEvaluation, PreparedWorld, TechniqueInterdiction } from './attack-run-evaluation';
import { compileAttackRunLaw } from './attack-run-law';
import { evaluateAttackRun, prepareWorld } from './attack-run-evaluation';
import { SCENARIO_GROUP_BOOST_G } from './engine-constants';

/**
 * The paths an attack takes in one world: the door cut between the targets and the other assets,
 * the chain the target's fall plays, and the chain around the door. Every figure is read off the
 * closed forms, with the world decided by hand.
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

const RANSOMWARE: AttackRunActorClass = { capability: 0.7, stealth: 0.4, patience: 0.2, attackRunDays: 5 };

const technique = (
  externalId: string,
  tacticExternalIds: ReadonlyArray<string>,
  families: AttackRunTechnique['families'] = ['host'],
  prevalence?: number,
): AttackRunTechnique => ({ externalId, tacticExternalIds, families, populationScoped: false, prevalence });

const group = (id: string, family: AttackRunGroup['family'], assets: number, exposure: AttackRunGroup['exposure'] = 'internal'): AttackRunGroup => ({
  id,
  family,
  assets,
  exposure,
  criticality: 'medium',
  matchedByScenarioGroup: false,
});

const FULL_CHAIN = [
  technique('X1', ['TA0001']),
  technique('X2', ['TA0006']),
  technique('X3', ['TA0007']),
  technique('X4', ['TA0008']),
  technique('X5', ['TA0040']),
];
const WITHOUT_DEEP_ACCESS = FULL_CHAIN.filter((candidate) => candidate.externalId !== 'X4');

/** One host family holding `others` assets that are not targets and `targets` that are, all open to X1 through the floor. */
const flooredDoor = (others: number, targets: number): DoorEstate => ({
  techniques: ['X1'],
  families: ['host'],
  cves: [],
  assets: [],
  applicable: [Float64Array.from([others + targets])],
  targetApplicable: [Float64Array.from([targets])],
  phishing: null,
});

/** One asset opened to X1 by a CVE whose exploit circulates when the world draws it, a target or not. */
const exposedAsset = (target: boolean): DoorEstate => ({
  techniques: ['X1'],
  families: ['host'],
  cves: [{ cveId: 'c1', threat: 1, priced: true }],
  assets: [{ family: 0, openings: [{ cve: 0, technique: 0, opening: 1 }], target }],
  applicable: [Float64Array.from([1])],
  targetApplicable: [Float64Array.from([target ? 1 : 0])],
  phishing: null,
});

const law = (over: Partial<AttackRunLawInputs> & Pick<AttackRunLawInputs, 'door'>): AttackRunLawInputs => ({
  terminalTacticExternalId: 'TA0040',
  actorClass: RANSOMWARE,
  repertoire: FULL_CHAIN,
  groups: [group('fleet', 'host', 20)],
  controls: [],
  constants: CONSTANTS,
  unknownExposureCountsAs: 'internal',
  unknownCriticalityCountsAs: 'low',
  ...over,
});

interface WorldOverrides {
  readonly states?: ReadonlyArray<{ prevent?: number, detect?: number }>,
  /** One uniform per obstacle index, read by every control. */
  readonly knockoutByIndex?: ReadonlyArray<number>,
  readonly reactionTimeHours?: number,
  readonly familyUniform?: number | ReadonlyArray<number>,
  readonly cveUniform?: number,
}

const worldOf = (inputs: AttackRunLawInputs, over: WorldOverrides = {}): PreparedWorld => {
  const compiled = compileAttackRunLaw(inputs);
  const hours = over.reactionTimeHours ?? 8;
  return prepareWorld(compiled, {
    deployed: compiled.controls.map(() => true),
    preventEfficacy: compiled.controls.map((_, index) => over.states?.[index]?.prevent ?? 0),
    detectEfficacy: compiled.controls.map((_, index) => over.states?.[index]?.detect ?? 0),
    knockoutUniform: compiled.controls.map(() => compiled.obstacles.map((_, index) => over.knockoutByIndex?.[index] ?? 1)),
    reactionTimeHours: { min: hours, likely: hours, max: hours },
    cveUniform: new Float64Array(inputs.door.cves.length).fill(over.cveUniform ?? 0),
    familyUniform: typeof over.familyUniform === 'object'
      ? Float64Array.from(over.familyUniform)
      : new Float64Array(inputs.door.families.length).fill(over.familyUniform ?? 0),
  });
};

const evaluate = (inputs: AttackRunLawInputs, over: WorldOverrides = {}): AttackRunEvaluation => evaluateAttackRun(worldOf(inputs, over));

const impact = (evaluation: AttackRunEvaluation): number => evaluation.outcomes.impactDetected + evaluation.outcomes.impactUndetected;
const reached = (evaluation: AttackRunEvaluation): number => 1 - evaluation.outcomes.blocked;
const productAfterDoor = (clears: ReadonlyArray<number>): number => clears.slice(1).reduce((product, clear) => product * clear, 1);

/** The exploit circulates and the floor is not drawn, so only a finding opens the door. */
const OPEN_BY_FINDING = { familyUniform: 1, cveUniform: 0 };

describe('the direct path', () => {
  it('reaches the objective when the target falls, with the lateral movement made unplayable', () => {
    const withTarget = evaluate(law({ door: exposedAsset(true), repertoire: WITHOUT_DEEP_ACCESS }), OPEN_BY_FINDING);
    const withoutTarget = evaluate(law({ door: exposedAsset(false), repertoire: WITHOUT_DEEP_ACCESS }), OPEN_BY_FINDING);

    expect(impact(withoutTarget)).toBe(0);
    expect(withTarget.paths.direct).toBeCloseTo(CONSTANTS.coupleSuccessCap, 12);
    expect(impact(withTarget)).toBeGreaterThan(0);
    expect(reached(withTarget)).toBeCloseTo(CONSTANTS.coupleSuccessCap * withTarget.direct!.clearByObstacle[1], 12);
  });

  it('prices a target no technique falls it to as the estate with no target', () => {
    /* The target sits in a family the floor is not drawn for, and the exploit it carries does not circulate. */
    const door = (target: boolean): DoorEstate => ({
      techniques: ['X1'],
      families: ['host', 'network_device'],
      cves: [{ cveId: 'c1', threat: 1, priced: true }],
      assets: [{ family: 1, openings: [{ cve: 0, technique: 0, opening: 1 }], target }],
      applicable: [Float64Array.from([2, 1])],
      targetApplicable: [Float64Array.from([0, target ? 1 : 0])],
      phishing: null,
    });
    const inputs = (target: boolean): AttackRunLawInputs => law({
      door: door(target),
      repertoire: FULL_CHAIN.map((candidate) => ({ ...candidate, families: ['host', 'network_device'] as const })),
      groups: [group('fleet', 'host', 20), group('switches', 'network_device', 4)],
    });
    const over = { familyUniform: [0, 1], cveUniform: 1 };

    const withTarget = evaluate(inputs(true), over);
    const without = evaluate(inputs(false), over);

    expect(withTarget.paths.direct).toBe(0);
    expect(withTarget.direct).toBeNull();
    expect(withTarget.outcomes).toEqual(without.outcomes);
    expect(withTarget).toEqual(without);
  });

  it('does not fall back on the long chain when the direct one is blocked', () => {
    const inputs = law({
      door: flooredDoor(1, 1),
      controls: [{ capabilityExternalId: 'EDR', preventTechniqueExternalIds: ['X5'], detectTechniqueExternalIds: [] }],
    });
    const result = evaluate(inputs, { states: [{ prevent: 0.99 }] });

    const direct = result.direct!.clearByObstacle;
    expect(result.paths.direct).toBeGreaterThan(0);
    expect(reached(result)).toBeCloseTo(result.paths.direct * direct[1] + result.paths.long * productAfterDoor(result.clearByObstacle), 12);
    expect(reached(result)).toBeLessThan(0.05);
  });

  it('reaches nothing through a terminal obstacle nobody can play, and still stops no run at the door', () => {
    const result = evaluate(law({ door: exposedAsset(true), repertoire: FULL_CHAIN.filter((candidate) => candidate.externalId !== 'X5') }), OPEN_BY_FINDING);
    expect(result.outcomes.blocked).toBe(1);
    expect(result.paths.direct).toBeCloseTo(CONSTANTS.coupleSuccessCap, 12);
    expect(result.paths.stoppedAtInitialAccess).toBeCloseTo(1 - CONSTANTS.coupleSuccessCap, 12);
  });

  it('gives the long chain the whole door when another asset is all that falls', () => {
    const result = evaluate(law({ door: flooredDoor(3, 0) }));
    expect(result.paths.direct).toBe(0);
    expect(result.direct).toBeNull();
    expect(result.paths.long).toBe(result.clearByObstacle[0]);
    expect(result.paths.stoppedAtInitialAccess).toBeCloseTo(1 - result.clearByObstacle[0], 12);
  });

  it('splits the door between the target and the other assets and sums the shares to one', () => {
    const result = evaluate(law({ door: flooredDoor(1, 1) }));
    const fall = CONSTANTS.coupleSuccessCap;

    expect(result.paths.direct).toBeCloseTo(fall, 12);
    expect(result.paths.long).toBeCloseTo((1 - fall) * fall, 12);
    expect(result.paths.withoutInitialAccess).toBe(0);
    const { stoppedAtInitialAccess, direct, long, withoutInitialAccess } = result.paths;
    expect(stoppedAtInitialAccess + direct + long + withoutInitialAccess).toBeCloseTo(1, 12);
    expect(stoppedAtInitialAccess).toBeCloseTo(1 - result.clearByObstacle[0], 12);
    expect(result.clearByObstacle[0]).toBe(result.paths.direct + result.paths.long);
  });

  it('folds the direct chain on its own clears, door first', () => {
    const result = evaluate(law({ door: flooredDoor(1, 1) }));
    const direct = result.direct!.clearByObstacle;
    expect(direct).toHaveLength(2);
    expect(direct[0]).toBeCloseTo(result.paths.direct, 12);
    expect(direct[1]).toBeCloseTo(result.clearByObstacle[result.clearByObstacle.length - 1], 12);
  });

  it('is lowered by an interdiction of the technique the target falls to', () => {
    const world = worldOf(law({ door: exposedAsset(true) }), OPEN_BY_FINDING);
    const interdiction: TechniqueInterdiction = { lever: 'prevent', technique: 0 };
    const baseline = evaluateAttackRun(world);
    const interdicted = evaluateAttackRun(world, interdiction);

    expect(baseline.paths.direct).toBeGreaterThan(0);
    expect(interdicted.paths.direct).toBeLessThan(baseline.paths.direct);
    expect(interdicted.paths.direct).toBe(0);
    expect(impact(interdicted)).toBeLessThan(impact(baseline));
  });
});

describe('the door memo', () => {
  it('reuses the target and the other pass of an unchanged draw', () => {
    const world = worldOf(law({ door: flooredDoor(1, 1) }));
    const first = evaluateAttackRun(world);
    const second = evaluateAttackRun(world);

    expect(second.paths).toEqual(first.paths);
    expect(second.clearByObstacle[0]).toBe(first.clearByObstacle[0]);

    world.doorState.memoTarget.fill(0.5);
    const reused = evaluateAttackRun(world);
    expect(reused.paths.direct).toBeCloseTo(0.5, 12);
  });
});

describe('the knockout of a shortened chain', () => {
  const saboteur = (): AttackRunLawInputs => law({
    door: exposedAsset(true),
    repertoire: [...FULL_CHAIN, technique('T1553', ['TA0112'])],
    controls: [{ capabilityExternalId: 'EDR', preventTechniqueExternalIds: ['X5'], detectTechniqueExternalIds: [] }],
  });
  const states = [{ prevent: 0.6 }];
  const lastIndex = FULL_CHAIN.length - 1;
  const uniforms = (knockedIndex: number): Array<number> => FULL_CHAIN.map((_, index) => (index === knockedIndex ? 0 : 1));

  it('reads the uniform of the full chain index of the obstacle, not its position in the chain', () => {
    const knockedAtTerminal = evaluate(saboteur(), { ...OPEN_BY_FINDING, states, knockoutByIndex: uniforms(lastIndex) });
    const knockedAtPosition = evaluate(saboteur(), { ...OPEN_BY_FINDING, states, knockoutByIndex: uniforms(1) });

    expect(knockedAtTerminal.direct!.clearByObstacle[1]).toBeCloseTo(knockedAtTerminal.clearByObstacle[lastIndex], 12);
    expect(knockedAtPosition.direct!.clearByObstacle[1]).toBeCloseTo(knockedAtPosition.clearByObstacle[lastIndex], 12);
    expect(knockedAtTerminal.direct!.clearByObstacle[1]).toBeGreaterThan(knockedAtPosition.direct!.clearByObstacle[1]);
  });
});

describe('the chain around the initial access', () => {
  const FLOOD = [technique('T1498', ['TA0040'], ['host'], 0), technique('T1499', ['TA0040'], ['host'], 0)];
  const EDGE = [group('fleet', 'host', 20, 'internet_facing')];
  const around = (share: number, door: DoorEstate = flooredDoor(1, 1)): AttackRunLawInputs => law({
    door,
    repertoire: [...FULL_CHAIN, ...FLOOD],
    groups: EDGE,
    withoutInitialAccess: { key: 'outside_perimeter', share, techniqueExternalIds: ['T1498', 'T1499'] },
  });

  it('prices the whole partition on the chain around the door at a share of one, whatever the door opens', () => {
    const open = evaluate(around(1), { familyUniform: 0 });
    const shut = evaluate(around(1, flooredDoor(0, 0)), { familyUniform: 1 });

    expect(open.outcomes).toEqual(shut.outcomes);
    expect(open.paths).toEqual({ stoppedAtInitialAccess: 0, direct: 0, long: 0, withoutInitialAccess: 1 });
    expect(impact(open)).toBeGreaterThan(0);
  });

  it('evicts nothing on a chain of one obstacle', () => {
    expect(evaluate(around(1)).outcomes.evicted).toBe(0);
  });

  it('mixes the chain around the door in at its share', () => {
    const none = evaluate(around(0));
    const all = evaluate(around(1));
    const some = evaluate(around(0.05));
    for (const pick of [(o: AttackRunEvaluation['outcomes']) => o.evicted, (o: AttackRunEvaluation['outcomes']) => o.impactDetected, (o: AttackRunEvaluation['outcomes']) => o.impactUndetected]) {
      expect(pick(some.outcomes)).toBeCloseTo(0.95 * pick(none.outcomes) + 0.05 * pick(all.outcomes), 12);
    }
    expect(some.paths.withoutInitialAccess).toBe(0.05);
    expect(some.paths.stoppedAtInitialAccess + some.paths.direct + some.paths.long + some.paths.withoutInitialAccess).toBeCloseTo(1, 12);
  });

  it('reads the knockout uniform of the terminal obstacle in the full chain', () => {
    const inputs = (): AttackRunLawInputs => ({
      ...around(1),
      repertoire: [...FULL_CHAIN, ...FLOOD, technique('T1553', ['TA0112'])],
      controls: [{ capabilityExternalId: 'EDR', preventTechniqueExternalIds: ['T1498', 'T1499'], detectTechniqueExternalIds: [] }],
    });
    const states = [{ prevent: 0.6 }];
    const lastIndex = FULL_CHAIN.length - 1;
    const knockedAtTerminal = evaluate(inputs(), { states, knockoutByIndex: FULL_CHAIN.map((_, index) => (index === lastIndex ? 0 : 1)) });
    const knockedElsewhere = evaluate(inputs(), { states, knockoutByIndex: FULL_CHAIN.map((_, index) => (index === 0 ? 0 : 1)) });
    expect(impact(knockedAtTerminal)).toBeGreaterThan(impact(knockedElsewhere));
  });
});

describe('the chain around the initial access, one attempt per campaign', () => {
  const FLOOD = [technique('T1498', ['TA0040'], ['host'], 0), technique('T1499', ['TA0040'], ['host'], 0)];
  const FRAUD = [technique('T1657', ['TA0040'], ['host'], 0)];
  const around = (groups: ReadonlyArray<AttackRunGroup>, over: Partial<AttackRunLawInputs> = {}): AttackRunLawInputs => law({
    door: flooredDoor(1, 1),
    repertoire: [...FULL_CHAIN, ...FLOOD],
    groups,
    withoutInitialAccess: { key: 'outside_perimeter', share: 1, techniqueExternalIds: ['T1498', 'T1499'] },
    ...over,
  });
  const attempt = RANSOMWARE.capability * CONSTANTS.execFloor;

  const matched = (declared: AttackRunGroup): AttackRunGroup => ({ ...declared, matchedByScenarioGroup: true });
  const atLeastOne = (assets: number): number => 1 - (1 - attempt) ** assets;

  it('clears when at least one exposed asset falls to one attempt, an unmatched asset counting for a tenth', () => {
    const result = evaluate(around([group('fleet', 'host', 20, 'internet_facing')]));

    expect(reached(result)).toBeCloseTo(atLeastOne(20 / SCENARIO_GROUP_BOOST_G), 12);
    expect(1 - (1 - attempt) ** CONSTANTS.visitQuota).toBeGreaterThan(reached(result) + 0.2);
  });

  it('clears at its pass for one matched asset', () => {
    expect(reached(evaluate(around([matched(group('crown', 'host', 1, 'internet_facing'))])))).toBeCloseTo(attempt, 12);
  });

  it('weighs a matched asset ten times an unmatched one of the same pass', () => {
    const one = evaluate(around([matched(group('crown', 'host', 2, 'internet_facing'))]));
    const many = evaluate(around([group('fleet', 'host', 2 * SCENARIO_GROUP_BOOST_G, 'internet_facing')]));

    expect(reached(one)).toBeCloseTo(reached(many), 12);
    expect(reached(one)).toBeCloseTo(atLeastOne(2), 12);
  });

  it('counts a population-scoped technique once for its group, not once per asset', () => {
    const wave = [{ ...technique('T1498', ['TA0040'], ['host'], 0), populationScoped: true }];
    const swept = (declared: AttackRunGroup) => evaluate(around([declared], {
      repertoire: [...FULL_CHAIN, ...wave],
      withoutInitialAccess: { key: 'outside_perimeter', share: 1, techniqueExternalIds: ['T1498'] },
    }));

    expect(reached(swept(group('fleet', 'host', 20, 'internet_facing')))).toBeCloseTo(atLeastOne(20 / SCENARIO_GROUP_BOOST_G), 12);
    expect(reached(swept(matched(group('crown', 'host', 20, 'internet_facing'))))).toBeCloseTo(atLeastOne(20), 12);
  });

  it('prices above zero with exposed assets and no group the scenario depends on', () => {
    expect(impact(evaluate(around([group('fleet', 'host', 3, 'internet_facing')])))).toBeGreaterThan(0);
  });

  it('never lowers the clear when one more exposed group is better defended than the others', () => {
    const repertoire = [...FULL_CHAIN, ...FLOOD.map((entry) => ({ ...entry, families: ['host', 'web_application'] as AttackRunTechnique['families'] }))];
    const defended = (groups: ReadonlyArray<AttackRunGroup>) => evaluate(
      around(groups, { repertoire, controls: [{ capabilityExternalId: 'EDR', preventTechniqueExternalIds: ['T1498', 'T1499'], detectTechniqueExternalIds: [] }] }),
      { states: [{ prevent: 0.9 }] },
    );
    const web = group('site', 'web_application', 3, 'internet_facing');
    const hosts = group('hosts', 'host', 40, 'internet_facing');

    expect(defended([web, hosts]).outcomes.blocked).toBeLessThan(defended([web]).outcomes.blocked);
  });

  it('reads no unexposed group', () => {
    const lonely = evaluate(around([group('edge', 'host', 2, 'internet_facing')]));
    const withLan = evaluate(around([group('lan', 'host', 50, 'internal'), group('edge', 'host', 2, 'internet_facing')]));

    expect(reached(withLan)).toBe(reached(lonely));
  });

  it('plays T1498 and T1499 on an internet-facing group and not on an internal one', () => {
    expect(impact(evaluate(around([group('edge', 'host', 3, 'internet_facing')])))).toBeGreaterThan(0);
    expect(impact(evaluate(around([group('lan', 'host', 3, 'internal')])))).toBe(0);
    expect(reached(evaluate(around([group('lan', 'host', 3, 'internal')])))).toBe(0);
  });

  it('reads an unknown exposure by the tenant setting, internal when it names none', () => {
    const unknown = [group('mixed', 'host', 3, 'unknown')];

    expect(reached(evaluate(around(unknown)))).toBe(0);
    expect(reached(evaluate(around(unknown, { unknownExposureCountsAs: 'internal' })))).toBe(0);
    expect(reached(evaluate(around(unknown, { unknownExposureCountsAs: 'internet_facing' })))).toBeCloseTo(atLeastOne(3 / SCENARIO_GROUP_BOOST_G), 12);
  });

  it('plays T1657 whatever the exposure', () => {
    for (const exposure of ['internal', 'internet_facing', 'unknown'] as const) {
      const result = evaluate(around([group('fleet', 'host', 20, exposure)], {
        repertoire: [...FULL_CHAIN, ...FRAUD],
        withoutInitialAccess: { key: 'access_held_or_outside_perimeter', share: 1, techniqueExternalIds: ['T1657'] },
      }));
      expect(reached(result)).toBeCloseTo(atLeastOne(20 / SCENARIO_GROUP_BOOST_G), 12);
    }
  });

  it('leaves the long and the direct chains their visits and every exposure', () => {
    const internal = [group('fleet', 'host', 20, 'internal')];
    const edge = [group('fleet', 'host', 20, 'internet_facing')];
    const plain = (groups: ReadonlyArray<AttackRunGroup>, over: Partial<AttackRunLawInputs> = {}): AttackRunEvaluation =>
      evaluate(law({ door: flooredDoor(1, 1), groups, ...over }));
    const withPath = (groups: ReadonlyArray<AttackRunGroup>): AttackRunEvaluation =>
      plain(groups, { repertoire: [...FULL_CHAIN, ...FLOOD], withoutInitialAccess: { key: 'outside_perimeter', share: 0, techniqueExternalIds: ['T1498', 'T1499'] } });

    for (const groups of [internal, edge]) {
      expect(withPath(groups)).toEqual(plain(groups));
    }
    expect(plain(internal).outcomes.blocked).toBeLessThan(1);
    expect(plain(internal).direct!.clearByObstacle[1]).toBeCloseTo(1 - (1 - attempt) ** Math.min(CONSTANTS.visitQuota, 20), 12);
  });
});

describe('the chain around the initial access, alone', () => {
  const FLOOD = [technique('T1498', ['TA0040'], ['host'], 0), technique('T1499', ['TA0040'], ['host'], 0)];
  const around = (share: number, door: DoorEstate = flooredDoor(1, 1)): AttackRunLawInputs => law({
    door,
    repertoire: [...FULL_CHAIN, ...FLOOD],
    groups: [group('fleet', 'host', 20, 'internet_facing')],
    withoutInitialAccess: { key: 'outside_perimeter', share, techniqueExternalIds: ['T1498', 'T1499'] },
  });

  it('plays no long and no direct chain at a share of one, whatever the door opens', () => {
    const result = evaluate(around(1), { familyUniform: 0 });

    expect(result.direct).toBeNull();
    expect(result.clearByObstacle).toEqual([result.clearByObstacle[0], ...FULL_CHAIN.slice(1).map(() => 0)]);
    expect(result.firstDetectionAtObstacle.every((value) => value === 0)).toBe(true);
    expect([result.reachedUnseen, result.unseen, result.firstDetectionAtAnchoring, result.eviction, result.detectPosture]).toEqual([0, 0, 0, 0, 0]);
    expect(result.reach).toBe(1 - result.outcomes.blocked);
    expect(impact(result)).toBeGreaterThan(0);
  });

  it('keeps the whole door in the first clear at a share of one', () => {
    const door = flooredDoor(1, 1);
    const alone = evaluate(around(1, door), { familyUniform: 0 });
    const mixed = evaluate(around(0.5, door), { familyUniform: 0 });

    expect(alone.clearByObstacle[0]).toBe(mixed.clearByObstacle[0]);
  });

  it('prices a share just under one by its long chain, which stays played', () => {
    const result = evaluate(around(0.999), { familyUniform: 0 });

    expect(result.clearByObstacle.slice(1).some((clear) => clear > 0)).toBe(true);
    expect(result.direct).not.toBeNull();
  });
});

describe('the unplayable chain around the initial access', () => {
  const FLOOD = [technique('T1498', ['TA0040'], ['host'], 0), technique('T1499', ['TA0040'], ['host'], 0)];
  const unplayable = (exposure: AttackRunGroup['exposure'], share: number): ReadonlyArray<string> => compileAttackRunLaw(law({
    door: flooredDoor(1, 1),
    repertoire: [...FULL_CHAIN, ...FLOOD],
    groups: [group('fleet', 'host', 20, exposure)],
    withoutInitialAccess: { key: 'outside_perimeter', share, techniqueExternalIds: ['T1498', 'T1499'] },
  })).unplayableObstacleKeys;

  it('is named by its path key when no group is exposed', () => {
    expect(unplayable('internal', 1)).toEqual(['outside_perimeter']);
    expect(unplayable('unknown', 0.05)).toEqual(['outside_perimeter']);
  });

  it('is not named when an exposed group plays it', () => {
    expect(unplayable('internet_facing', 1)).toEqual([]);
  });

  it('is not named when no attack takes it', () => {
    expect(unplayable('internal', 0)).toEqual([]);
  });

  const withoutDeepAccess = (exposure: AttackRunGroup['exposure'], share: number): ReadonlyArray<string> => compileAttackRunLaw(law({
    door: flooredDoor(1, 1),
    repertoire: [...WITHOUT_DEEP_ACCESS, ...FLOOD],
    groups: [group('fleet', 'host', 20, exposure)],
    withoutInitialAccess: { key: 'outside_perimeter', share, techniqueExternalIds: ['T1498', 'T1499'] },
  })).unplayableObstacleKeys;

  it('is named beside the walk obstacle the repertoire cannot play while some attacks take the long chain', () => {
    expect(withoutDeepAccess('internal', 0.05)).toEqual(['deep_access', 'outside_perimeter']);
  });

  it('names no walk obstacle when every attack goes around the door', () => {
    expect(withoutDeepAccess('internal', 1)).toEqual(['outside_perimeter']);
    expect(withoutDeepAccess('internet_facing', 1)).toEqual([]);
  });
});

describe('the noticed share on the chain around the initial access', () => {
  const FLOOD = [technique('T1498', ['TA0040'], ['host'], 0), technique('T1499', ['TA0040'], ['host'], 0)];
  const WATCH = { capabilityExternalId: 'EDR', preventTechniqueExternalIds: [], detectTechniqueExternalIds: ['T1498', 'T1499'] };
  const flooded = (share: number, controls: AttackRunLawInputs['controls']): AttackRunLawInputs => law({
    door: flooredDoor(1, 1),
    repertoire: [...FULL_CHAIN, ...FLOOD],
    groups: [group('edge', 'host', 20, 'internet_facing')],
    controls,
    withoutInitialAccess: { key: 'outside_perimeter', share, techniqueExternalIds: ['T1498', 'T1499'] },
  });

  it('leaves no impact unnoticed when every exposed group is fully watched', () => {
    const result = evaluate(flooded(1, [WATCH]), { states: [{ detect: 1 - 1e-12 }] });

    expect(impact(result)).toBeGreaterThan(0);
    expect(result.outcomes.impactUndetected).toBeCloseTo(0, 9);
  });

  it('leaves no impact noticed when nothing watches the exposed groups', () => {
    const result = evaluate(flooded(1, []));

    expect(impact(result)).toBeGreaterThan(0);
    expect(result.outcomes.impactDetected).toBeCloseTo(0, 12);
  });

  it('reads the detect posture itself, not the share a stealthy intrusion is found later', () => {
    const half = evaluate(flooded(1, [WATCH]), { states: [{ detect: 0.5 }] });
    const share = half.outcomes.impactDetected / impact(half);

    expect(share).toBeGreaterThan(0.45);
    expect(1 - Math.exp(-CONSTANTS.postDetectionRate * 0.5)).toBeLessThan(0.3);
  });

  it('leaves the long chain of a law with no share around the door where it was', () => {
    const states = [{ detect: 0.5 }];
    const withPath = evaluate(flooded(0, [WATCH]), { states });
    const longOnly = evaluate(law({ door: flooredDoor(1, 1), groups: [group('edge', 'host', 20, 'internet_facing')], controls: [WATCH] }), { states });

    expect(withPath).toEqual(longOnly);
  });
});

describe('the long chain alone', () => {
  it('keeps the door whole, so no target and no share changes a partition', () => {
    const result = evaluate(law({ door: flooredDoor(3, 0) }));
    expect(result.reach).toBe(result.clearByObstacle.reduce((product, clear) => product * clear, 1));
    expect(result.outcomes.blocked).toBe(1 - result.reach);
  });
});
