import { newError } from '@app/utils';
import type { AttackRunConstants, AttackRunFunctionName, CompiledAttackRunLaw, CompiledObstacle } from './attack-run-law';
import type { TestedResult } from '../../controls/capability/tested-efficacy';
import type { DoorEstate, DoorPass, DoorWorld } from './attack-run-door';
import type { AttackPathShares } from './attack-paths-mix';
import type { PertRange } from './attack-run-worlds';
import { lowestTestedEfficacy, testedEfficacy } from '../../controls/capability/tested-efficacy';
import { doorPassByTechnique, unknownFlawFloor } from './attack-run-door';
import { PHISHING_CONSTANTS, phishingCampaignSize } from './attack-run-constants';
import { phishingPass } from './attack-run-phishing';
import { DOOR_OBSTACLE, PHISHING_STAGE, PHISHING_STAGE_COUNT } from './attack-run-law';
import { mixAttackPaths } from './attack-paths-mix';
import { attackedAssetWeight } from './asset-scalars';
import { pertBelow } from './distributions';

/**
 * One world evaluated, section 5 to section 9 in closed form.
 *
 * A world is one hypothesis about what holds for a year: the exploits in circulation, the unknown
 * flaws, and the uniforms the sabotage knockouts are decided against, beside every control's
 * declared efficacy. Nothing on the attacker side is sampled here, which is what makes the
 * difference between two evaluations on the same world exact rather than noisy.
 *
 * The per-family control products are built once per world and shared by every evaluation of it:
 * a per-technique interdiction walks the cached numbers, and an obstacle divides its knockouts out
 * of them, then copies them back as it found them. Rebuilding them per technique costs an order of
 * magnitude for the identical answer.
 */

export interface AttackRunWorldDraw {
  /** Per control, in the law's order: whether it is present at all, false for a control at no coverage. */
  readonly deployed: ReadonlyArray<boolean>,
  /** `theta x c` per (control, function): the declaration, which OpenAEV's results audit on a technique they tested. */
  readonly preventEfficacy: ReadonlyArray<number>,
  readonly detectEfficacy: ReadonlyArray<number>,
  /**
   * Per control, the prevent efficacy its phishing stage reads where a stage anchor stands in for
   * the shared scale, undefined elsewhere: the stage then reads `preventEfficacy`.
   */
  readonly phishingStageEfficacy?: ReadonlyArray<number | undefined>,
  /**
   * Per (control, obstacle), the uniform the knockout is decided against. It is a uniform rather
   * than a bit because the establishment moves under a what-if and under an interdiction, and
   * sharing the uniform is what keeps the two evaluations on the same world.
   */
  readonly knockoutUniform: ReadonlyArray<ReadonlyArray<number>>,
  readonly reactionTimeHours: PertRange,
  /** Per CVE, the uniform its exploit in circulation is decided against, in the run's CVE order. */
  readonly cveUniform: Float64Array,
  /** Per family, the uniform its unknown flaw floor is decided against, in the run's family order. */
  readonly familyUniform: Float64Array,
  /** Per drawn kind of the law, its internal virtual assets in this world. Absent when the law draws none. */
  readonly declaredCount?: Float64Array,
}

export interface AttackRunControlState {
  readonly deployed: boolean,
  readonly preventEfficacy: number,
  readonly detectEfficacy: number,
  /** What the control prevents at its own phishing stage when that differs from `preventEfficacy`: a stage anchor and coverage folded in. */
  readonly phishingStageEfficacy?: number,
}

/**
 * The door's working let-through matrix and the answer it gave on the draw the memo names. The memo
 * holds as long as a draw is never written in place: it is keyed on the draw's identity.
 */
export interface DoorState {
  readonly familyCount: number,
  /**
   * Per (layer, door technique, door family), the let-through the door reads in the current
   * evaluation, then the three stages of a phishing campaign (the payload one read on no family),
   * then the payload stage on each door family. The memo is keyed on them as much as on the cells:
   * a lever on a control acting at a stage moves no cell of a technique.
   */
  readonly letThrough: Float64Array,
  /** The same matrix and, per (layer, door technique), the pass computed on it, with the draws they came from. */
  readonly memoLetThrough: Float64Array,
  readonly memoTarget: Float64Array,
  readonly memoOther: Float64Array,
  memoDraw: AttackRunWorldDraw | null,
}

/** `PreparedWorld.movedControl` when every control is at its drawn state. */
const AT_DRAW = -1;
/** `PreparedWorld.movedControl` once a control was moved in place, which no record follows. */
const MOVED_IN_PLACE = -2;

export interface PreparedWorld {
  readonly law: CompiledAttackRunLaw,
  readonly controlStates: Array<AttackRunControlState>,
  /** `PROD (1 - efficacy)` over the present prevent controls covering (technique, family), each read on that technique. */
  readonly preventByFamily: Float64Array,
  readonly detectByFamily: Float64Array,
  /**
   * Per (stage, family), `PROD (1 - theta x c)` over the present controls acting at that stage
   * and protecting that family, the stage index leading, `theta` being the stage anchor where
   * the control has one at that stage. A control acts at one stage only, so a control present at
   * delivery is not counted again downstream.
   */
  readonly phishingLetThrough: Float64Array,
  /** The three tables above as an obstacle found them, held while its knockouts are divided out. */
  readonly intactPreventByFamily: Float64Array,
  readonly intactDetectByFamily: Float64Array,
  readonly intactPhishingLetThrough: Float64Array,
  /** Per group, its assets in this world: the compiled count moved by the drawn kinds it holds. */
  readonly groupAssets: Float64Array,
  /** The door estate this world reads: the law's, or a copy whose counts the drawn kinds move. */
  doorEstate: DoorEstate,
  campaignSize: number,
  /** The draw `groupAssets`, `doorEstate` and `campaignSize` were read from. */
  countsDraw: AttackRunWorldDraw | null,
  /** The draw the world was last refreshed on, which the door memo and the baseline record are keyed on. */
  draw: AttackRunWorldDraw,
  /**
   * How the controls depart from `draw`: `AT_DRAW`, the index of the one control `refreshWorld` put
   * at another state, or `MOVED_IN_PLACE`. A resumed what-if reads it to know which prefix it may
   * take from the baseline.
   */
  movedControl: number,
  reactionTimeHours: PertRange,
  /**
   * Per chain length played, then per position of that chain, the probability the reaction time is
   * shorter than the window left from it: the window is read against the chain's own length.
   */
  inTime: ReadonlyMap<number, Float64Array>,
  readonly knocked: Array<boolean>,
  readonly scratchDiscretion: Float64Array,
  readonly scratchToolFactor: Float64Array,
  readonly scratchSilence: Float64Array,
  readonly scratchGroup: Int32Array,
  readonly scratchShare: Float64Array,
  readonly scratchClear: Float64Array,
  readonly scratchUnseen: Float64Array,
  readonly scratchBlocked: Float64Array,
  readonly scratchFirstDetection: Float64Array,
  /** The index lists the chains of an evaluation are folded over, held here so an evaluation allocates none. */
  readonly longChain: ReadonlyArray<number>,
  readonly terminalChain: ReadonlyArray<number>,
  readonly doorState: DoorState,
  readonly baseline: BaselineRecord,
  readonly resume: ResumePoints,
}

export interface AttackRunOutcomes {
  readonly blocked: number,
  readonly evicted: number,
  readonly impactDetected: number,
  readonly impactUndetected: number,
}

/**
 * What one obstacle did, recorded only when a caller asks for it: the run's own explanation of a
 * figure, and what the property tests read to assert the per-obstacle grain of the five functions
 * rather than inferring it from an outcome share.
 */
export interface ObstacleDiagnostic {
  readonly key: string,
  readonly clear: number,
  readonly ownDetection: number,
  readonly supportSilence: number,
  readonly emitted: number,
  /** The accumulator this obstacle's detection read, which is the one the obstacles before it left. */
  readonly accumulatorBefore: number,
  readonly knockedCapabilityExternalIds: ReadonlyArray<string>,
  readonly groups: ReadonlyArray<{
    readonly groupIndex: number,
    readonly weightShare: number,
    readonly toolFactor: number,
    readonly discretion: number,
  }>,
}

/**
 * `outcomes`, `reach` and `paths` are the mixture of the chains the attack can take. Everything
 * else is the long chain's alone, whose door clears at the share the other assets give it, except
 * `clearByObstacle[0]`, the whole door. When every attack goes around the door the long chain is
 * not played and those fields are 0.
 */
