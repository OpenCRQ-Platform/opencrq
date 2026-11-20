import { describe, expect, it } from 'vitest';
import type { PertRange } from './attack-run-worlds';
import type { EngineRunControl, EngineRunInputs } from './engine-run';
import { fixtureWorlds, lawInputsFromFixture } from './attack-run-bench-harness';
import { ATTACK_RUN_FIXTURES, catalogueCoverage } from './attack-run-fixtures';
import { actorClassKnobs, DEFAULT_REACTION_TIME_HOURS } from './attack-run-constants';
import { evaluateAttackRun, inTimeByPosition, prepareWorld, refreshWorld, remainingHours } from './attack-run-evaluation';
import { compileAttackRunLaw } from './attack-run-law';
import { worldDrawAt } from './attack-run-worlds';
import { pertBelow, pertQuantile } from './distributions';
import { createEngineRun } from './engine-run';
import { pricedFraction } from './priced-fraction';
import { createPrng, deriveSeed } from './prng';

const WORLDS = 512;
const FIXTURE = ATTACK_RUN_FIXTURES.find((candidate) => candidate.name === 'uneven-estate')!;

const heldTo = (hours: number): PertRange => ({ min: hours, likely: hours, max: hours });

/** One reaction time per world at the stratified quantiles of the range, as a per-world draw reads it. */
const stratifiedReactionTimes = (range: PertRange, worlds: number, seed: string): Float64Array => {
  const cells = Array.from({ length: worlds }, (_, cell) => cell);
  const random = createPrng(deriveSeed(seed, 'reaction-time'));
  for (let index = worlds - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [cells[index], cells[swap]] = [cells[swap], cells[index]];
  }
  return Float64Array.from(cells, (cell) => pertQuantile(range.min, range.likely, range.max, (cell + 0.5) / worlds));
};

const varianceOf = (values: ReadonlyArray<number>): number => {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
};

describe('the probability of reacting in time', () => {
  it('reads the reaction time PERT below each window', () => {
    for (const probability of [0.05, 0.25, 0.5, 0.75, 0.95]) {
      const { min, likely, max } = DEFAULT_REACTION_TIME_HOURS;
      expect(pertBelow(min, likely, max, pertQuantile(min, likely, max, probability))).toBeCloseTo(probability, 9);
    }
    expect(pertBelow(0.5, 8, 96, 0.5)).toBe(0);
    expect(pertBelow(0.5, 8, 96, 96)).toBe(1);
  });

  it('reads a reaction time held to one value as a step, strictly below the window', () => {
    expect(pertBelow(8, 8, 8, 8.001)).toBe(1);
    expect(pertBelow(8, 8, 8, 8)).toBe(0);
    expect(inTimeByPosition(heldTo(30), 5, 5)).toEqual(Float64Array.from([1, 1, 1, 1, 0, 0]));
  });

  it('falls along the chain, as the window left to react shrinks', () => {
    const inTime = inTimeByPosition(DEFAULT_REACTION_TIME_HOURS, 1, 5);
    expect([...inTime]).toEqual([...inTime].sort((one, other) => other - one));
    expect(inTime[5]).toBe(0);
  });

  /*
   * A per-world draw is the stratified estimate of the same probability: over the worlds, the share
   * reacting in time within each window is the PERT's own to one cell. The eviction is linear in
   * it, so replacing the draw moves the mean ALE by sampling noise alone.
   */
  it('moves the mean ALE of a declared posture by sampling noise only', () => {
    const law = compileAttackRunLaw(lawInputsFromFixture(FIXTURE));
    const reactionTimeHours = FIXTURE.reactionTimeHours;
    const worlds = fixtureWorlds(FIXTURE, law.obstacles.length, WORLDS, 'reaction-time');
    const drawn = stratifiedReactionTimes(reactionTimeHours, WORLDS, 'reaction-time');
    const inTime = inTimeByPosition(reactionTimeHours, law.inputs.actorClass.attackRunDays, law.obstacles.length);
    for (let position = 1; position <= law.obstacles.length; position += 1) {
      const window = remainingHours(law.inputs.actorClass.attackRunDays, law.obstacles.length, position);
      const share = drawn.filter((hours) => hours < window).length / WORLDS;
      expect(Math.abs(share - inTime[position])).toBeLessThanOrEqual(1 / WORLDS);
    }

    const world = prepareWorld(law, worldDrawAt(worlds, 0));
    const read = Array.from({ length: WORLDS }, () => 0);
    const perWorld = Array.from({ length: WORLDS }, () => 0);
    for (let index = 0; index < WORLDS; index += 1) {
      const draw = worldDrawAt(worlds, index);
      refreshWorld(world, draw);
      read[index] = pricedFraction(evaluateAttackRun(world).outcomes);
      refreshWorld(world, { ...draw, reactionTimeHours: heldTo(drawn[index]) });
      perWorld[index] = pricedFraction(evaluateAttackRun(world).outcomes);
    }
    const differences = read.map((value, index) => value - perWorld[index]);
    const meanDifference = differences.reduce((sum, value) => sum + value, 0) / WORLDS;
    const standardError = Math.sqrt(varianceOf(differences) / WORLDS);
    const meanRead = read.reduce((sum, value) => sum + value, 0) / WORLDS;
    expect(standardError).toBeGreaterThan(0);
    expect(Math.abs(meanDifference)).toBeLessThanOrEqual(4 * standardError);
    expect(Math.abs(meanDifference) / meanRead).toBeLessThan(0.02);
  });

  it('reports the probability of exceeding even the door window as the share of windows exceeded', () => {
    const controls: ReadonlyArray<EngineRunControl> = FIXTURE.controls.map((fixtureControl) => ({
      controlId: fixtureControl.capabilityExternalId,
      capabilityExternalId: fixtureControl.capabilityExternalId,
      strengthRung: 'L2',
      coverageBucket: 'L2',
      preventTechniqueExternalIds: catalogueCoverage(fixtureControl.capabilityExternalId, 'prevent'),
      detectTechniqueExternalIds: catalogueCoverage(fixtureControl.capabilityExternalId, 'detect'),
    }));
    const inputs: EngineRunInputs = {
      terminalTacticExternalId: FIXTURE.terminalTacticExternalId,
      controls,
      actors: [{
        key: 'opportunistic',
        name: null,
        actorClass: 'opportunistic_crime',
        knobs: actorClassKnobs('opportunistic_crime'),
        share: 1,
        repertoire: FIXTURE.repertoire,
        groups: FIXTURE.groups,
      }],
      tef: { min: 1, likely: 1, max: 1 },
      lossDrivers: [{ min: 1, likely: 1, max: 1 }],
      reactionTimeHours: DEFAULT_REACTION_TIME_HOURS,
      constants: FIXTURE.constants,
      door: FIXTURE.door,
      phishing: { declaredSusceptibility: null },
      unknownExposureCountsAs: 'internal',
      unknownCriticalityCountsAs: 'low',
      worlds: 4,
      seed: 'reaction-time',
    };
    const run = createEngineRun(inputs);
    run.advance(inputs.worlds);
    const result = run.result();
    const doorWindow = remainingHours(actorClassKnobs('opportunistic_crime').attackRunDays, 5, 1);
    const { min, likely, max } = DEFAULT_REACTION_TIME_HOURS;
    expect(result.actors[0].reactionTimeExceededShare).toBe(1 - pertBelow(min, likely, max, doorWindow));
    expect(result.actors[0].reactionTimeExceededShare).toBeGreaterThan(0);
    expect(result.actors[0].reactionTimeExceededShare).toBeLessThan(1);
  });
});
