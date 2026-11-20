import { describe, expect, it } from 'vitest';
import type { AttackRunControlDeclaration } from './attack-run-worlds';
import { coverageCoefficient, STRENGTH_RUNGS } from '../../controls/capability/constants';
import { buildAttackRunWorlds, controlStateAt, controlWorldSpec, DECLARED_LEVER, declaredPreventEfficacy, declaredStrength, targetStateAt, worldDrawAt } from './attack-run-worlds';

/**
 * The world layer's own properties: the ones that make a difference between two evaluations mean
 * something. They are asserted by equality wherever the specification says exactly, because a
 * tolerance here would hide the very drift the construction exists to remove.
 */

const WORLDS = 1000;

const declaration = (
  capabilityExternalId: string,
  over: Partial<AttackRunControlDeclaration> = {},
): AttackRunControlDeclaration => ({
  capabilityExternalId,
  strengthRung: 'L2',
  coverageBucket: 'L2',
  ...over,
});

const worldsOf = (
  declarations: ReadonlyArray<AttackRunControlDeclaration>,
  seed = 'seed',
  specOptions: Parameters<typeof controlWorldSpec>[1] = {},
  ids: { readonly cveIds?: ReadonlyArray<string>, readonly familyIds?: ReadonlyArray<string> } = {},
): ReturnType<typeof buildAttackRunWorlds> =>
  buildAttackRunWorlds({
    controls: declarations.map((entry) => controlWorldSpec(entry, specOptions)),
    obstacleCount: 5,
    reactionTimeHours: { min: 0.5, likely: 8, max: 96 },
    worlds: WORLDS,
    seed,
    cveIds: ids.cveIds ?? [],
    familyIds: ids.familyIds ?? [],
  });

const everyWorld = <T>(read: (world: number) => T): Array<T> => Array.from({ length: WORLDS }, (_, world) => read(world));

describe('a control in every world', () => {
  it('reads the same strength and coverage in every world', () => {
    const columns = worldsOf([
      declaration('EDR', { strengthRung: 'L1', coverageBucket: 'L2' }),
      declaration('IDP', { strengthRung: 'L3', coverageBucket: 'L3' }),
    ]);
    const first = worldDrawAt(columns, 0);
    for (let world = 1; world < WORLDS; world += 1) {
      const draw = worldDrawAt(columns, world);
      expect(draw.preventEfficacy).toEqual(first.preventEfficacy);
      expect(draw.detectEfficacy).toEqual(first.detectEfficacy);
      expect(draw.deployed).toEqual(first.deployed);
    }
    expect(first.preventEfficacy[0]).toBe(declaredStrength('L1') * 0.7);
    expect(first.preventEfficacy[1]).toBe(declaredStrength('L3'));
  });

  it('reads the reaction time as the range declared, in every world', () => {
    const columns = worldsOf([declaration('EDR')]);
    expect(everyWorld((world) => worldDrawAt(columns, world).reactionTimeHours).every((range) => range === columns.reactionTimeHours)).toBe(true);
    expect(columns.reactionTimeHours).toEqual({ min: 0.5, likely: 8, max: 96 });
  });
});

describe('the coverage', () => {
  it('folds the declared coverage into the efficacy', () => {
    const [control] = worldsOf([declaration('EDR', { coverageBucket: 'L2' })]).controls;
    const state = controlStateAt(control, DECLARED_LEVER);
    expect(state.deployed).toBe(true);
    expect(state.preventEfficacy).toBe(control.prevent.strength * 0.7);
    expect(state.detectEfficacy).toBe(control.detect.strength * 0.7);
  });

  it('reads a full coverage as the strength, bit for bit', () => {
    const [control] = worldsOf([declaration('EDR', { coverageBucket: 'L3' })]).controls;
    const state = controlStateAt(control, DECLARED_LEVER);
    expect(state.deployed).toBe(true);
    expect(state.preventEfficacy).toBe(control.prevent.strength);
  });

  it('leaves a control at no coverage absent, its efficacy nil', () => {
    const [control] = worldsOf([declaration('EDR', { coverageBucket: 'L0' })]).controls;
    expect(controlStateAt(control, DECLARED_LEVER)).toEqual({ deployed: false, preventEfficacy: 0, detectEfficacy: 0 });
    expect(worldDrawAt(worldsOf([declaration('EDR', { coverageBucket: 'L0' })]), 3).deployed).toEqual([false]);
  });

  it('reads the upgraded coverage on the coverage lever and the bucket a target names', () => {
    const [control] = worldsOf([declaration('EDR', { coverageBucket: 'L1' })]).controls;
    const { strength } = control.prevent;
    expect(controlStateAt(control, { strength: 'declared', coverage: 'upgraded' }).preventEfficacy).toBe(strength * 0.7);
    expect(targetStateAt(control, { strengthRung: 'L2', coverageBucket: 'L3' }).preventEfficacy).toBe(strength);
    expect(targetStateAt(control, { strengthRung: 'L2', coverageBucket: 'L0' }).deployed).toBe(false);
  });
});