export interface AttackRunEvaluation {
  readonly outcomes: AttackRunOutcomes,
  /** `A`, the chain's reach product; the mixture's when more than one chain plays. */
  readonly reach: number,
  readonly paths: AttackPathShares,
  /** The chain a fallen target plays, one clear per position with the door first. Null when it plays none. */
  readonly direct: { readonly clearByObstacle: ReadonlyArray<number> } | null,
  /** `joint`, cleared everything and never seen, which the undetected arm reads. */
  readonly reachedUnseen: number,
  readonly unseen: number,
  readonly clearByObstacle: ReadonlyArray<number>,
  /** `P(first seen at obstacle i)`, in chain order. */
  readonly firstDetectionAtObstacle: ReadonlyArray<number>,
  /** `P(first seen at the anchoring)`, which sits between the door and the second obstacle. */
  readonly firstDetectionAtAnchoring: number,
  readonly anchoring: number,
  readonly eviction: number,
  readonly detectPosture: number,
}

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);
const clamp01 = (value: number): number => clamp(value, 0, 1);

/**
 * The one place the accumulator is read. No comparison of it against a constant exists anywhere,
 * no enumerated detection state and no transition function: detection is a hazard that warms up,
 * never a ladder with rungs.
 */
const detectionProbability = (constants: AttackRunConstants, signal: number, accumulator: number): number =>
  clamp01(constants.detectionScale * signal * (1 + constants.signalGain * accumulator));

const silenceOf = (efficacy: number): number => {
  const silence = 1 - efficacy;
  if (!(silence > 0)) {
    throw newError('A control efficacy of one leaves no product to divide a knockout back out of', { efficacy });
  }
  return silence;
};

/** What a control lets through on a technique: the declaration's silence, unless OpenAEV tested it. */
const testedSilence = (declaredSilence: number, declared: number, tested: TestedResult | undefined): number =>
  (tested === undefined ? declaredSilence : silenceOf(testedEfficacy(declared, tested)));

/**
 * Multiplies (or divides back out) one control's let-through into every cell it acts on. A tested
 * technique reads the declaration audited by OpenAEV's result, computed from the state alone, so the
 * same call inverts it to the bit and a lever moving the declaration moves the audited value with it.
 */
const applyControl = (world: PreparedWorld, controlIndex: number, state: AttackRunControlState, invert: boolean): void => {
  if (!state.deployed) {
    return;
  }
  const { law } = world;
  const familyCount = law.familyCount;
  const control = law.controls[controlIndex];
  const prevent = silenceOf(state.preventEfficacy);
  const detect = silenceOf(state.detectEfficacy);
  if (control.phishingStage >= 0) {
    const stageDeclared = state.phishingStageEfficacy ?? state.preventEfficacy;
    const stagePrevent = state.phishingStageEfficacy === undefined ? prevent : silenceOf(state.phishingStageEfficacy);
    const silence = control.testedStage.length === 0 ? stagePrevent : silenceOf(lowestTestedEfficacy(stageDeclared, control.testedStage));
    for (const family of control.familyIndexes) {
      const at = control.phishingStage * familyCount + family;
      world.phishingLetThrough[at] = invert ? world.phishingLetThrough[at] / silence : world.phishingLetThrough[at] * silence;
    }
  }
  for (const technique of control.preventTechniques) {
    const silence = testedSilence(prevent, state.preventEfficacy, control.testedPrevent.get(technique));
    for (const family of control.familyIndexes) {
      const at = technique * familyCount + family;
      world.preventByFamily[at] = invert ? world.preventByFamily[at] / silence : world.preventByFamily[at] * silence;
    }
  }
  for (const technique of control.detectTechniques) {
    const silence = testedSilence(detect, state.detectEfficacy, control.testedDetect.get(technique));
    for (const family of control.familyIndexes) {
      const at = technique * familyCount + family;
      world.detectByFamily[at] = invert ? world.detectByFamily[at] / silence : world.detectByFamily[at] * silence;
    }
  }
};

const sameCells = (one: ArrayLike<number>, other: ArrayLike<number>): boolean =>
  one.length === other.length && Array.prototype.every.call(one, (value: number, at: number) => value === other[at]);

/**
 * Whether two laws read the door as one function of (draw, let-through). The caller compiled both
 * from the same law inputs but `groups`, so only the family indexes the let-through is read
 * through can differ.
 */
const sharesDoorOf = (law: CompiledAttackRunLaw, other: CompiledAttackRunLaw): boolean =>
  sameCells(law.door.familyIndexes, other.door.familyIndexes);

/**
 * `shareDoorWith` is a world of the same actor on another set of groups: the law must be compiled
 * from the same law inputs as `shareDoorWith.law`, `groups` apart. When both laws read the
 * door identically, this world uses its door memo, so the door is scanned once per draw for both.
 * The memo is only read when the draws and let-through values match, so sharing it is exact.
 */
export const prepareWorld = (law: CompiledAttackRunLaw, draw: AttackRunWorldDraw, shareDoorWith?: PreparedWorld): PreparedWorld => {
  const obstacleCount = law.obstacles.length;
  const maximumGroups = Math.max(
    law.obstacles.reduce((most, obstacle) => Math.max(most, obstacle.groups.length), 0),
    law.chains.withoutInitialAccess?.obstacle.groups.length ?? 0,
  );
  const door = law.inputs.door;
  const doorFamilyCount = door.applicable.reduce((most, row) => Math.max(most, row.length), door.families.length);
  const doorCells = law.door.layers.length * door.techniques.length;
  const world: PreparedWorld = {
    law,
    controlStates: law.controls.map(() => ({ deployed: false, preventEfficacy: 0, detectEfficacy: 0 })),
    preventByFamily: new Float64Array(law.techniqueCount * law.familyCount),
    detectByFamily: new Float64Array(law.techniqueCount * law.familyCount),
    phishingLetThrough: new Float64Array(PHISHING_STAGE_COUNT * law.familyCount),
    intactPreventByFamily: new Float64Array(law.techniqueCount * law.familyCount),
    intactDetectByFamily: new Float64Array(law.techniqueCount * law.familyCount),
    intactPhishingLetThrough: new Float64Array(PHISHING_STAGE_COUNT * law.familyCount),
    groupAssets: Float64Array.from(law.groups, (group) => group.assets),
    doorEstate: (law.declared?.door.length ?? 0) === 0 ? door : { ...door, applicable: door.applicable.map((row) => Float64Array.from(row)) },
    campaignSize: law.phishing?.campaignSize ?? 0,
    countsDraw: null,
    draw,
    movedControl: AT_DRAW,
    reactionTimeHours: draw.reactionTimeHours,
    inTime: new Map(),
    knocked: law.controls.map(() => false),
    scratchDiscretion: new Float64Array(maximumGroups),
    scratchToolFactor: new Float64Array(maximumGroups),
    scratchSilence: new Float64Array(maximumGroups),
    scratchGroup: new Int32Array(maximumGroups),
    scratchShare: new Float64Array(maximumGroups),
    scratchClear: new Float64Array(obstacleCount),
    scratchUnseen: new Float64Array(obstacleCount),
    scratchBlocked: new Float64Array(obstacleCount),
    scratchFirstDetection: new Float64Array(obstacleCount),
    longChain: Array.from({ length: obstacleCount }, (_, index) => index),
    terminalChain: [obstacleCount - 1],
    doorState: shareDoorWith !== undefined && sharesDoorOf(law, shareDoorWith.law) ? shareDoorWith.doorState : {
      familyCount: doorFamilyCount,
      letThrough: new Float64Array(doorCells * doorFamilyCount + PHISHING_STAGE_COUNT + door.families.length),
      memoLetThrough: new Float64Array(doorCells * doorFamilyCount + PHISHING_STAGE_COUNT + door.families.length),
      memoTarget: new Float64Array(doorCells),
      memoOther: new Float64Array(doorCells),
      memoDraw: null,
    },
    baseline: { draw: null, head: null, long: [], direct: [] },
    resume: resumePointsOf(law),
  };
  world.inTime = inTimeByChainLength(draw.reactionTimeHours, world);
  refreshWorld(world, draw);
  return world;
};

/**
 * The door's rows are copied from the law's before the kinds move them, so no draw reads another's
 * counts.
 */
