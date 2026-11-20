import type { CoverageBucket, StrengthReferenceRung, StrengthRung } from '../../controls/capability/constants';
import type { AttackRunControlState, AttackRunWorldDraw } from './attack-run-evaluation';
import type { PhishingStageName } from './attack-run-constants';
import type { AttackRunDeclaredKind } from './attack-run-law';
import {
  COVERAGE_BUCKETS,
  coverageCoefficient,
  STRENGTH_BY_RUNG,
  STRENGTH_RUNGS,
} from '../../controls/capability/constants';
import { ATTACK_RUN_THETA_CAP, phishingStageAnchorOf } from './attack-run-constants';
import { createPrng, deriveSeed } from './prng';

/**
 * The worlds a run is evaluated on: one hypothesis per world about what holds for a whole year,
 * and nothing about the attack.
 *
 * A control is read at its declared strength and coverage in every world. What a
 * world draws is what holds for the year: which CVE exploits circulate, which families hold an
 * unknown flaw, and the uniforms the sabotage knockouts are decided against. Each drawn quantity
 * owns a **shuffled permutation of the unit interval's `N` cells**, keyed by a stable identity, and
 * world `i` reads cell `i` of it. Two consequences the engine cannot do without:
 *
 * - **Exact marginals.** The share of worlds whose uniform falls below a threshold equals that
 *   threshold exactly, not within a binomial tolerance, and raising the threshold flips exactly the
 *   worlds between the two rather than a binomial count around them.
 * - **Shared worlds.** Removing a control or a CVE from the set shifts no other draw, because
 *   nothing is keyed on iteration order, so a baseline and a what-if differ by the perturbation
 *   alone and their difference carries no simulation noise.
 *
 * Coverage is the share of the assets a control protects, so it multiplies the efficacy at every
 * attempt, `theta x c`, and an attacker visiting several assets meets the uncovered ones.
 */

/** One function of a control, prevention or detection, at its declaration and one step up. */
export interface AttackRunAxisValues {
  readonly strength: number,
  readonly upgradedStrength: number,
}

/** The strength a control reads at its own phishing stage, where a stage anchor stands in for the shared rung scale. */
export interface AttackRunStageStrength {
  readonly strength: number,
  readonly upgradedStrength: number,
  readonly byRung: Readonly<Record<StrengthReferenceRung, number>>,
}

export interface AttackRunControlWorldSpec {
  readonly capabilityExternalId: string,
  readonly coverage: number,
  readonly upgradedCoverage: number,
  readonly prevent: AttackRunAxisValues,
  readonly detect: AttackRunAxisValues,
  /** Absent for a control with no anchor at the stage its edges place it at: its prevent strength is read there too. */
  readonly phishingStage?: AttackRunStageStrength,
}

export interface AttackRunControlDeclaration {
  readonly capabilityExternalId: string,
  readonly strengthRung: StrengthRung,
  readonly coverageBucket: CoverageBucket,
}

export interface ControlWorldColumns extends AttackRunControlWorldSpec {
  /** One column per obstacle: the knockout is redrawn at every obstacle and never carried forward. */
  readonly knockout: ReadonlyArray<Float64Array>,
  /** The strength lever has nowhere to go: the control already declares the top rung. */
  readonly strengthIsMaximal: boolean,
  /** The coverage lever has nowhere to go: the control already declares full coverage. */
  readonly coverageIsMaximal: boolean,
}

export interface AttackRunWorlds {
  readonly worlds: number,
  readonly controls: ReadonlyArray<ControlWorldColumns>,
  readonly reactionTimeHours: PertRange,
  /**
   * Per CVE, in the order given, the uniform its exploit in circulation is decided against.
   * Keyed by the CVE's `cve` row id, so a flaw priced alone and the same flaw priced among
   * thousands read the same worlds.
   */
  readonly cveUniform: Array<Float64Array>,
  /** Per family, in the order given, the uniform its unknown flaw floor is decided against. */
  readonly familyUniform: Array<Float64Array>,
  /** The drawn kinds, in the order given, and per kind the uniform its count is read from. */
  readonly declaredKinds: ReadonlyArray<AttackRunDeclaredKind>,
  readonly declaredUniform: Array<Float64Array>,
}

export interface PertRange {
  readonly min: number,
  readonly likely: number,
  readonly max: number,
}

export const nextStrengthRung = (rung: StrengthRung): StrengthRung =>
  STRENGTH_RUNGS[Math.min(STRENGTH_RUNGS.indexOf(rung) + 1, STRENGTH_RUNGS.length - 1)];