const below = (column: Float64Array, probability: number): number => [...column].filter((uniform) => uniform < probability).length;

describe('the knockout draw per control and obstacle', () => {
  /*
   * Validation property 3. Stratification holds exactly one point per `1/N` cell, so the share under
   * a threshold is that threshold and not a binomial count around it.
   */
  it('stratifies each column exactly', () => {
    const [control] = worldsOf([declaration('EDR')]).controls;
    expect(control.knockout).toHaveLength(5);
    expect(below(control.knockout[0], 0.7)).toBe(0.7 * WORLDS);
    expect(below(control.knockout[4], 0.4)).toBe(0.4 * WORLDS);
  });

  /*
   * Validation property 8: every draw is keyed by stable control identity, never by iteration
   * order, which is what lets a baseline and a what-if share their worlds when the control set
   * differs. Removing a control from the set must leave every other column untouched.
   */
  it('leaves every other control untouched when one is removed from the set', () => {
    const full = worldsOf([declaration('EDR'), declaration('IDP'), declaration('NGFW')]);
    const without = worldsOf([declaration('EDR'), declaration('NGFW')]);
    expect(without.controls[0]).toEqual(full.controls[0]);
    expect(without.controls[1]).toEqual(full.controls[2]);
  });

  it('replays identically on a fixed seed', () => {
    expect(worldsOf([declaration('EDR')]).controls[0]).toEqual(worldsOf([declaration('EDR')]).controls[0]);
  });
});

const exploitDraws = (cveIds: ReadonlyArray<string>, familyIds: ReadonlyArray<string> = [], seed = 'seed'): ReturnType<typeof buildAttackRunWorlds> =>
  worldsOf([], seed, {}, { cveIds, familyIds });

describe('the exploit draw per CVE and the unknown flaw draw per family', () => {
  /*
   * A column is stratified: the share of worlds under a probability is that probability to the
   * unit, so a flaw exploited at 0.05 is exploited in 50 worlds of 1,000 and not in a binomial count
   * around them.
   */
  it.each([0.05, 0.9])('realises a probability of %s on a column to the unit', (probability) => {
    const columns = exploitDraws(['CVE-2021-44228', 'CVE-2024-0001'], ['host', 'identity']);
    for (const column of [...columns.cveUniform, ...columns.familyUniform]) {
      expect(column).toHaveLength(WORLDS);
      expect(Math.abs(below(column, probability) - Math.round(probability * WORLDS))).toBeLessThanOrEqual(1);
    }
  });

  it('draws one column per id, in the order given', () => {
    const columns = exploitDraws(['CVE-A', 'CVE-B', 'CVE-C'], ['host', 'identity']);
    expect(columns.cveUniform).toHaveLength(3);
    expect(columns.familyUniform).toHaveLength(2);
    expect([...columns.cveUniform[0]]).not.toEqual([...columns.cveUniform[1]]);
    expect([...columns.familyUniform[0]]).not.toEqual([...columns.familyUniform[1]]);
  });

  it('leaves every other CVE untouched when one is removed from the set', () => {
    const full = exploitDraws(['CVE-A', 'CVE-B', 'CVE-C']);
    const without = exploitDraws(['CVE-A', 'CVE-C']);
    expect([...without.cveUniform[0]]).toEqual([...full.cveUniform[0]]);
    expect([...without.cveUniform[1]]).toEqual([...full.cveUniform[2]]);
  });

  it('leaves every other family untouched when one is removed from the set', () => {
    const full = exploitDraws([], ['host', 'identity', 'network']);
    const without = exploitDraws([], ['host', 'network']);
    expect([...without.familyUniform[0]]).toEqual([...full.familyUniform[0]]);
    expect([...without.familyUniform[1]]).toEqual([...full.familyUniform[2]]);
  });

  it('gives an id the same column wherever it sits in the input', () => {
    const forward = exploitDraws(['CVE-A', 'CVE-B', 'CVE-C'], ['host', 'identity']);
    const reversed = exploitDraws(['CVE-C', 'CVE-B', 'CVE-A'], ['identity', 'host']);
    expect([...reversed.cveUniform[2]]).toEqual([...forward.cveUniform[0]]);
    expect([...reversed.cveUniform[0]]).toEqual([...forward.cveUniform[2]]);
    expect([...reversed.familyUniform[1]]).toEqual([...forward.familyUniform[0]]);
  });

  it('does not move a control column when ids are added', () => {
    const bare = worldsOf([declaration('EDR')]);
    const withIds = worldsOf([declaration('EDR')], 'seed', {}, { cveIds: ['CVE-A'], familyIds: ['host'] });
    expect(withIds.controls[0]).toEqual(bare.controls[0]);
  });

  it('keeps a CVE column apart from a family column of the same name, and from another seed', () => {
    const columns = exploitDraws(['host'], ['host']);
    expect([...columns.cveUniform[0]]).not.toEqual([...columns.familyUniform[0]]);
    expect([...exploitDraws(['host'], [], 'other').cveUniform[0]]).not.toEqual([...columns.cveUniform[0]]);
  });

  it('replays identically on a fixed seed', () => {
    const one = exploitDraws(['CVE-A', 'CVE-B'], ['host']);
    const other = exploitDraws(['CVE-A', 'CVE-B'], ['host']);
    expect(other.cveUniform).toEqual(one.cveUniform);
    expect(other.familyUniform).toEqual(one.familyUniform);
  });

  it('reads one value per CVE and per family in each world', () => {
    const columns = exploitDraws(['CVE-A', 'CVE-B'], ['host', 'identity', 'network']);
    const draw = worldDrawAt(columns, 17);
    expect([...draw.cveUniform]).toEqual([columns.cveUniform[0][17], columns.cveUniform[1][17]]);
    expect([...draw.familyUniform]).toEqual([0, 1, 2].map((index) => columns.familyUniform[index][17]));
  });
});