const refreshCounts = (world: PreparedWorld, draw: AttackRunWorldDraw): void => {
  const { law } = world;
  const declared = law.declared;
  if (declared === null || world.countsDraw === draw) {
    return;
  }
  const counts = draw.declaredCount;
  if (counts === undefined) {
    throw newError('A law drawing declared kinds was handed a draw without their counts', { kinds: declared.lowCounts.length });
  }
  world.countsDraw = draw;
  const deltaOf = (kind: number): number => counts[kind] - declared.lowCounts[kind];
  law.groups.forEach((group, index) => {
    let assets = group.assets;
    for (const kind of group.declaredKinds) {
      assets += deltaOf(kind);
    }
    world.groupAssets[index] = assets;
  });
  if (declared.door.length === 0) {
    return;
  }
  const door = law.inputs.door;
  const applicable = world.doorEstate.applicable;
  door.applicable.forEach((row, technique) => applicable[technique].set(row));
  let people = door.phishing?.people ?? 0;
  for (const entry of declared.door) {
    const delta = deltaOf(entry.kind);
    for (const technique of entry.techniques) {
      applicable[technique][entry.family] += delta;
    }
    if (entry.people) {
      people += delta;
    }
  }
  if (door.phishing !== null) {
    world.doorEstate = { ...world.doorEstate, phishing: { ...door.phishing, people } };
    world.campaignSize = law.phishing === null ? 0 : phishingCampaignSize(law.inputs.phishing?.actorClass ?? 'default', people);
  }
};

/**
 * Moves a prepared world onto the next draw, reusing its tables.
 *
 * A run holds one prepared world per actor and walks the same `N` draws with it, so the tables are
 * allocated once rather than once per (world, actor). It also rebuilds the products from one rather
 * than unwinding the previous world's, which keeps a long run's arithmetic exactly as accurate at
 * world one thousand as at world one.
 *
 * `moved` puts one control at another state than the draw's, the products still built from one: at
 * the drawn state it gives the plain refresh's products bit for bit, which a move by
 * `setControlState`, dividing, does not.
 */
export const refreshWorld = (
  world: PreparedWorld,
  draw: AttackRunWorldDraw,
  moved?: { readonly controlIndex: number, readonly state: AttackRunControlState },
): void => {
  world.preventByFamily.fill(1);
  world.detectByFamily.fill(1);
  world.phishingLetThrough.fill(1);
  world.draw = draw;
  world.movedControl = moved?.controlIndex ?? AT_DRAW;
  refreshCounts(world, draw);
  if (world.reactionTimeHours !== draw.reactionTimeHours) {
    world.inTime = inTimeByChainLength(draw.reactionTimeHours, world);
    world.reactionTimeHours = draw.reactionTimeHours;
  }
  world.controlStates.forEach((_, index) => {
    const stageEfficacy = draw.phishingStageEfficacy?.[index];
    const state = index === moved?.controlIndex ? moved.state : {
      deployed: draw.deployed[index],
      preventEfficacy: draw.preventEfficacy[index],
      detectEfficacy: draw.detectEfficacy[index],
      ...(stageEfficacy === undefined ? {} : { phishingStageEfficacy: stageEfficacy }),
    };
    world.controlStates[index] = state;
    applyControl(world, index, state, false);
  });
};

/**
 * Moves one control to another state, in place, and returns the state it replaced.
 */
export const setControlState = (world: PreparedWorld, controlIndex: number, state: AttackRunControlState): AttackRunControlState => {
  const previous = world.controlStates[controlIndex];
  applyControl(world, controlIndex, previous, true);
  applyControl(world, controlIndex, state, false);
  world.controlStates[controlIndex] = state;
  world.movedControl = MOVED_IN_PLACE;
  return previous;
};

/**
 * The counterfactual one evaluation answers under. The technique keeps its place in the repertoire,
 * its share of the quota and the signal it emits, and only stops succeeding or has its detection
 * fully covered, so the difference it makes to the ALE is what buying a control against it buys. A
 * fully covered detection still goes through the detection hazard, so the technique is not seen
 * every time it is played.
 */
export interface TechniqueInterdiction {
  readonly lever: 'prevent' | 'detect',
  /** Index into the compiled repertoire. */
  readonly technique: number,
}

interface EvaluationScope {
  readonly world: PreparedWorld,
  readonly law: CompiledAttackRunLaw,
  readonly constants: AttackRunConstants,
  /** Repertoire indexes read as perfectly covered on that lever, -1 for none. */
  readonly interdictedPrevent: number,
  readonly interdictedDetect: number,
  /** The CVE whose exploit reads as not in circulation, -1 for none. */
  readonly forgoneExploit: number,
}

/** One obstacle's eligible estate, written into the world's scratch arrays. */
interface ObstacleGeometry {
  readonly count: number,
  readonly visits: number,
  /** The obstacle is one attempt of a campaign over its exposed assets: it clears when at least one falls. */
  readonly oneAttempt: boolean,
  /** The families those groups carry, as a bitmask. */
  readonly familyMask: number,
}

const resolveGeometry = (scope: EvaluationScope, obstacle: CompiledObstacle, oneAttempt = false): ObstacleGeometry => {
  const { law, world } = scope;
  let count = 0;
  let totalWeight = 0;
  let assets = 0;
  let familyMask = 0;
  obstacle.groups.forEach((entry, position) => {
    const groupAssets = world.groupAssets[entry.groupIndex];
    // A group only a drawn kind fills is absent from the worlds that draw none of it.
    if (obstacle.varies && groupAssets === 0) {
      return;
    }
    world.scratchGroup[count] = position;
    world.scratchShare[count] = obstacle.varies ? groupAssets * entry.unitWeight : entry.weightShare;
    totalWeight += world.scratchShare[count];
    assets += groupAssets;
    familyMask |= 1 << law.groups[entry.groupIndex].familyIndex;
    count += 1;
  });
  if (totalWeight > 0 && totalWeight !== 1) {
    for (let index = 0; index < count; index += 1) {
      world.scratchShare[index] /= totalWeight;
    }
  }
  return { count, visits: Math.min(oneAttempt ? 1 : scope.constants.visitQuota, assets), oneAttempt, familyMask };
};

/**
 * `p(T, g, d)` of section 5, with the CVE floor of section 5.1 applied to the share of the
 * technique's holders that exploit a CVE the group carries.
 */
const success = (scope: EvaluationScope, preventProduct: number, toolFactor: number, floorShare: number): number => {
  const { capability } = scope.law.inputs.actorClass;
  const { coupleSuccessCap, actorExploitedCveFloor } = scope.constants;
  const ordinary = clamp(capability * preventProduct * toolFactor, 0, coupleSuccessCap);
  if (floorShare === 0) {
    return ordinary;
  }
  const floored = Math.max(ordinary, clamp(actorExploitedCveFloor * preventProduct, 0, coupleSuccessCap));
  return ordinary + floorShare * (floored - ordinary);
};

/**
 * The product over the controls covering a technique and reaching any family of the estate the
 * caller names. It reads the intact posture, which is the only posture an estate-grain quantity
 * ever reads: a sabotage establishment and the anchoring are both decided against the defence as it
 * stood before the attempt.
 */
const estateProduct = (scope: EvaluationScope, technique: number, familyMask: number, detect: boolean): number => {
  if (technique === (detect ? scope.interdictedDetect : scope.interdictedPrevent)) {
    return 0;
  }
  const { law, world } = scope;
  const covering = detect ? law.detectControlsByTechnique[technique] : law.preventControlsByTechnique[technique];
  let product = 1;
  for (const controlIndex of covering) {
    const state = world.controlStates[controlIndex];
    const control = law.controls[controlIndex];
    if (state.deployed && (control.familyMask & familyMask) !== 0) {
      product *= 1 - (detect
        ? testedEfficacy(state.detectEfficacy, control.testedDetect.get(technique))
        : testedEfficacy(state.preventEfficacy, control.testedPrevent.get(technique)));
    }
  }
  return product;
};

/**
 * Every read of a technique's two per-family products goes through these, so an interdiction lands
 * on every phase that reads it rather than on the one that motivated it.
 */
const preventedOf = (scope: EvaluationScope, technique: number, familyIndex: number): number =>
  (technique === scope.interdictedPrevent
    ? 0
    : scope.world.preventByFamily[technique * scope.law.familyCount + familyIndex]);

const stageInterdicted = (scope: Pick<EvaluationScope, 'law' | 'interdictedPrevent'>, stage: number): boolean =>
  scope.interdictedPrevent >= 0 && scope.law.phishingStageOfTechnique[scope.interdictedPrevent] === stage;

/**
 * What one stage of a phishing campaign lets through on a family. A stage reads zero under a
 * prevent interdiction of a technique that names it, as every per-technique product does under its
 * own: the stages are keyed by stage, not by technique, so the interdiction has no cell to land on.
 */