export const nextCoverageBucket = (bucket: CoverageBucket): CoverageBucket =>
  COVERAGE_BUCKETS[Math.min(COVERAGE_BUCKETS.indexOf(bucket) + 1, COVERAGE_BUCKETS.length - 1)];

/**
 * A control's strength: the shared rung ladder the finding score also reads. `L0` instantiates no
 * edge at all, which is the undeployed anchor and not a weak control. Coverage does not enter it:
 * the world layer multiplies it into the efficacy.
 */
export const declaredStrength = (rung: StrengthRung): number =>
  (rung === 'L0' ? 0 : Math.min(STRENGTH_BY_RUNG[rung], ATTACK_RUN_THETA_CAP));

/** A rung's anchor; `L0` instantiates no edge, so it carries no strength at the stage either. */
export const anchoredStrength = (byRung: Readonly<Record<StrengthReferenceRung, number>>, rung: StrengthRung): number =>
  (rung === 'L0' ? 0 : byRung[rung]);

/**
 * What a tenant's declaration means to the world layer, one control at a time. `phishingStage` is the
 * stage of a phishing campaign the control's prevent edges place it at: where an anchor exists for
 * the capability there, the stage reads that strength and not the shared scale's.
 */
export const controlWorldSpec = (
  declaration: AttackRunControlDeclaration,
  { phishingStage = null }: { phishingStage?: PhishingStageName | null } = {},
): AttackRunControlWorldSpec => {
  const axis: AttackRunAxisValues = {
    strength: declaredStrength(declaration.strengthRung),
    upgradedStrength: declaredStrength(nextStrengthRung(declaration.strengthRung)),
  };
  const anchor = phishingStageAnchorOf(declaration.capabilityExternalId, phishingStage);
  return {
    capabilityExternalId: declaration.capabilityExternalId,
    coverage: coverageCoefficient(declaration.coverageBucket),
    upgradedCoverage: coverageCoefficient(nextCoverageBucket(declaration.coverageBucket)),
    prevent: axis,
    detect: axis,
    ...(anchor === null ? {} : {
      phishingStage: {
        strength: anchoredStrength(anchor, declaration.strengthRung),
        upgradedStrength: anchoredStrength(anchor, nextStrengthRung(declaration.strengthRung)),
        byRung: anchor,
      },
    }),
  };
};

/** The `N` stratification cell centres read through one shuffled permutation, seeded by a stable identity. */
const uniformColumn = (size: number, seed: number): Float64Array => {
  const cells = new Int32Array(size);
  for (let index = 0; index < size; index += 1) {
    cells[index] = index;
  }
  const random = createPrng(seed);
  for (let index = size - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const held = cells[index];
    cells[index] = cells[swap];
    cells[swap] = held;
  }
  const values = new Float64Array(size);
  for (let index = 0; index < size; index += 1) {
    values[index] = (cells[index] + 0.5) / size;
  }
  return values;
};

/**
 * A drawn kind's count in a world: uniform on a log scale between its bounds, as many chances
 * between 251 and 500 as between 500 and 1,000, and uniform on a range starting at 0, rounded to
 * an integer. What returns is the internal virtual assets, the draw less what the kind holds.
 */
export const declaredVirtualCount = (declared: AttackRunDeclaredKind, uniform: number): number => {
  const { low, high } = declared;
  const drawn = low === 0 ? uniform * high : low * (high / low) ** uniform;
  return Math.max(0, Math.min(high, Math.max(low, Math.round(drawn))) - declared.held);
};

export const buildAttackRunWorlds = ({
  controls, obstacleCount, reactionTimeHours, worlds, seed, cveIds, familyIds, declaredKinds = [],
}: {
  controls: ReadonlyArray<AttackRunControlWorldSpec>,
  obstacleCount: number,
  reactionTimeHours: PertRange,
  worlds: number,
  seed: string,
  cveIds: ReadonlyArray<string>,
  familyIds: ReadonlyArray<string>,
  declaredKinds?: ReadonlyArray<AttackRunDeclaredKind>,
}): AttackRunWorlds => ({
  worlds,
  controls: controls.map((spec) => ({
    ...spec,
    knockout: Array.from({ length: obstacleCount }, (_, obstacleIndex) =>
      uniformColumn(worlds, deriveSeed(seed, `knockout:${obstacleIndex}:${spec.capabilityExternalId}`))),
    strengthIsMaximal: spec.prevent.strength === spec.prevent.upgradedStrength
      && spec.detect.strength === spec.detect.upgradedStrength,
    coverageIsMaximal: spec.coverage === spec.upgradedCoverage,
  })),
  reactionTimeHours,
  cveUniform: cveIds.map((cveId) => uniformColumn(worlds, deriveSeed(seed, `cve:${cveId}`))),
  familyUniform: familyIds.map((familyId) => uniformColumn(worlds, deriveSeed(seed, `floor:${familyId}`))),
  declaredKinds,
  declaredUniform: declaredKinds.map((declared) => uniformColumn(worlds, deriveSeed(seed, `declared:${declared.kind}`))),
});