describe('the strength', () => {
  it('reads the rung ladder, and nothing at L0', () => {
    expect(worldsOf([declaration('EDR', { strengthRung: 'L0' })]).controls[0].prevent.strength).toBe(0);
    const strengths = STRENGTH_RUNGS.map((rung) => worldsOf([declaration('EDR', { strengthRung: rung })]).controls[0].prevent.strength);
    expect(strengths).toEqual(STRENGTH_RUNGS.map(declaredStrength));
    expect(strengths).toEqual([...strengths].sort((one, other) => one - other));
  });

  it('upgrades to the next rung, which the top rung does not have', () => {
    const [control] = worldsOf([declaration('EDR', { strengthRung: 'L1' })]).controls;
    expect(control.prevent.upgradedStrength).toBe(declaredStrength('L2'));
    expect(control.strengthIsMaximal).toBe(false);
    expect(worldsOf([declaration('EDR', { strengthRung: 'L3' })]).controls[0].strengthIsMaximal).toBe(true);
  });

  /* A plan whose single move is a one-step upgrade answers what that control's own lever answers. */
  it('reads the next rung as a target exactly as the upgraded arm', () => {
    const [control] = worldsOf([declaration('EDR', { strengthRung: 'L1' })]).controls;
    expect(targetStateAt(control, { strengthRung: 'L2', coverageBucket: 'L2' }))
      .toEqual(controlStateAt(control, { strength: 'upgraded', coverage: 'declared' }));
  });

  /* A plan that asks for what is already in place is priced at exactly the baseline rather than near it. */
  it('reads a target equal to the declaration as the declared state', () => {
    const [control] = worldsOf([declaration('EDR', { strengthRung: 'L2' })]).controls;
    expect(targetStateAt(control, { strengthRung: 'L2', coverageBucket: 'L2' })).toEqual(controlStateAt(control, DECLARED_LEVER));
  });

  it('never lowers the efficacy when a target raises the rung', () => {
    const [control] = worldsOf([declaration('EDR', { strengthRung: 'L1' })]).controls;
    const efficacies = STRENGTH_RUNGS.map((rung) => targetStateAt(control, { strengthRung: rung, coverageBucket: 'L2' }).preventEfficacy);
    expect(efficacies).toEqual([...efficacies].sort((one, other) => one - other));
  });
});

describe('the efficacy of a control', () => {
  it('is the declared strength times the declared coverage, on each function', () => {
    const [control] = worldsOf([declaration('EDR', { strengthRung: 'L1', coverageBucket: 'L2' })]).controls;
    const state = controlStateAt(control, DECLARED_LEVER);
    expect(state.preventEfficacy).toBe(declaredStrength('L1') * coverageCoefficient('L2'));
    expect(state.detectEfficacy).toBe(declaredStrength('L1') * coverageCoefficient('L2'));
  });

  it('is declaredPreventEfficacy', () => {
    const spec = controlWorldSpec(declaration('EDR', { strengthRung: 'L1', coverageBucket: 'L2' }));
    expect(declaredPreventEfficacy(spec)).toBe(declaredStrength('L1') * coverageCoefficient('L2'));
  });
});