export const phishingLetThroughOf = (
  scope: Pick<EvaluationScope, 'world' | 'law' | 'interdictedPrevent'>,
  stage: number,
  familyIndex: number,
): number =>
  (stageInterdicted(scope, stage)
    ? 0
    : scope.world.phishingLetThrough[stage * scope.law.familyCount + familyIndex]);

/** A family no group of the law holds reads no control, so its stage lets everything through, bar an interdicted stage. */
const phishingStageOnFamily = (scope: EvaluationScope, stage: number, familyIndex: number): number =>
  (familyIndex < 0 ? (stageInterdicted(scope, stage) ? 0 : 1) : phishingLetThroughOf(scope, stage, familyIndex));

const detectedOf = (scope: EvaluationScope, technique: number, familyIndex: number): number =>
  (technique === scope.interdictedDetect
    ? 1
    : 1 - scope.world.detectByFamily[technique * scope.law.familyCount + familyIndex]);

const playableOnEstate = (scope: EvaluationScope, technique: number, familyMask: number): boolean =>
  (scope.law.techniqueFamilyMask[technique] & familyMask) !== 0;

/** What one attempt drawn among some techniques, restricted to those the estate admits, divides by. */
interface EstateDraw {
  readonly total: number,
  readonly count: number,
}

const estateDraw = (scope: EvaluationScope, techniques: ReadonlyArray<number>, familyMask: number): EstateDraw => {
  let total = 0;
  let count = 0;
  for (const technique of techniques) {
    if (playableOnEstate(scope, technique, familyMask)) {
      total += scope.law.prevalence[technique];
      count += 1;
    }
  }
  return { total, count };
};

/** The probability that the draw plays a technique the estate admits, in proportion to its prevalence. */
const drawWeight = (scope: EvaluationScope, draw: EstateDraw, technique: number): number =>
  (draw.total > 0 ? scope.law.prevalence[technique] / draw.total : 1 / draw.count);

/**
 * `F = SUM q x p(T)` of section 7, one attempt drawn against the obstacle's eligible estate as a
 * whole, which is the grain the sabotage knockout and the anchoring read: one number per obstacle,
 * because the knockout is one bit per (capability, obstacle).
 */
const establishOnEstate = (
  scope: EvaluationScope,
  name: AttackRunFunctionName,
  familyMask: number,
  toolFactor: number,
): number => {
  const compiled = scope.law.functions[name];
  const draw = estateDraw(scope, compiled.techniques, familyMask);
  let established = 0;
  for (const technique of compiled.techniques) {
    if (playableOnEstate(scope, technique, familyMask)) {
      established += drawWeight(scope, draw, technique) * success(scope, estateProduct(scope, technique, familyMask, false), toolFactor, 0);
    }
  }
  return established;
};

/** The same establishment folded into one group's own terms, which is where sections 5 and 7 use it. */
const establishOnGroup = (
  scope: EvaluationScope,
  name: AttackRunFunctionName,
  familyIndex: number,
  cveFloorShare: Float64Array,
  toolFactor: number,
): number => {
  const { law } = scope;
  const compiled = law.functions[name];
  const choice = compiled.choiceByFamily[familyIndex];
  let established = 0;
  for (let rank = 0; rank < compiled.byFamily[familyIndex].length; rank += 1) {
    const position = compiled.byFamily[familyIndex][rank];
    const technique = compiled.techniques[position];
    const prevented = preventedOf(scope, technique, familyIndex);
    established += choice[rank] * success(scope, prevented, toolFactor, cveFloorShare[technique]);
  }
  return established;
};

const toolFactorOf = (constants: AttackRunConstants, established: number): number =>
  constants.execFloor + (1 - constants.execFloor) * established;

/**
 * Section 6.2: a population-scoped action floods the defender with quarantine signal without
 * granting an unbounded detection channel, so its opportunities are the root of the expected
 * blocked volume, capped at the population detection cap. Past the door its success side is
 * resolved per visit like every other technique's, so a wave costs a visit slot rather than being
 * free of the quota.
 */
const detectionOpportunities = (scope: EvaluationScope, technique: number, assets: number, reached: number): number =>
  (scope.law.populationScoped[technique] ? Math.min(scope.constants.populationDetectionCap, Math.sqrt(assets * (1 - reached))) : 1);

const signalOf = (scope: EvaluationScope, noise: number, detected: number, discretion: number): number =>
  noise * detected * (1 - scope.law.inputs.actorClass.stealth * discretion);

const sameValues = (one: Float64Array, other: Float64Array): boolean => {
  for (let at = 0; at < one.length; at += 1) {
    if (one[at] !== other[at]) {
      return false;
    }
  }
  return true;
};

/** What the door clears with, cut by who falls: a target (`D_T`), or only some other asset (`D_O`). */
interface DoorClear {
  readonly target: number,
  readonly other: number,
}

/**
 * The door's pass per technique on each layer, handed to `onLayer` in layer order, on a let-through
 * matrix laid out as `DoorState.letThrough` and the world's draw, `forgoneExploit` read as not in
 * circulation. T1566 is read on the people, every other technique on the assets.
 */
const scanDoor = (
  world: PreparedWorld,
  letThrough: Float64Array,
  forgoneExploit: number,
  onLayer: (layerIndex: number, pass: DoorPass) => void,
): void => {
  const { law } = world;
  const { constants } = law.inputs;
  const estate = world.doorEstate;
  const { familyCount } = world.doorState;
  const cells = estate.techniques.length * familyCount;
  const stageAt = law.door.layers.length * cells;
  const payloadAt = stageAt + PHISHING_STAGE_COUNT;
  const floor = unknownFlawFloor(law.inputs.actorClass.capability, constants.unknownFlawFloorScale);
  const phishing = law.phishing;
  const exploited = (cve: number): boolean => cve !== forgoneExploit && world.draw.cveUniform[cve] < estate.cves[cve].threat;
  const floorHeld = (family: number): boolean => world.draw.familyUniform[family] < floor;
  let phishingClear: { target: number, other: number } | null = null;
  law.door.layers.forEach((layer, layerIndex) => {
    const doorWorld: DoorWorld = {
      exploited,
      floorHeld,
      letThrough: (technique, family) => letThrough[layerIndex * cells + technique * familyCount + family],
      cap: constants.coupleSuccessCap,
    };
    const pass = doorPassByTechnique(estate, doorWorld);
    if (phishing !== null && layer.repertoire[phishing.technique] >= 0) {
      phishingClear ??= phishingPass(estate.phishing!, {
        exploited,
        floorHeld,
        delivery: letThrough[stageAt + PHISHING_STAGE.delivery],
        credential: letThrough[stageAt + PHISHING_STAGE.credential],
        payload: (family) => letThrough[family < 0 ? stageAt + PHISHING_STAGE.payload : payloadAt + family],
        susceptibility: phishing.susceptibility,
        campaignSize: world.campaignSize,
        cap: constants.coupleSuccessCap,
      }, PHISHING_CONSTANTS);
      pass.target[phishing.technique] = phishingClear.target;
      pass.other[phishing.technique] = phishingClear.other;
    }
    onLayer(layerIndex, pass);
  });
};

/**
 * Whether forgoing a door CVE's exploit leaves every pass the door memo holds bit for bit, the memo's
 * own let-through rescanned. The forgone exploit is read by the door alone, so an evaluation that
 * forgoes it, on the world at the state the memo was written in, answers exactly as that evaluation
 * did. False when the memo was not written on this world's draw.
 */
export const forgoneExploitLeavesDoor = (world: PreparedWorld, forgoneExploit: number): boolean => {
  if (world.doorState.memoDraw !== world.draw) {
    return false;
  }
  const state = world.doorState;
  const techniqueCount = world.law.inputs.door.techniques.length;
  let unchanged = true;
  scanDoor(world, state.memoLetThrough, forgoneExploit, (layerIndex, pass) => {
    for (let technique = 0; unchanged && technique < techniqueCount; technique += 1) {
      const at = layerIndex * techniqueCount + technique;
      unchanged = pass.target[technique] === state.memoTarget[at] && pass.other[technique] === state.memoOther[at];
    }
  });
  return unchanged;
};

/**
 * `D_T = SUM q_t x P_T(t)` and `D_O = SUM q_t x (1 - P_T(t)) x P_O(t)` over the door's techniques:
 * the chance that one campaign over the whole estate lands on a target, and the chance that it
 * lands only elsewhere, under the defence as the obstacle has degraded it. Their sum is the chance
 * it lands anywhere. The capability, the tooling and the visits of the attacker are not read, and
 * neither is the CVE floor of its actors: the door prices what the estate exposes, and the
 * capability only sets how often a family holds a flaw no finding lists.
 */