export interface ControlLever {
  readonly strength: 'declared' | 'upgraded',
  readonly coverage: 'declared' | 'upgraded',
}

export const DECLARED_LEVER: ControlLever = { strength: 'declared', coverage: 'declared' };

/**
 * A control at no coverage is absent, so it is never offered to sabotage. The coverage multiplies
 * last: at full coverage the efficacy is the strength bit for bit.
 */
const stateOf = (coverage: number, prevent: number, detect: number, stagePrevent?: number): AttackRunControlState => ({
  deployed: coverage > 0,
  preventEfficacy: prevent * coverage,
  detectEfficacy: detect * coverage,
  ...(stagePrevent === undefined ? {} : { phishingStageEfficacy: stagePrevent * coverage }),
});

const axisEfficacy = (axis: AttackRunAxisValues, lever: ControlLever): number =>
  (lever.strength === 'declared' ? axis.strength : axis.upgradedStrength);

/** The anchored strength at the lever's rung. */
const stageEfficacy = (spec: AttackRunControlWorldSpec, lever: ControlLever): number | undefined =>
  (spec.phishingStage === undefined
    ? undefined
    : (lever.strength === 'declared' ? spec.phishingStage.strength : spec.phishingStage.upgradedStrength));

export const controlStateAt = (spec: AttackRunControlWorldSpec, lever: ControlLever): AttackRunControlState => stateOf(
  lever.coverage === 'declared' ? spec.coverage : spec.upgradedCoverage,
  axisEfficacy(spec.prevent, lever),
  axisEfficacy(spec.detect, lever),
  stageEfficacy(spec, lever),
);

/**
 * What a control prevents in every world at its declaration, which the law reads to price what the
 * declared posture already holds without waiting for a world. It is the world's own efficacy, not a
 * second computation of it.
 */
export const declaredPreventEfficacy = (spec: AttackRunControlWorldSpec): number =>
  controlStateAt(spec, DECLARED_LEVER).preventEfficacy;

export interface ControlTarget {
  readonly strengthRung: StrengthRung,
  readonly coverageBucket: CoverageBucket,
}

/**
 * One control at a target posture. Written beside `controlStateAt` rather than as a third value of
 * `ControlLever`: that union is read by ternaries, which would route an unknown value to the
 * upgraded arm in silence.
 */
export const targetStateAt = (columns: ControlWorldColumns, target: ControlTarget): AttackRunControlState => stateOf(
  coverageCoefficient(target.coverageBucket),
  declaredStrength(target.strengthRung),
  declaredStrength(target.strengthRung),
  columns.phishingStage === undefined
    ? undefined
    : anchoredStrength(columns.phishingStage.byRung, target.strengthRung),
);

export const worldDrawAt = (worlds: AttackRunWorlds, world: number): AttackRunWorldDraw => ({
  deployed: worlds.controls.map((columns) => controlStateAt(columns, DECLARED_LEVER).deployed),
  preventEfficacy: worlds.controls.map((columns) => controlStateAt(columns, DECLARED_LEVER).preventEfficacy),
  detectEfficacy: worlds.controls.map((columns) => controlStateAt(columns, DECLARED_LEVER).detectEfficacy),
  phishingStageEfficacy: worlds.controls.map((columns) => controlStateAt(columns, DECLARED_LEVER).phishingStageEfficacy),
  knockoutUniform: worlds.controls.map((columns) => columns.knockout.map((column) => column[world])),
  reactionTimeHours: worlds.reactionTimeHours,
  cveUniform: Float64Array.from(worlds.cveUniform, (column) => column[world]),
  familyUniform: Float64Array.from(worlds.familyUniform, (column) => column[world]),
  ...(worlds.declaredKinds.length === 0 ? {} : {
    declaredCount: Float64Array.from(worlds.declaredKinds, (declared, index) => declaredVirtualCount(declared, worlds.declaredUniform[index][world])),
  }),
});