const doorClearOf = (scope: EvaluationScope): DoorClear => {
  const { law, world } = scope;
  const estate = law.inputs.door;
  const state = world.doorState;
  const techniqueCount = estate.techniques.length;
  const cells = techniqueCount * state.familyCount;
  const phishing = law.phishing;
  const stageAt = law.door.layers.length * cells;
  const payloadAt = stageAt + PHISHING_STAGE_COUNT;

  law.door.layers.forEach((layer, layerIndex) => {
    for (let technique = 0; technique < techniqueCount; technique += 1) {
      const played = layer.repertoire[technique];
      if (played < 0) {
        continue;
      }
      for (let family = 0; family < state.familyCount; family += 1) {
        const familyIndex = law.door.familyIndexes[family];
        state.letThrough[layerIndex * cells + technique * state.familyCount + family] = familyIndex < 0
          ? (played === scope.interdictedPrevent ? 0 : 1)
          : preventedOf(scope, played, familyIndex);
      }
    }
  });

  if (phishing !== null) {
    state.letThrough[stageAt + PHISHING_STAGE.delivery] = phishingStageOnFamily(scope, PHISHING_STAGE.delivery, phishing.personFamily);
    state.letThrough[stageAt + PHISHING_STAGE.credential] = phishingStageOnFamily(scope, PHISHING_STAGE.credential, phishing.personFamily);
    state.letThrough[stageAt + PHISHING_STAGE.payload] = phishingStageOnFamily(scope, PHISHING_STAGE.payload, -1);
    for (let family = 0; family < estate.families.length; family += 1) {
      state.letThrough[payloadAt + family] = phishingStageOnFamily(scope, PHISHING_STAGE.payload, law.door.familyIndexes[family]);
    }
  }

  let target = 0;
  let other = 0;
  const doorUnaffectedByForgone = scope.forgoneExploit === -1
    || !(world.draw.cveUniform[scope.forgoneExploit] < estate.cves[scope.forgoneExploit].threat);
  const sameDraw = state.memoDraw === world.draw;
  if (sameDraw && doorUnaffectedByForgone && sameValues(state.letThrough, state.memoLetThrough)) {
    law.door.layers.forEach((layer, layerIndex) => {
      for (let technique = 0; technique < techniqueCount; technique += 1) {
        const at = layerIndex * techniqueCount + technique;
        target += layer.choice[technique] * state.memoTarget[at];
        other += layer.choice[technique] * ((1 - state.memoTarget[at]) * state.memoOther[at]);
      }
    });
    return { target, other };
  }

  const memorise = !sameDraw && doorUnaffectedByForgone;
  scanDoor(world, state.letThrough, scope.forgoneExploit, (layerIndex, pass) => {
    const layer = law.door.layers[layerIndex];
    if (memorise) {
      state.memoTarget.set(pass.target, layerIndex * techniqueCount);
      state.memoOther.set(pass.other, layerIndex * techniqueCount);
    }
    for (let technique = 0; technique < techniqueCount; technique += 1) {
      target += layer.choice[technique] * pass.target[technique];
      other += layer.choice[technique] * ((1 - pass.target[technique]) * pass.other[technique]);
    }
  });
  if (memorise) {
    state.memoLetThrough.set(state.letThrough);
    state.memoDraw = world.draw;
  }
  return { target, other };
};

interface ObstacleOutcome {
  readonly clear: number,
  /** `(1 - q_obs) x S`: neither the obstacle's own actions nor the functions spent there were seen. */
  readonly unseen: number,
  readonly emitted: number,
  /** The door's `D_T` and `D_O`, which `clear` sums; zero at every other obstacle. */
  readonly doorTarget: number,
  readonly doorOther: number,
}

const UNPLAYABLE: ObstacleOutcome = { clear: 0, unseen: 1, emitted: 0, doorTarget: 0, doorOther: 0 };

/**
 * One obstacle, in closed form. The order of the phases is the law and not a convenience: the
 * establishments that decide the knockouts read the intact posture, everything the obstacle then
 * spends reads the degraded one, and the sabotage attempt's own noise reads the intact detect
 * product, because tampering is loud on the sensors that are still running when it starts.
 */
const evaluateObstacle = (
  scope: EvaluationScope,
  obstacle: CompiledObstacle,
  /** The obstacle's index in the full chain, which keys its knockout draw whichever chain plays it. */
  knockoutIndex: number,
  isDoor: boolean,
  geometry: ObstacleGeometry,
  accumulator: number,
  diagnostics: Array<ObstacleDiagnostic> | undefined,
): ObstacleOutcome => {
  const { law, world, constants } = scope;
  if (geometry.count === 0) {
    diagnostics?.push({
      key: obstacle.key,
      clear: 0,
      ownDetection: 0,
      supportSilence: 1,
      emitted: 0,
      accumulatorBefore: accumulator,
      knockedCapabilityExternalIds: [],
      groups: [],
    });
    return UNPLAYABLE;
  }
  const sabotage = law.functions.sabotage;

  const intactToolFactor = toolFactorOf(constants, establishOnEstate(scope, 'tooling', geometry.familyMask, 1));
  const sabotageDraw = estateDraw(scope, sabotage.techniques, geometry.familyMask);
  let knockedAny = false;
  for (let controlIndex = 0; controlIndex < law.controls.length; controlIndex += 1) {
    let established = 0;
    if (world.controlStates[controlIndex].deployed) {
      for (const position of law.controls[controlIndex].impairedBy) {
        const technique = sabotage.techniques[position];
        if (playableOnEstate(scope, technique, geometry.familyMask)) {
          const prevented = estateProduct(scope, technique, geometry.familyMask, false);
          established += drawWeight(scope, sabotageDraw, technique) * success(scope, prevented, intactToolFactor, 0);
        }
      }
    }
    world.knocked[controlIndex] = world.draw.knockoutUniform[controlIndex][knockoutIndex] < established;
    knockedAny = knockedAny || world.knocked[controlIndex];
  }

  if (knockedAny) {
    world.intactPreventByFamily.set(world.preventByFamily);
    world.intactDetectByFamily.set(world.detectByFamily);
    world.intactPhishingLetThrough.set(world.phishingLetThrough);
    world.knocked.forEach((down, controlIndex) => {
      if (down) {
        applyControl(world, controlIndex, world.controlStates[controlIndex], true);
      }
    });
  }

  let passWeighted = 0;
  let logMissAll = 0;
  let seenWeighted = 0;
  let emitted = 0;
  for (let position = 0; position < geometry.count; position += 1) {
    const entry = obstacle.groups[world.scratchGroup[position]];
    const weightShare = world.scratchShare[position];
    const group = law.groups[entry.groupIndex];
    const groupAssets = world.groupAssets[entry.groupIndex];
    const familyIndex = group.familyIndex;
    const toolFactor = toolFactorOf(constants, establishOnGroup(scope, 'tooling', familyIndex, group.cveFloorShare, 1));
    const discretion = establishOnGroup(scope, 'discretion', familyIndex, group.cveFloorShare, toolFactor);
    world.scratchDiscretion[position] = discretion;
    world.scratchToolFactor[position] = toolFactor;

    let pass = 0;
    let passWhole = 0;
    let seen = 0;
    for (let rank = 0; rank < entry.playable.length; rank += 1) {
      const played = entry.playable[rank];
      const technique = obstacle.techniques[played];
      const choice = entry.choice[rank];
      const prevented = preventedOf(scope, technique, familyIndex);
      const reached = success(scope, prevented, toolFactor, group.cveFloorShare[technique]);
      const wholeGroup = law.populationScoped[technique] ? 1 - (1 - reached) ** groupAssets : reached;
      pass += choice * wholeGroup;
      if (law.populationScoped[technique]) {
        passWhole += choice * wholeGroup;
      }

      const emails = isDoor && law.phishingStageOfTechnique[technique] === PHISHING_STAGE.delivery ? world.campaignSize : null;
      const detected = detectedOf(scope, technique, familyIndex);
      const signal = emails === 0 ? 0 : signalOf(scope, obstacle.noise[played], detected, discretion);
      const probability = detectionProbability(constants, signal, accumulator);
      const opportunities = detectionOpportunities(scope, technique, emails ?? groupAssets, reached);
      seen += choice * (1 - (1 - probability) ** opportunities);
      emitted += weightShare * choice * signal;
    }

    let silenceSupport = 1;
    for (const name of ['tooling', 'discretion'] as const) {
      const compiled = law.functions[name];
      const choices = compiled.choiceByFamily[familyIndex];
      let seenSupport = 0;
      for (let rank = 0; rank < compiled.byFamily[familyIndex].length; rank += 1) {
        const played = compiled.byFamily[familyIndex][rank];
        const technique = compiled.techniques[played];
        const detected = detectedOf(scope, technique, familyIndex);
        const signal = signalOf(scope, compiled.noise[played], detected, discretion);
        const probability = detectionProbability(constants, signal, accumulator);
        const prevented = preventedOf(scope, technique, familyIndex);
        const reached = success(scope, prevented, toolFactor, group.cveFloorShare[technique]);
        const opportunities = detectionOpportunities(scope, technique, groupAssets, reached);
        seenSupport += choices[rank] * (1 - (1 - probability) ** opportunities);
        emitted += weightShare * choices[rank] * signal;
      }
      silenceSupport *= 1 - seenSupport;
    }

    world.scratchSilence[position] = silenceSupport;
    passWeighted += weightShare * pass;
    if (geometry.oneAttempt) {
      // A population-scoped technique already reaches the whole group in one move: it counts once, not per asset.
      const weight = attackedAssetWeight(law.inputs.groups[entry.groupIndex].matchedByScenarioGroup);
      logMissAll += weight * (groupAssets * Math.log1p(-(pass - passWhole)) + Math.log1p(-passWhole));
    }
    seenWeighted += weightShare * seen;
  }
  const doorClear = isDoor ? doorClearOf(scope) : null;

  // Copied back rather than multiplied back in: a division undone by a multiplication can leave a
  // product off in the last ulp, and an obstacle must leave the products at the bits it found.
  if (knockedAny) {
    world.preventByFamily.set(world.intactPreventByFamily);
    world.detectByFamily.set(world.intactDetectByFamily);
    world.phishingLetThrough.set(world.intactPhishingLetThrough);
  }

  let silenceWeighted = 0;
  for (let position = 0; position < geometry.count; position += 1) {
    const entry = obstacle.groups[world.scratchGroup[position]];
    const group = law.groups[entry.groupIndex];
    const discretion = world.scratchDiscretion[position];
    const choices = sabotage.choiceByFamily[group.familyIndex];
    let seenSabotage = 0;
    for (let rank = 0; rank < sabotage.byFamily[group.familyIndex].length; rank += 1) {
      const played = sabotage.byFamily[group.familyIndex][rank];
      const technique = sabotage.techniques[played];
      const detected = detectedOf(scope, technique, group.familyIndex);
      const signal = signalOf(scope, sabotage.noise[played], detected, discretion);
      const probability = detectionProbability(constants, signal, accumulator);
      const prevented = preventedOf(scope, technique, group.familyIndex);
      const reached = success(scope, prevented, world.scratchToolFactor[position], group.cveFloorShare[technique]);
      const opportunities = detectionOpportunities(scope, technique, world.groupAssets[entry.groupIndex], reached);
      seenSabotage += choices[rank] * (1 - (1 - probability) ** opportunities);
      emitted += world.scratchShare[position] * choices[rank] * signal;
    }
    silenceWeighted += world.scratchShare[position] * world.scratchSilence[position] * (1 - seenSabotage);
  }

  const outcome: ObstacleOutcome = {
    clear: doorClear !== null
      ? doorClear.target + doorClear.other
      : geometry.oneAttempt ? -Math.expm1(logMissAll) : 1 - (1 - passWeighted) ** geometry.visits,
    unseen: (1 - seenWeighted) * silenceWeighted,
    emitted,
    doorTarget: doorClear?.target ?? 0,
    doorOther: doorClear?.other ?? 0,
  };
  diagnostics?.push({
    key: obstacle.key,
    clear: outcome.clear,
    ownDetection: seenWeighted,
    supportSilence: silenceWeighted,
    emitted,
    accumulatorBefore: accumulator,
    knockedCapabilityExternalIds: law.controls
      .filter((_, controlIndex) => world.knocked[controlIndex])
      .map((control) => control.capabilityExternalId),
    groups: Array.from({ length: geometry.count }, (_, position) => {
      const entry = obstacle.groups[world.scratchGroup[position]];
      return {
        groupIndex: entry.groupIndex,
        weightShare: world.scratchShare[position],
        toolFactor: world.scratchToolFactor[position],
        discretion: world.scratchDiscretion[position],
      };
    }),
  });
  return outcome;
};

/**
 * `detectPosture` of section 9: the noise-weighted mean of the detect product over the **terminal**
 * obstacle's techniques, never the whole repertoire, which is two thirds support. Post-objective
 * discovery is discovery of the consequence, and the scenario already fixes the terminal tactic.
 */
const detectPostureOf = (scope: EvaluationScope, obstacle: CompiledObstacle, geometry: ObstacleGeometry): number => {
  const { law, world } = scope;
  let weighted = 0;
  let noiseTotal = 0;
  for (let position = 0; position < geometry.count; position += 1) {
    const entry = obstacle.groups[world.scratchGroup[position]];
    const weightShare = world.scratchShare[position];
    const familyIndex = law.groups[entry.groupIndex].familyIndex;
    for (let rank = 0; rank < entry.playable.length; rank += 1) {
      const played = entry.playable[rank];
      const noise = entry.choice[rank] * obstacle.noise[played];
      weighted += weightShare * noise * detectedOf(scope, obstacle.techniques[played], familyIndex);
      noiseTotal += weightShare * noise;
    }
  }
  return noiseTotal === 0 ? 0 : weighted / noiseTotal;
};

/**
 * `Z`, the silence of persistence and the channel. They are established once, against the estate of
 * the terminal obstacle and the intact posture, which is what lets a single `Z` factor out of every
 * arm of `unseen`, blocked arms included.
 */
const anchoringSilenceOf = (
  scope: EvaluationScope,
  obstacle: CompiledObstacle,
  geometry: ObstacleGeometry,
  discretion: number,
  toolFactor: number,
  accumulator: number,
): number => {
  const { law, world, constants } = scope;
  if (geometry.count === 0) {
    return 1;
  }
  let silenceWeighted = 0;
  for (let position = 0; position < geometry.count; position += 1) {
    const entry = obstacle.groups[world.scratchGroup[position]];
    const group = law.groups[entry.groupIndex];
    let silence = 1;
    for (const name of ['persistence', 'channel'] as const) {
      const compiled = law.functions[name];
      const choices = compiled.choiceByFamily[group.familyIndex];
      let seenAnchoring = 0;
      for (let rank = 0; rank < compiled.byFamily[group.familyIndex].length; rank += 1) {
        const played = compiled.byFamily[group.familyIndex][rank];
        const technique = compiled.techniques[played];
        const detected = 1 - estateProduct(scope, technique, geometry.familyMask, true);
        const signal = signalOf(scope, compiled.noise[played], detected, discretion);
        const probability = detectionProbability(constants, signal, accumulator);
        const prevented = estateProduct(scope, technique, geometry.familyMask, false);
        const reached = success(scope, prevented, toolFactor, group.cveFloorShare[technique]);
        seenAnchoring += choices[rank] * (1 - (1 - probability) ** detectionOpportunities(scope, technique, world.groupAssets[entry.groupIndex], reached));
      }
      silence *= 1 - seenAnchoring;
    }
    silenceWeighted += world.scratchShare[position] * silence;
  }
  return silenceWeighted;
};

/**
 * The time left to react, read from the position of the first detection rather than drawn uniformly
 * over the attack run: a detection at the door leaves most of the attack run to react in. The anchoring
 * sits at the door's depth, the attacker having just got in, so it reads the door's window.
 */
export const remainingHours = (attackRunDays: number, chainLength: number, position: number): number =>
  attackRunDays * 24 * ((chainLength - position) / chainLength);

/** One chain to fold: the obstacles it plays, by index into the full chain, and whether the door opens it. */
interface ChainSpec {
  readonly indexes: ReadonlyArray<number>,
  readonly hasDoor: boolean,
  /** The obstacle played last, which is the law's terminal one unless the chain restricts its techniques. */
  readonly terminal: CompiledObstacle,
  /**
   * The chain's obstacles are tried once: the TEF counts campaigns, and one campaign is one attempt
   * against the exposed assets, whose fall of any one clears the obstacle. An outage is noticed as
   * far as the detect controls see it, the share of the stealthy intrusion found later having no
   * place here.
   */
  readonly oneAttempt?: boolean,
}

/**
 * A chain's outcomes per position in the baseline: the baseline records every one, and a what-if
 * that changes none of the first `replayed` reads them back.
 */
type ChainTrace =
  | { readonly kind: 'record', readonly outcomes: Array<ObstacleOutcome> }
  | { readonly kind: 'replay', readonly outcomes: ReadonlyArray<ObstacleOutcome>, readonly replayed: number };

/**
 * What the world's last baseline settled, keyed on the draw it was evaluated on: its door head and
 * each obstacle's outcome on the long and the direct chain.
 */
interface BaselineRecord {
  draw: AttackRunWorldDraw | null,
  head: DoorHead | null,
  readonly long: Array<ObstacleOutcome>,
  readonly direct: Array<ObstacleOutcome>,
}

/** What the door settled once, which every chain that goes through it starts from. */
interface DoorHead {
  readonly outcome: ObstacleOutcome,
  /** `Z`, the silence of persistence and the channel, read after the door's emission. */
  readonly anchoringSilence: number,
  readonly anchoring: number,
}

interface ChainFold {
  readonly outcomes: AttackRunOutcomes,
  readonly reach: number,
  readonly reachedUnseen: number,
  readonly unseen: number,
  readonly firstDetectionAtAnchoring: number,
  readonly eviction: number,
  readonly detectPosture: number,
}

/**
 * The probability of reacting in time from each chain position, read from the reaction time's
 * PERT rather than drawn per world: the reaction time varies from one incident to the next, so one
 * draw deciding every campaign of a world's year leaves the mean where it is and widens the spread.
 */
export const inTimeByPosition = (reactionTimeHours: PertRange, attackRunDays: number, chainLength: number): Float64Array =>
  Float64Array.from({ length: chainLength + 1 }, (_, position) => pertBelow(
    reactionTimeHours.min,
    reactionTimeHours.likely,
    reactionTimeHours.max,
    remainingHours(attackRunDays, chainLength, position),
  ));

/**
 * The probability of reacting in time, for each chain length the law plays: the long chain, the
 * direct one and the one around the door each read the window left against their own length.
 */
const inTimeByChainLength = (
  reactionTimeHours: PertRange,
  world: Pick<PreparedWorld, 'law' | 'longChain' | 'terminalChain'>,
): ReadonlyMap<number, Float64Array> => {
  const { attackRunDays } = world.law.inputs.actorClass;
  const lengths = new Set([world.longChain.length, world.law.chains.direct?.length ?? 0, world.terminalChain.length]);
  lengths.delete(0);
  return new Map([...lengths].map((length) => [length, inTimeByPosition(reactionTimeHours, attackRunDays, length)]));
};

export const inTimeOf = (world: PreparedWorld, chainLength: number): Float64Array => {
  const inTime = world.inTime.get(chainLength);
  if (inTime === undefined) {
    throw newError('No reaction window was prepared for a chain of this length', { chainLength });
  }
  return inTime;
};

/**
 * One chain's partition, from the clear and the unseen share of each of its obstacles. The door,
 * when the chain has one, comes already evaluated and clears at `doorClear`; every other obstacle is
 * evaluated here against this chain's own accumulator, and the time left to react is read against
 * this chain's own length. The per-position results stay in the world's scratch arrays until the
 * next fold overwrites them.
 */
const foldChain = (
  scope: EvaluationScope,
  chain: ChainSpec,
  head: DoorHead,
  doorClear: number,
  diagnostics: Array<ObstacleDiagnostic> | undefined,
  trace?: ChainTrace,
): ChainFold => {
  const { world, law, constants } = scope;
  const { patience } = law.inputs.actorClass;
  const length = chain.indexes.length;
  const last = length - 1;
  const silence = chain.hasDoor ? head.anchoringSilence : 1;
  const anchoring = chain.hasDoor ? head.anchoring : 0;

  let accumulator = 0;
  let reach = 1;
  for (let position = 0; position < length; position += 1) {
    let outcome: ObstacleOutcome;
    if (position === 0 && chain.hasDoor) {
      outcome = { ...head.outcome, clear: doorClear };
    } else if (trace?.kind === 'replay' && position < trace.replayed) {
      outcome = trace.outcomes[position];
    } else {
      const index = chain.indexes[position];
      const obstacle = position === last ? chain.terminal : law.obstacles[index];
      outcome = evaluateObstacle(scope, obstacle, index, false, resolveGeometry(scope, obstacle, chain.oneAttempt === true), accumulator, diagnostics);
    }
    if (trace?.kind === 'record') {
      trace.outcomes[position] = outcome;
    }
    world.scratchClear[position] = outcome.clear;
    world.scratchUnseen[position] = outcome.clear * outcome.unseen;
    world.scratchBlocked[position] = (1 - outcome.clear) * outcome.unseen;
    reach *= outcome.clear;
    accumulator = (1 - patience) * accumulator + outcome.emitted;
  }

  const first = world.scratchFirstDetection;
  first[0] = 1 - (world.scratchUnseen[0] + world.scratchBlocked[0]);
  const firstDetectionAtAnchoring = world.scratchUnseen[0] * (1 - silence);
  let carried = world.scratchUnseen[0] * silence;
  let unseen = world.scratchBlocked[0];
  for (let index = 1; index < length; index += 1) {
    first[index] = carried * (1 - (world.scratchUnseen[index] + world.scratchBlocked[index]));
    unseen += carried * world.scratchBlocked[index];
    carried *= world.scratchUnseen[index];
  }
  const reachedUnseen = carried;
  unseen += reachedUnseen;

  const detectPosture = detectPostureOf(scope, chain.terminal, resolveGeometry(scope, chain.terminal));
  const postDetection = chain.oneAttempt === true ? detectPosture : 1 - Math.exp(-constants.postDetectionRate * detectPosture);
  const undetected = reach === 0 ? 0 : (reachedUnseen / reach) * (1 - postDetection);

  const inTime = inTimeOf(world, length);
  let eviction = firstDetectionAtAnchoring * inTime[1];
  for (let index = 0; index < length; index += 1) {
    eviction += first[index] * inTime[index + 1];
  }
  eviction *= 1 - anchoring;

  return {
    /*
     * The eviction is conditioned on the attack run otherwise reaching. An attack run the prevention was
     * going to stop anyway is blocked, not evicted, however loudly it was seen on the way: charging
     * it a response would put the cost of every alert a working control raised into the loss
     * expectancy, and on a declared posture that is 96 percent of the eviction mass. It also makes
     * a detect control worth less than nothing wherever prevention already holds.
     *
     * The share stopped before the objective, `1 - A(1-E)`, is the same under either reading, so the
     * detection scale is fitted against the same quantity.
     */
    outcomes: {
      blocked: 1 - reach,
      evicted: reach * eviction,
      impactDetected: reach * (1 - eviction) * (1 - undetected),
      impactUndetected: reach * (1 - eviction) * undetected,
    },
    reach,
    reachedUnseen,
    unseen,
    firstDetectionAtAnchoring,
    eviction,
    detectPosture,
  };
};

/** The door and the anchoring, which every chain through the door starts from. */
const headOf = (scope: EvaluationScope, terminal: CompiledObstacle, diagnostics: Array<ObstacleDiagnostic> | undefined): DoorHead => {
  const { law, constants } = scope;
  const terminalGeometry = resolveGeometry(scope, terminal);
  const terminalToolFactor = toolFactorOf(constants, establishOnEstate(scope, 'tooling', terminalGeometry.familyMask, 1));
  const anchoring = establishOnEstate(scope, 'persistence', terminalGeometry.familyMask, terminalToolFactor)
    * establishOnEstate(scope, 'channel', terminalGeometry.familyMask, terminalToolFactor);
  const terminalDiscretion = establishOnEstate(scope, 'discretion', terminalGeometry.familyMask, terminalToolFactor);

  const doorObstacle = law.obstacles[DOOR_OBSTACLE];
  const doorOutcome = evaluateObstacle(scope, doorObstacle, DOOR_OBSTACLE, true, resolveGeometry(scope, doorObstacle), 0, diagnostics);
  // The anchoring reads the terminal obstacle's estate, whose geometry the door has since
  // overwritten in the scratch arrays.
  resolveGeometry(scope, terminal);
  return {
    outcome: doorOutcome,
    anchoringSilence: anchoringSilenceOf(
      scope,
      terminal,
      terminalGeometry,
      terminalDiscretion,
      terminalToolFactor,
      doorOutcome.emitted,
    ),
    anchoring,
  };
};

/**
 * The first obstacle of the full chain a what-if on this world can change, 0 when it may read
 * nothing back: on a baseline of another draw, an interdiction on a moved world, or a control moved
 * in place.
 */
const resumeAt = (world: PreparedWorld, interdiction: TechniqueInterdiction | undefined): number => {
  if (world.baseline.draw !== world.draw) {
    return 0;
  }
  if (interdiction !== undefined) {
    return world.movedControl === AT_DRAW ? world.resume[interdiction.lever][interdiction.technique] : 0;
  }
  return world.movedControl >= 0 ? world.resume.control[world.movedControl] : 0;
};

/**
 * The door is evaluated once and each chain an attack can take folds from it: the long chain
 * through the other assets, the direct one through the targets, and the one around the door. A
 * direct chain equal to the long chain is not played twice; the long one then takes the whole door.
 * A share of one around the door leaves the door, the long and the direct chains no weight: only
 * the chain around the door is folded.
 */
const evaluate = (
  world: PreparedWorld,
  interdiction: TechniqueInterdiction | undefined,
  diagnostics: Array<ObstacleDiagnostic> | undefined,
  forgoneExploit: number,
  baselineUse: 'record' | 'resume' | undefined,
): AttackRunEvaluation => {
  const law = world.law;
  const constants = law.inputs.constants;
  const scope: EvaluationScope = {
    world,
    law,
    constants,
    interdictedPrevent: interdiction?.lever === 'prevent' ? interdiction.technique : -1,
    interdictedDetect: interdiction?.lever === 'detect' ? interdiction.technique : -1,
    forgoneExploit,
  };
  const terminal = law.obstacles[law.obstacles.length - 1];
  const recorded = world.baseline;
  const from = baselineUse === 'resume' ? resumeAt(world, interdiction) : 0;
  const head = from >= 1 ? recorded.head! : headOf(scope, terminal, diagnostics);
  if (baselineUse === 'record') {
    recorded.draw = world.draw;
    recorded.head = head;
    recorded.long.length = 0;
    recorded.direct.length = 0;
  }
  const traceOf = (outcomes: Array<ObstacleOutcome>, indexes: ReadonlyArray<number>): ChainTrace | undefined => {
    if (baselineUse === 'record') {
      return { kind: 'record', outcomes };
    }
    let replayed = 0;
    while (replayed < indexes.length && indexes[replayed] < from) {
      replayed += 1;
    }
    return replayed === 0 ? undefined : { kind: 'replay', outcomes, replayed };
  };

  const { anchoring } = head;
  const { doorTarget, doorOther } = head.outcome;
  const around = law.chains.withoutInitialAccess;
  const aroundOnly = around !== null && around.share >= 1;
  const directIndexes = law.chains.direct;
  const directIsLong = directIndexes === null;
  const longFold = aroundOnly
    ? null
    : foldChain(
      scope,
      { indexes: world.longChain, hasDoor: true, terminal },
      head,
      directIsLong ? doorTarget + doorOther : doorOther,
      diagnostics,
      traceOf(recorded.long, world.longChain),
    );
  const clearByObstacle = aroundOnly ? law.obstacles.map(() => 0) : [...world.scratchClear];
  clearByObstacle[0] = doorTarget + doorOther;
  const firstDetectionAtObstacle = aroundOnly ? law.obstacles.map(() => 0) : [...world.scratchFirstDetection];

  let directFold: ChainFold | null = null;
  let directClears: Array<number> | null = null;
  if (directIndexes !== null && doorTarget > 0 && !aroundOnly) {
    directFold = foldChain(scope, { indexes: directIndexes, hasDoor: true, terminal }, head, doorTarget, undefined, traceOf(recorded.direct, directIndexes));
    directClears = Array.from(world.scratchClear.subarray(0, directIndexes.length));
  }

  const aroundFold = around === null
    ? null
    : foldChain(scope, { indexes: world.terminalChain, hasDoor: false, terminal: around.obstacle, oneAttempt: true }, head, 0, undefined);

  const mixed = mixAttackPaths({
    doorTarget,
    doorOther,
    direct: directFold?.outcomes ?? null,
    long: longFold?.outcomes ?? null,
    withoutInitialAccessShare: around?.share ?? 0,
    withoutInitialAccess: aroundFold?.outcomes ?? null,
  });

  return {
    outcomes: mixed.outcomes,
    reach: longFold !== null && directFold === null && aroundFold === null ? longFold.reach : 1 - mixed.outcomes.blocked,
    paths: mixed.shares,
    direct: directClears === null ? null : { clearByObstacle: directClears },
    reachedUnseen: longFold?.reachedUnseen ?? 0,
    unseen: longFold?.unseen ?? 0,
    clearByObstacle,
    firstDetectionAtObstacle,
    firstDetectionAtAnchoring: longFold?.firstDetectionAtAnchoring ?? 0,
    anchoring,
    eviction: longFold?.eviction ?? 0,
    detectPosture: longFold?.detectPosture ?? 0,
  };
};

/**
 * `forgoneExploit` is an index into the door's CVEs, -1 for none. It is read by this evaluation
 * alone: nothing of the world is written, so the next evaluation starts from the draw again.
 */
export const evaluateAttackRun = (
  world: PreparedWorld,
  interdiction?: TechniqueInterdiction,
  diagnostics?: Array<ObstacleDiagnostic>,
  forgoneExploit = -1,
): AttackRunEvaluation => evaluate(world, interdiction, diagnostics, forgoneExploit, undefined);

/**
 * A world's baseline, evaluated as `evaluateAttackRun` does and recorded on the world for
 * `evaluateWhatIf`. Throws unless every control is at its drawn state.
 */
export const evaluateBaseline = (world: PreparedWorld): AttackRunEvaluation => {
  if (world.movedControl !== AT_DRAW) {
    throw newError('A baseline is evaluated with every control at its drawn state', { movedControl: world.movedControl });
  }
  return evaluate(world, undefined, undefined, -1, 'record');
};

/**
 * A technique interdiction, or the move of the one control `refreshWorld` was given, answered as
 * `evaluateAttackRun` would. The door and the obstacles before the first one the what-if can change
 * are read back from the baseline the world recorded on its draw, the rest evaluated; on any other
 * state of the world the whole chain is evaluated.
 */
export const evaluateWhatIf = (world: PreparedWorld, interdiction?: TechniqueInterdiction): AttackRunEvaluation =>
  evaluate(world, interdiction, undefined, -1, 'resume');

/** Per what-if, the first obstacle of the full chain it can change. */
interface ResumePoints {
  /** Per repertoire technique, its prevent and its detect interdiction. */
  readonly prevent: Int32Array,
  readonly detect: Int32Array,
  /** Per control, any move of it. */
  readonly control: Int32Array,
}

/**
 * An interdiction resumes at the first obstacle that plays its technique, and a moved control at the
 * first obstacle playing a technique it prevents or detects: the obstacles before read neither,
 * neither product moves their knockouts, and a moved control's own knockout there takes down no
 * product they read. The door is obstacle 0, so what it plays gets 0, no resumption, and so does what
 * the anchoring and every obstacle read: a support technique (tooling, discretion, sabotage,
 * persistence and channel), a prevent interdiction naming a phishing stage, which the door reads
 * whether or not an obstacle plays the technique, and a control covering any of them or acting at a
 * stage. Any other technique no obstacle plays resumes past the last.
 */
const resumePointsOf = (law: CompiledAttackRunLaw): ResumePoints => {
  const everywhere = new Set<number>();
  for (const name of ['tooling', 'discretion', 'sabotage', 'persistence', 'channel'] as const) {
    law.functions[name].techniques.forEach((technique) => everywhere.add(technique));
  }
  const first = new Int32Array(law.techniqueCount).fill(law.obstacles.length);
  law.obstacles.forEach((obstacle, index) => {
    for (const technique of obstacle.techniques) {
      first[technique] = Math.min(first[technique], index);
    }
  });
  const ofTechnique = (technique: number): number => (everywhere.has(technique) ? 0 : first[technique]);
  const phishing = law.phishing !== null;
  return {
    prevent: Int32Array.from({ length: law.techniqueCount }, (_, technique) =>
      (phishing && law.phishingStageOfTechnique[technique] >= 0 ? 0 : ofTechnique(technique))),
    detect: Int32Array.from({ length: law.techniqueCount }, (_, technique) => ofTechnique(technique)),
    control: Int32Array.from(law.controls, (control) => (phishing && control.phishingStage >= 0
      ? 0
      : [...control.preventTechniques, ...control.detectTechniques].reduce((least, technique) => Math.min(least, ofTechnique(technique)), law.obstacles.length))),
  };
};
