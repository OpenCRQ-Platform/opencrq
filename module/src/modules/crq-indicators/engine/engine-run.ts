import type { ActorClass } from '../../threat-analyses/actor-classes';
import type { UnknownExposureCountsAs } from '../../attack-surfaces/entry-applicability';
import type { DeclaredCriticality } from '../../supporting-assets/constants';
import type { AttackRunActorClass, AttackRunConstants, AttackRunDeclaredKind, AttackRunGroup, AttackRunTechnique, AttackRunTestedCell, AttackRunWithoutInitialAccess, CompiledAttackRunLaw } from './attack-run-law';
import type { AttackRunControlDeclaration, AttackRunWorlds, ControlLever, ControlTarget, ControlWorldColumns, PertRange } from './attack-run-worlds';
import type { CoverageBucket, StrengthRung } from '../../controls/capability/constants';
import type { AttackRunControlState, AttackRunOutcomes, PreparedWorld } from './attack-run-evaluation';
import type { AnnualLossDistribution } from './annual-loss';
import type { AttackPathShares } from './attack-paths-mix';
import type { DoorEstate } from './attack-run-door';
import { newError } from '@app/utils';
import { buildObstacles } from './attack-run-obstacles';
import { compileAttackRunLaw, phishingStageNameOf } from './attack-run-law';
import { evaluateAttackRun, evaluateBaseline, evaluateWhatIf, forgoneExploitLeavesDoor, inTimeOf, prepareWorld, refreshWorld, setControlState } from './attack-run-evaluation';
import {
  buildAttackRunWorlds,
  controlStateAt,
  controlWorldSpec,
  declaredPreventEfficacy,
  nextCoverageBucket,
  nextStrengthRung,
  targetStateAt,
  worldDrawAt,
} from './attack-run-worlds';
import { ATTACK_RUN_CALIBRATION_VINTAGE, ATTACK_RUN_CORNER_CONSTANTS } from './attack-run-constants';
import { ANNUAL_LOSS_YEARS_PER_WORLD, sampleAnnualLosses } from './annual-loss';
import { pertQuantile } from './distributions';
import { pricedFraction } from './priced-fraction';
import { createPrng, deriveSeed } from './prng';

/**
 * Relative band around zero where a flaw's what-if counts for exactly 0. The flaw's own law sums
 * its groups in another order than the baseline's, which moves the ALE by about 1e-15 relative;
 * past this band that rounding cannot change the sign, and inside it a real effect is below it.
 */
const CVE_WHAT_IF_EXACT_BAND = 1e-12;

/**
 * One run: a scenario, its actors, and the three answers the product owes.
 *
 * The loop is inverted from the naive reading. A world is a hypothesis about the **defence**, and
 * the defence does not change from one actor to the next, so a scenario draws its worlds once and
 * evaluates every actor inside each one. The world count is therefore never multiplied by the actor
 * count, every actor gets the precision `N` would give it alone, and a cross-actor comparison is a
 * paired decomposition rather than a difference of two noisy estimates.
 *
 * Three passes share those worlds: the baseline, two evaluations per technique interdicted, and the
 * lever what-ifs per control, each the same world with that one control moved, so a difference to
 * the baseline carries no sampling noise.
 *
 * Nothing here is asynchronous. The run is advanced world by world by its caller, which is what
 * owns the yield discipline: a synchronous world loop would hold the thread through the job's lease
 * renewal and stall every HTTP request in the same process meanwhile.
 */

/** One attacker of the mixture: a single actor, or an actor class standing for several. */
export interface EngineRunActor {
  /** Unique within the run. */
  readonly key: string,
  readonly name: string | null,
  readonly actorClass: ActorClass,
  readonly knobs: AttackRunActorClass,
  /** The share of the declared TEF this attacker carries. */
  readonly share: number,
  readonly repertoire: ReadonlyArray<AttackRunTechnique>,
  /**
   * The estate as this attacker sees it. The groups carry a floored-route mask bounded by its
   * repertoire and its known-exploited CVEs, so they are resolved per attacker rather than once for
   * the scenario: a bit set for one actor's CVE would floor a route for an actor that never
   * exploits it.
   */
  readonly groups: ReadonlyArray<AttackRunGroup>,
  /**
   * For each priced CVE some group of this attacker loses its floor to, sorted by `cveId`, the estate
   * as the CVE's removal leaves it: each asset that changes is regrouped by the mask it keeps, or
   * poured into the floor-free group of its key. The CVE's what-if reads this law and no other. A CVE
   * absent from it has no floor to forgo.
   */
  readonly cveGroups?: ReadonlyArray<EngineRunCveGroups>,
}

export interface EngineRunCveGroups {
  /** The id of the `cve` row. */
  readonly cveId: string,
  readonly groups: ReadonlyArray<AttackRunGroup>,
}

export interface EngineRunControl extends AttackRunControlDeclaration {
  readonly controlId: string,
  readonly preventTechniqueExternalIds: ReadonlyArray<string>,
  readonly detectTechniqueExternalIds: ReadonlyArray<string>,
  /** What OpenAEV observed of the control on the run's scope; a lever or a plan moves the declaration and keeps it. */
  readonly tested?: ReadonlyArray<AttackRunTestedCell>,
}

export interface EngineRunInputs {
  readonly terminalTacticExternalId: string,
  readonly controls: ReadonlyArray<EngineRunControl>,
  readonly actors: ReadonlyArray<EngineRunActor>,
  readonly tef: PertRange | null,
  /** One PERT range per loss driver of the scenario; they sum into the magnitude of one loss event. */
  readonly lossDrivers: ReadonlyArray<PertRange>,
  readonly reactionTimeHours: PertRange,
  readonly constants: AttackRunConstants,
  /** What the estate offers the initial access campaign, shared by every actor of the run. */
  readonly door: DoorEstate,
  /**
   * The CVEs a what-if prices although the door lists none of them: an actor cites them and the
   * estate carries them, so their floor after the door is all they weigh. Sorted by `cveId`, none
   * duplicated, none a CVE of the door. They take the indexes after the door's.
   */
  readonly floorCves?: ReadonlyArray<{ readonly cveId: string }>,
  /** What the tenant declares about the people the phishing campaign reaches. */
  readonly phishing: {
    /** The share of an email's recipients a simulation caught, measured under today's training; null when none is declared. */
    readonly declaredSusceptibility: number | null,
  },
  /** The attack path the scenario's outcome sends around the door. Absent means none does. */
  readonly withoutInitialAccess?: AttackRunWithoutInitialAccess,
  /** What an unknown exposure counts as wherever the law reads an exposure: the step weights and the path around the door. */
  readonly unknownExposureCountsAs: UnknownExposureCountsAs,
  /** What an unknown criticality counts as in the step weights. */
  readonly unknownCriticalityCountsAs: DeclaredCriticality,
  /** The declared kinds each world draws a count of, which the actors' groups and the door name. Absent when none is. */
  readonly declaredKinds?: ReadonlyArray<AttackRunDeclaredKind>,
  readonly worlds: number,
  readonly seed: string,
  /**
   * The treatment plans this run prices, whatever their status. Optional so the fixtures that build
   * these inputs by hand keep pricing exactly what they priced before.
   */
  readonly plans?: ReadonlyArray<EngineRunPlan>,
  /** Postures priced only to be differenced against one another, as `basketDifferences` names them. */
  readonly baskets?: ReadonlyArray<EngineRunBasket>,
  readonly basketDifferences?: ReadonlyArray<EngineRunBasketDifference>,
  /**
   * Baskets whose annual loss the run also draws, as it draws its own and on the same seeds, so a
   * basket's years are paired with the run's own rather than drawn apart from them.
   */
  readonly annualLossBaskets?: ReadonlyArray<string>,
  /** The what-if passes beyond the baseline and its memoryless replay; every one of them when absent. */
  readonly whatIfs?: EngineRunWhatIfs,
}

/**
 * The baseline does not depend on these: every draw comes from its own seeded stream and the
 * baseline rebuilds its world before it evaluates, so a run skipping some of them answers the
 * headline, and every what-if it keeps, bit for bit.
 */
export interface EngineRunWhatIfs {
  readonly techniques: boolean,
  /** The what-if of each priced CVE of the door and each floor-only one; a run skipping it returns no `cveValues`. */
  readonly cves: boolean,
  readonly leverControlIds: 'all' | ReadonlySet<string>,
}

export interface EngineRunPlanMove {
  /** The capability the move names; a move naming no control of the run is dropped. */
  readonly controlId: string,
  readonly targetStrengthRung: StrengthRung | null,
  readonly targetCoverageBucket: CoverageBucket | null,
}

export interface EngineRunPlan {
  readonly planId: string,
  readonly moves: ReadonlyArray<EngineRunPlanMove>,
}

/** A posture resolved as a plan's is, axis by axis, a null axis keeping the declaration. */
export interface EngineRunBasket {
  readonly basketId: string,
  readonly moves: ReadonlyArray<EngineRunPlanMove>,
}

/**
 * `ALE(minuend) - ALE(subtrahend)`, world by world, so its spread is the difference's own. A null
 * basket is the run's own posture.
 */
export interface EngineRunBasketDifference {
  readonly key: string,
  readonly minuendBasketId: string | null,
  readonly subtrahendBasketId: string | null,
}

export interface AttackRunSpread {
  readonly mean: number,
  readonly p5: number,
  readonly p10: number,
  readonly p50: number,
  readonly p90: number,
  readonly p95: number,
}

/**
 * Why a lever is worth exactly zero. A zero with no reason next to it reads as a defect of the
 * engine; every one of these reads as a fact about the tenant, the actor or the declaration.
 */
export type ZeroLeverReason = 'actor-repertoire' | 'estate-families' | 'already-maximal';

/**
 * The moves a control can be asked about.
 *
 * Two of them move one axis and hold the other, which is what makes their deltas comparable.
 * The third is the **anchor step**, and it exists because a control declared at neither rung nor
 * coverage instantiates no edge at all: raising its rung alone changes nothing, since it protects
 * no asset, and widening its coverage alone changes nothing, since what it protects it does not
 * stop. Only the joint step answers anything, and it is the move a tenant most often has in front
 * of it, because it is the control it does not have yet.
 */
export type AttackRunLeverDimension = 'strength' | 'coverage' | 'deploy';

export interface AttackRunControlLever {
  readonly dimension: AttackRunLeverDimension,
  readonly upgradedStrengthRung: StrengthRung,
  readonly upgradedCoverageBucket: CoverageBucket,
  readonly aleReduction: AttackRunSpread,
  readonly zeroReason: ZeroLeverReason | null,
}

export interface AttackRunControlValue {
  readonly controlId: string,
  readonly capabilityExternalId: string,
  readonly declaredStrengthRung: StrengthRung,
  readonly declaredCoverageBucket: CoverageBucket,
  /** The moves worth asking about for this declaration, and only those. */
  readonly levers: ReadonlyArray<AttackRunControlLever>,
}

export interface AttackRunPlanValue {
  readonly planId: string,
  /** `ALE(declared) - ALE(the whole plan in place)`, world by world, on the run's own worlds. */
  readonly aleReduction: AttackRunSpread,
}

export interface AttackRunBasketDifferenceValue {
  readonly key: string,
  readonly value: AttackRunSpread,
}

export interface AttackRunBasketAnnualLoss {
  readonly basketId: string,
  readonly annualLoss: AnnualLossDistribution,
}

export interface AttackRunCveValue {
  readonly cveId: string,
  /** `ALE(as declared) - ALE(this flaw's exploit never in circulation)`, world by world, on the run's own worlds. */
  readonly aleReductionMean: number,
  readonly aleReductionP10: number,
  readonly aleReductionP90: number,
}

export interface AttackRunTechniqueValue {
  readonly actorKey: string,
  readonly techniqueExternalId: string,
  /** `ALE(as declared) - ALE(this technique never succeeding)`. */
  readonly preventValue: number,
  /** `ALE(as declared) - ALE(this technique's detection fully covered)`. */
  readonly detectValue: number,
}

export interface AttackRunActorResult {
  readonly key: string,
  readonly name: string | null,
  readonly actorClass: ActorClass,
  readonly share: number,
  readonly outcomes: AttackRunOutcomes,
  /** Where this actor's attacks end up by the path they took, over the worlds. */
  readonly paths: AttackPathShares,
  readonly aleMean: number,
  /** The probability an attack of this actor lands an impact. */
  readonly vulnerability: AttackRunSpread,
  /** Obstacles this actor's repertoire cannot play at all, named rather than shown as a silent zero. */
  readonly unplayableObstacleKeys: ReadonlyArray<string>,
  /** The repertoire's techniques some chain plays, which are the ones scored. */
  readonly playedTechniqueExternalIds: ReadonlyArray<string>,
  /** The clock this actor's race ran against, in days. */
  readonly attackRunDays: number,
  /**
   * The probability the reaction time exceeds even the long chain's door window, the widest of every
   * chain, so that no detection is followed by an eviction. At one, every detect control is worth
   * zero here. Null when every attack goes around the door: that chain has no window to react in,
   * whatever the reaction time.
   */
  readonly reactionTimeExceededShare: number | null,
}

/**
 * What a run says about its own constants, which surface obligation 10 requires beside every figure
 * it displays. The gain of the detection accumulator is chosen rather than fitted, and its road
 * back is exact: at a gain of zero the law is memoryless. So the run answers the same scenario with
 * the accumulator switched off, on the same worlds, and a reader can see what the choice bought.
 */
export interface AttackRunCalibrationReport {
  readonly vintage: string,
  /** The ALE this run would have answered with the detection accumulator off. */
  readonly memorylessAle: number,
  readonly cornerConstants: ReadonlyArray<string>,
}

export interface EngineRunResult {
  readonly worlds: number,
  readonly calibrationVintage: string,
  readonly calibration: AttackRunCalibrationReport,
  readonly outcomes: AttackRunOutcomes,
  /** Mixture-weighted, like `outcomes`: the shares sum to 1. */
  readonly paths: AttackPathShares,
  /** Mixture-weighted probability that an attack lands an impact, per world. */
  readonly vulnerability: AttackRunSpread,
  readonly lef: AttackRunSpread,
  readonly ale: AttackRunSpread,
  /** One value per world, shared by every actor: the cost of one attack that lands. */
  readonly magnitude: AttackRunSpread,
  /** Drawn on the three priced outcomes, each priced as the ALE prices it, so the mean stays the ALE. */
  readonly annualLoss: AnnualLossDistribution,
  readonly actors: ReadonlyArray<AttackRunActorResult>,
  readonly controlValues: ReadonlyArray<AttackRunControlValue>,
  readonly planValues: ReadonlyArray<AttackRunPlanValue>,
  readonly basketDifferenceValues: ReadonlyArray<AttackRunBasketDifferenceValue>,
  /** One per basket `annualLossBaskets` names, in its order. */
  readonly basketAnnualLosses: ReadonlyArray<AttackRunBasketAnnualLoss>,
  readonly techniqueValues: ReadonlyArray<AttackRunTechniqueValue>,
  /** One per priced CVE of the door, in the door's order, then one per floor-only CVE. */
  readonly cveValues: ReadonlyArray<AttackRunCveValue>,
}

const UPGRADED_COVERAGE: ControlLever = { strength: 'declared', coverage: 'upgraded' };
const UPGRADED_STRENGTH: ControlLever = { strength: 'upgraded', coverage: 'declared' };
const ANCHOR_STEP: ControlLever = { strength: 'upgraded', coverage: 'upgraded' };

const LEVER_MOVE: Readonly<Record<AttackRunLeverDimension, ControlLever>> = {
  strength: UPGRADED_STRENGTH,
  coverage: UPGRADED_COVERAGE,
  deploy: ANCHOR_STEP,
};

/**
 * The moves worth asking about for one declaration, and only those, in the order a control value
 * lists them.
 *
 * An axis is offered only where it can move the answer, which is decided by the other axis. A
 * control declared at no rung has no strength to widen the coverage of, and one declared at no
 * coverage protects no asset to raise the rung on: those deltas are exactly zero by arithmetic,
 * and a zero on a card reads as a defect of the engine rather than as the shape of a declaration.
 * Where both axes are at the anchor the only move that answers anything is the joint one, which
 * is the control the tenant does not own yet.
 */
const offeredLevers = (control: EngineRunControl): ReadonlyArray<AttackRunLeverDimension> => {
  const unrated = control.strengthRung === 'L0';
  const undeployed = control.coverageBucket === 'L0';
  if (unrated && undeployed) {
    return ['deploy'];
  }
  return [
    ...(undeployed ? [] : ['strength' as const]),
    ...(unrated ? [] : ['coverage' as const]),
  ];
};

/** The anchor step is never at its ceiling: it is offered only to a control declared at neither axis. */
const atCeiling = (columns: ControlWorldColumns, dimension: AttackRunLeverDimension): boolean => {
  switch (dimension) {
    case 'strength':
      return columns.strengthIsMaximal;
    case 'coverage':
      return columns.coverageIsMaximal;
    case 'deploy':
      return false;
  }
};

const meanOf = (values: Float64Array): number => {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return values.length === 0 ? 0 : total / values.length;
};

export const spreadOf = (values: Float64Array): AttackRunSpread => {
  if (values.length === 0) {
    return { mean: 0, p5: 0, p10: 0, p50: 0, p90: 0, p95: 0 };
  }
  const sorted = Float64Array.from(values).sort();
  return {
    mean: meanOf(values),
    p5: sorted[Math.floor(0.05 * sorted.length)],
    p10: sorted[Math.floor(0.1 * sorted.length)],
    p50: sorted[Math.floor(0.5 * sorted.length)],
    p90: sorted[Math.floor(0.9 * sorted.length)],
    p95: sorted[Math.floor(0.95 * sorted.length)],
  };
};

const stratifiedPert = (range: PertRange | null, worlds: number, seed: number): Float64Array => {
  const column = new Float64Array(worlds);
  if (range === null) {
    return column;
  }
  const cells = new Int32Array(worlds);
  for (let index = 0; index < worlds; index += 1) {
    cells[index] = index;
  }
  const random = createPrng(seed);
  for (let index = worlds - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const held = cells[index];
    cells[index] = cells[swap];
    cells[swap] = held;
  }
  const table = new Float64Array(worlds);
  for (let cell = 0; cell < worlds; cell += 1) {
    table[cell] = pertQuantile(range.min, range.likely, range.max, (cell + 0.5) / worlds);
  }
  for (let index = 0; index < worlds; index += 1) {
    column[index] = table[cells[index]];
  }
  return column;
};

interface ActorState {
  readonly input: EngineRunActor,
  readonly law: CompiledAttackRunLaw,
  readonly world: PreparedWorld,
  /** The same law with the accumulator off, which is the gain's exact road back. */
  readonly memorylessWorld: PreparedWorld,
  /** Per control, whether it contests anything this actor plays on a family the estate carries. */
  readonly reaches: ReadonlyArray<boolean>,
  /**
   * Per door CVE, whether it opens a technique this actor's door plays on some asset of the estate.
   * A CVE with a world of its own is evaluated whether or not it does.
   */
  readonly doorCveOpensPlayed: ReadonlyArray<boolean>,
  /** Per door CVE then per floor-only one, the world of the law over the estate regrouped without that CVE; null when it has none. */
  readonly cveWorlds: ReadonlyArray<PreparedWorld | null>,
  readonly outcomeTotals: { blocked: number, evicted: number, impactDetected: number, impactUndetected: number },
  readonly pathTotals: { stoppedAtInitialAccess: number, direct: number, long: number, withoutInitialAccess: number },
  readonly aleTotals: Float64Array,
  readonly vulnerabilitySeries: Float64Array,
  readonly techniquePreventAle: Float64Array,
  readonly techniqueDetectAle: Float64Array,
}

export interface EngineRun {
  readonly worlds: number,
  readonly advance: (count: number) => void,
  /**
   * Runs at least one evaluation step of an unfinished run, then stops at the first step boundary
   * where `shouldPause` answers true. A step is a handful of evaluations, far shorter than a world, and where the run
   * pauses never changes its result.
   */
  readonly advanceUntil: (shouldPause: () => boolean) => void,
  readonly done: () => boolean,
  readonly result: () => EngineRunResult,
}

/** One resolved move of one plan: which control of the run it moves, and to what. */
interface PlanMovePass {
  readonly controlIndex: number,
  readonly target: ControlTarget,
}

/** One expected count per world of each kind of event the annual loss draws. */
interface EventRates {
  readonly evicted: Float64Array,
  readonly impactDetected: Float64Array,
  readonly impactUndetected: Float64Array,
}

const eventRatesOf = (worldCount: number): EventRates => ({
  evicted: new Float64Array(worldCount),
  impactDetected: new Float64Array(worldCount),
  impactUndetected: new Float64Array(worldCount),
});

const NO_OUTCOME: AttackRunOutcomes = { blocked: 0, evicted: 0, impactDetected: 0, impactUndetected: 0 };

const addEventRates = (rates: EventRates, world: number, weight: number, outcomes: AttackRunOutcomes): void => {
  rates.evicted[world] += weight * outcomes.evicted;
  rates.impactDetected[world] += weight * outcomes.impactDetected;
  rates.impactUndetected[world] += weight * outcomes.impactUndetected;
};

/** Two states an evaluation cannot tell apart: an absent control carries no efficacy anywhere. */
const sameControlState = (one: AttackRunControlState, other: AttackRunControlState): boolean =>
  (!one.deployed && !other.deployed)
  || (one.deployed === other.deployed
    && one.preventEfficacy === other.preventEfficacy
    && one.detectEfficacy === other.detectEfficacy
    && one.phishingStageEfficacy === other.phishingStageEfficacy);

/** Whether some layer of the actor's door plays T1566, where the controls acting at a stage of a campaign have an effect. */
const playsPhishing = (law: CompiledAttackRunLaw): boolean =>
  law.phishing !== null && law.door.layers.some((layer) => layer.repertoire[law.phishing!.technique] >= 0);

/**
 * Whether each CVE of the door opens, on some asset, a technique one of the actor's door layers
 * plays. A CVE that does not leaves every pass the door weighs unchanged, so forgoing its exploit
 * answers the baseline exactly.
 */
const doorCvesOpeningPlayed = (law: CompiledAttackRunLaw, door: DoorEstate): Array<boolean> => {
  const played = door.techniques.map((_, technique) => law.door.layers.some((layer) => layer.repertoire[technique] >= 0));
  const opensPlayed = door.cves.map(() => false);
  for (const asset of door.assets) {
    for (const entry of asset.openings) {
      if (played[entry.technique] && entry.opening > 0) {
        opensPlayed[entry.cve] = true;
      }
    }
  }
  for (const person of door.phishing?.persons ?? []) {
    for (const device of person.devices) {
      for (const entry of device.openings) {
        if (played[entry.technique] && entry.opening > 0) {
          opensPlayed[entry.cve] = true;
        }
      }
    }
  }
  return opensPlayed;
};

export const createEngineRun = (inputs: EngineRunInputs): EngineRun => {
  const worldCount = inputs.worlds;
  const plans = inputs.plans ?? [];
  const baskets = inputs.baskets ?? [];
  const controlIndexById = new Map(inputs.controls.map((control, index) => [control.controlId, index]));
  /*
   * A plan is priced at the posture it names, axis by axis, a null axis keeping the declaration.
   * The target is a commitment and not a floor, so a move naming less than what is now in place
   * lowers the control and the plan's saving comes out negative: that is what a plan the estate has
   * overtaken has become, read as written. A basket is priced the same way, after the plans.
   */
  const postures = [...plans, ...baskets];
  const planPasses: ReadonlyArray<ReadonlyArray<PlanMovePass>> = postures.map((posture) => posture.moves.flatMap((move) => {
    const controlIndex = controlIndexById.get(move.controlId);
    if (controlIndex === undefined) {
      return [];
    }
    const control = inputs.controls[controlIndex];
    const strengthRung = move.targetStrengthRung ?? control.strengthRung;
    const coverageBucket = move.targetCoverageBucket ?? control.coverageBucket;
    return [{ controlIndex, target: { strengthRung, coverageBucket } }];
  }));

  const controlSpecs = inputs.controls.map((control) => controlWorldSpec(control, {
    phishingStage: phishingStageNameOf(control.preventTechniqueExternalIds),
  }));
  const lawControls = inputs.controls.map((control, index) => ({ ...control, declaredPreventEfficacy: declaredPreventEfficacy(controlSpecs[index]) }));
  const columns: AttackRunWorlds = buildAttackRunWorlds({
    controls: controlSpecs,
    obstacleCount: buildObstacles(inputs.terminalTacticExternalId).length,
    reactionTimeHours: inputs.reactionTimeHours,
    worlds: worldCount,
    seed: inputs.seed,
    cveIds: inputs.door.cves.map((cve) => cve.cveId),
    familyIds: inputs.door.families,
    declaredKinds: inputs.declaredKinds,
  });

  const whatIfs: EngineRunWhatIfs = inputs.whatIfs ?? { techniques: true, cves: true, leverControlIds: 'all' };
  /* Without a frequency or a magnitude every world's scale is zero, so every what-if is exactly zero
   * whether or not it is evaluated: the run reports the same rows for the cost of its baseline. */
  const evaluatesWhatIfs = inputs.tef !== null && inputs.lossDrivers.length > 0;
  const evaluatesTechniques = evaluatesWhatIfs && whatIfs.techniques;
  const evaluatesCves = evaluatesWhatIfs && whatIfs.cves;

  const floorCves = inputs.floorCves ?? [];
  const doorCveCount = inputs.door.cves.length;
  /** The CVEs a what-if prices, by index: the door's, then the floor-only ones. */
  const ownLawCveIds = new Set(inputs.actors.flatMap((actor) => (actor.cveGroups ?? []).map((entry) => entry.cveId)));
  /* A door CVE below the silence threshold is priced all the same when some actor has a law of its own for it. */
  const whatIfCves = [
    ...inputs.door.cves.map((cve) => ({ cveId: cve.cveId, priced: cve.priced || ownLawCveIds.has(cve.cveId) })),
    ...floorCves.map((cve) => ({ cveId: cve.cveId, priced: true })),
  ];

  const actors: Array<ActorState> = inputs.actors.map((actor) => {
    const lawInputs = {
      terminalTacticExternalId: inputs.terminalTacticExternalId,
      actorClass: actor.knobs,
      repertoire: actor.repertoire,
      groups: actor.groups,
      controls: lawControls,
      constants: inputs.constants,
      door: inputs.door,
      withoutInitialAccess: inputs.withoutInitialAccess,
      unknownExposureCountsAs: inputs.unknownExposureCountsAs,
      unknownCriticalityCountsAs: inputs.unknownCriticalityCountsAs,
      declaredKinds: inputs.declaredKinds,
      phishing: { actorClass: actor.actorClass, declaredSusceptibility: inputs.phishing.declaredSusceptibility },
    };
    const law = compileAttackRunLaw(lawInputs);
    const memoryless = compileAttackRunLaw({ ...lawInputs, constants: { ...inputs.constants, signalGain: 0 } });
    const cveGroupsById = new Map((actor.cveGroups ?? []).map((entry) => [entry.cveId, entry.groups]));
    const world = prepareWorld(law, worldDrawAt(columns, 0));
    const cveWorlds = whatIfCves.map((cve) => {
      const groups = cveGroupsById.get(cve.cveId);
      return groups === undefined || !cve.priced || !evaluatesCves
        ? null
        : prepareWorld(compileAttackRunLaw({ ...lawInputs, groups }), worldDrawAt(columns, 0), world);
    });
    return {
      input: actor,
      law,
      world,
      memorylessWorld: prepareWorld(memoryless, worldDrawAt(columns, 0)),
      reaches: law.controls.map((control) => control.familyIndexes.length > 0
        && (control.preventTechniques.length > 0 || control.detectTechniques.length > 0
          || (control.phishingStage >= 0 && playsPhishing(law)))),
      doorCveOpensPlayed: doorCvesOpeningPlayed(law, inputs.door),
      cveWorlds,
      outcomeTotals: { blocked: 0, evicted: 0, impactDetected: 0, impactUndetected: 0 },
      pathTotals: { stoppedAtInitialAccess: 0, direct: 0, long: 0, withoutInitialAccess: 0 },
      aleTotals: new Float64Array(worldCount),
      vulnerabilitySeries: new Float64Array(worldCount),
      techniquePreventAle: new Float64Array(actor.repertoire.length),
      techniqueDetectAle: new Float64Array(actor.repertoire.length),
    };
  });

  const tefColumn = stratifiedPert(inputs.tef, worldCount, deriveSeed(inputs.seed, 'tef'));
  const magnitudeColumn = new Float64Array(worldCount);
  inputs.lossDrivers.forEach((driver, index) => {
    const column = stratifiedPert(driver, worldCount, deriveSeed(inputs.seed, `loss-driver:${index}`));
    for (let world = 0; world < worldCount; world += 1) {
      magnitudeColumn[world] += column[world];
    }
  });

  const controlLevers = inputs.controls.map(offeredLevers);
  const leverPriced = inputs.controls.map((control) => whatIfs.leverControlIds === 'all' || whatIfs.leverControlIds.has(control.controlId));

  const lefSeries = new Float64Array(worldCount);
  const eventRates = eventRatesOf(worldCount);
  const aleSeries = new Float64Array(worldCount);
  const memorylessAleSeries = new Float64Array(worldCount);
  const vulnerabilitySeries = new Float64Array(worldCount);
  const leverSeries = inputs.controls.map(() => ({
    strength: new Float64Array(worldCount),
    coverage: new Float64Array(worldCount),
    deploy: new Float64Array(worldCount),
  }));
  /** The whole posture of one plan or basket, priced per world and summed over the mixture like `aleSeries`. */
  const planSeries = postures.map(() => new Float64Array(worldCount));
  const basketIndexById = new Map(baskets.map((basket, index) => [basket.basketId, plans.length + index]));
  const postureIndexOf = (basketId: string): number => {
    const index = basketIndexById.get(basketId);
    if (index === undefined) {
      throw newError('A basket difference or annual loss names a basket the run was not given', { basketId });
    }
    return index;
  };
  const annualLossBaskets = inputs.annualLossBaskets ?? [];
  const sampledRates = new Map(annualLossBaskets.map((basketId) => [postureIndexOf(basketId), eventRatesOf(worldCount)]));
  /** The saving of fixing each priced flaw of the door, per world, summed over the mixture like `aleSeries`. */
  const cveSeries = whatIfCves.map((cve) => (cve.priced && whatIfs.cves ? new Float64Array(worldCount) : null));

  let next = 0;
  let pending: Generator<void, void, undefined> | null = null;

  const evaluateWorld = function* evaluateWorld(world: number): Generator<void, void, undefined> {
    const draw = worldDrawAt(columns, world);
    const tef = tefColumn[world];
    const magnitude = magnitudeColumn[world];
    for (const actor of actors) {
      refreshWorld(actor.world, draw);
      const baseline = evaluateBaseline(actor.world);
      const scale = tef * actor.input.share * magnitude;
      const baselineAle = scale * pricedFraction(baseline.outcomes);
      const impact = baseline.outcomes.impactDetected + baseline.outcomes.impactUndetected;
      actor.aleTotals[world] = baselineAle;
      actor.vulnerabilitySeries[world] = impact;
      vulnerabilitySeries[world] += actor.input.share * impact;
      aleSeries[world] += baselineAle;
      lefSeries[world] += tef * actor.input.share * (baseline.outcomes.impactDetected + baseline.outcomes.impactUndetected);
      addEventRates(eventRates, world, tef * actor.input.share, baseline.outcomes);
      actor.outcomeTotals.blocked += baseline.outcomes.blocked;
      actor.outcomeTotals.evicted += baseline.outcomes.evicted;
      actor.outcomeTotals.impactDetected += baseline.outcomes.impactDetected;
      actor.outcomeTotals.impactUndetected += baseline.outcomes.impactUndetected;
      actor.pathTotals.stoppedAtInitialAccess += baseline.paths.stoppedAtInitialAccess;
      actor.pathTotals.direct += baseline.paths.direct;
      actor.pathTotals.long += baseline.paths.long;
      actor.pathTotals.withoutInitialAccess += baseline.paths.withoutInitialAccess;
      refreshWorld(actor.memorylessWorld, draw);
      memorylessAleSeries[world] += scale * pricedFraction(evaluateAttackRun(actor.memorylessWorld).outcomes);
      yield;

      for (let technique = 0; evaluatesTechniques && technique < actor.law.techniqueCount; technique += 1) {
        if (!actor.law.playedTechniques[technique]) {
          continue;
        }
        /* No rebuild: an interdiction moves no control and an evaluation leaves the products at the
         * bits it found, so the world is still the baseline's, as a technique the path gives no step
         * needs to answer the baseline exactly. */
        const prevented = evaluateWhatIf(actor.world, { lever: 'prevent', technique });
        actor.techniquePreventAle[technique] += baselineAle - scale * pricedFraction(prevented.outcomes);
        const detected = evaluateWhatIf(actor.world, { lever: 'detect', technique });
        actor.techniqueDetectAle[technique] += baselineAle - scale * pricedFraction(detected.outcomes);
        yield;
      }

      for (let controlIndex = 0; evaluatesWhatIfs && controlIndex < inputs.controls.length; controlIndex += 1) {
        if (!leverPriced[controlIndex] || !actor.reaches[controlIndex]) {
          continue;
        }
        const columnsOf = columns.controls[controlIndex];
        /* Rebuilt with the control moved rather than moved in place: `setControlState` divides the
         * family products, and the saving is read against `baselineAle`, which the undivided ones gave. */
        const savingAt = (lever: ControlLever): number => {
          refreshWorld(actor.world, draw, { controlIndex, state: controlStateAt(columnsOf, lever) });
          return baselineAle - scale * pricedFraction(evaluateWhatIf(actor.world).outcomes);
        };
        for (const dimension of controlLevers[controlIndex]) {
          if (!atCeiling(columnsOf, dimension)) {
            leverSeries[controlIndex][dimension][world] += savingAt(LEVER_MOVE[dimension]);
          }
        }
        yield;
      }

      /*
       * The whole plan at once, and not the sum of its moves: two controls on one technique each
       * quieten what is left after the other, so a plan adding up its line items would overstate
       * what it buys, and overstate it most exactly when the plan is well built.
       */
      for (const [planIndex, passes] of (evaluatesWhatIfs ? planPasses : []).entries()) {
        /* Rebuilt rather than unwound: the lever loop leaves a control moved, and a plan that moves
         * nothing here has to answer the baseline exactly, or its saving reads as a rounding error of
         * either sign. */
        refreshWorld(actor.world, draw);
        let moved = false;
        for (const pass of passes) {
          if (!actor.reaches[pass.controlIndex]) {
            continue;
          }
          const target = targetStateAt(columns.controls[pass.controlIndex], pass.target);
          if (sameControlState(actor.world.controlStates[pass.controlIndex], target)) {
            continue;
          }
          setControlState(actor.world, pass.controlIndex, target);
          moved = true;
        }
        const outcomes = moved ? evaluateAttackRun(actor.world).outcomes : baseline.outcomes;
        planSeries[planIndex][world] += moved ? scale * pricedFraction(outcomes) : baselineAle;
        const rates = sampledRates.get(planIndex);
        if (rates !== undefined) {
          addEventRates(rates, world, tef * actor.input.share, outcomes);
        }
        yield;
      }

      for (let cve = 0; evaluatesCves && cve < whatIfCves.length; cve += 1) {
        const series = cveSeries[cve];
        if (series === null) {
          continue;
        }
        const own = actor.cveWorlds[cve];
        if (own !== null) {
          if (baselineAle > 0) {
            refreshWorld(own, draw);
            const dropped = evaluateAttackRun(own, undefined, undefined, cve < doorCveCount ? cve : -1);
            const saving = baselineAle - scale * pricedFraction(dropped.outcomes);
            // Within the band the difference is the rounding of another group order, so it adds nothing.
            if (Math.abs(saving) > CVE_WHAT_IF_EXACT_BAND * baselineAle) {
              series[world] += saving;
            }
          }
          yield;
          continue;
        }
        /* A floor-only CVE has no exploit at the door: with no law of its own it forgoes nothing. */
        if (cve >= doorCveCount || !actor.doorCveOpensPlayed[cve] || !(draw.cveUniform[cve] < inputs.door.cves[cve].threat)) {
          continue;
        }
        /* The baseline wrote the door memo on this draw: a forgone exploit that leaves every pass of
         * the memo unchanged leaves the whole evaluation unchanged, and its saving is exactly 0. The
         * check is a door pass, so it yields too. */
        if (!forgoneExploitLeavesDoor(actor.world, cve)) {
          /* Rebuilt from the draw: a lever or a plan before leaves a control moved, and a flaw that
           * moves nothing has to answer exactly zero. */
          refreshWorld(actor.world, draw);
          const forgone = evaluateAttackRun(actor.world, undefined, undefined, cve);
          series[world] += baselineAle - scale * pricedFraction(forgone.outcomes);
        }
        yield;
      }
    }
  };

  const step = (): void => {
    pending ??= evaluateWorld(next);
    if (pending.next().done === true) {
      pending = null;
      next += 1;
    }
  };

  const zeroReasonOf = (controlIndex: number, lever: AttackRunLeverDimension): ZeroLeverReason | null => {
    const columnsOf = columns.controls[controlIndex];
    if (actors.every((actor) => actor.law.controls[controlIndex].familyIndexes.length === 0)) {
      return 'estate-families';
    }
    if (actors.every((actor) => !actor.reaches[controlIndex])) {
      return 'actor-repertoire';
    }
    return atCeiling(columnsOf, lever) ? 'already-maximal' : null;
  };

  const planSavingsOf = (planIndex: number): Float64Array => {
    const savings = new Float64Array(worldCount);
    for (let world = 0; world < worldCount; world += 1) {
      savings[world] = aleSeries[world] - planSeries[planIndex][world];
    }
    return savings;
  };

  const basketSeriesOf = (basketId: string | null): Float64Array =>
    (basketId === null ? aleSeries : planSeries[postureIndexOf(basketId)]);

  const basketDifferenceOf = (difference: EngineRunBasketDifference): Float64Array => {
    const minuend = basketSeriesOf(difference.minuendBasketId);
    const subtrahend = basketSeriesOf(difference.subtrahendBasketId);
    const values = new Float64Array(worldCount);
    for (let world = 0; world < worldCount; world += 1) {
      values[world] = minuend[world] - subtrahend[world];
    }
    return values;
  };

  const leversOf = (controlIndex: number): Array<AttackRunControlLever> => {
    const control = inputs.controls[controlIndex];
    return controlLevers[controlIndex].map((dimension) => ({
      dimension,
      upgradedStrengthRung: LEVER_MOVE[dimension].strength === 'upgraded' ? nextStrengthRung(control.strengthRung) : control.strengthRung,
      upgradedCoverageBucket: LEVER_MOVE[dimension].coverage === 'upgraded' ? nextCoverageBucket(control.coverageBucket) : control.coverageBucket,
      aleReduction: spreadOf(leverSeries[controlIndex][dimension]),
      zeroReason: zeroReasonOf(controlIndex, dimension),
    }));
  };

  const annualLossOfRates = (rates: EventRates): AnnualLossDistribution => sampleAnnualLosses({
    streams: [
      { rates: rates.impactUndetected, pricedFraction: pricedFraction({ ...NO_OUTCOME, impactUndetected: 1 }), lossEvent: true },
      { rates: rates.impactDetected, pricedFraction: pricedFraction({ ...NO_OUTCOME, impactDetected: 1 }), lossEvent: true },
      { rates: rates.evicted, pricedFraction: pricedFraction({ ...NO_OUTCOME, evicted: 1 }), lossEvent: false },
    ],
    magnitudes: magnitudeColumn,
    yearsPerWorld: ANNUAL_LOSS_YEARS_PER_WORLD,
    seed: inputs.seed,
  });
  let annualLoss: AnnualLossDistribution | null = null;
  const annualLossOf = (): AnnualLossDistribution => {
    annualLoss ??= annualLossOfRates(eventRates);
    return annualLoss;
  };

  return {
    worlds: worldCount,
    advance: (count: number): void => {
      const until = Math.min(worldCount, next + count);
      while (next < until) {
        step();
      }
    },
    advanceUntil: (shouldPause: () => boolean): void => {
      while (next < worldCount) {
        step();
        if (shouldPause()) {
          return;
        }
      }
    },
    done: (): boolean => next >= worldCount,
    result: (): EngineRunResult => ({
      worlds: worldCount,
      calibrationVintage: ATTACK_RUN_CALIBRATION_VINTAGE,
      calibration: {
        vintage: ATTACK_RUN_CALIBRATION_VINTAGE,
        memorylessAle: meanOf(memorylessAleSeries),
        cornerConstants: ATTACK_RUN_CORNER_CONSTANTS,
      },
      outcomes: mixtureOutcomes(actors, worldCount),
      paths: mixturePaths(actors, worldCount),
      vulnerability: spreadOf(vulnerabilitySeries),
      lef: spreadOf(lefSeries),
      ale: spreadOf(aleSeries),
      magnitude: spreadOf(magnitudeColumn),
      annualLoss: annualLossOf(),
      actors: actors.map((actor) => ({
        key: actor.input.key,
        name: actor.input.name,
        actorClass: actor.input.actorClass,
        share: actor.input.share,
        outcomes: {
          blocked: actor.outcomeTotals.blocked / worldCount,
          evicted: actor.outcomeTotals.evicted / worldCount,
          impactDetected: actor.outcomeTotals.impactDetected / worldCount,
          impactUndetected: actor.outcomeTotals.impactUndetected / worldCount,
        },
        paths: {
          stoppedAtInitialAccess: actor.pathTotals.stoppedAtInitialAccess / worldCount,
          direct: actor.pathTotals.direct / worldCount,
          long: actor.pathTotals.long / worldCount,
          withoutInitialAccess: actor.pathTotals.withoutInitialAccess / worldCount,
        },
        aleMean: meanOf(actor.aleTotals),
        vulnerability: spreadOf(actor.vulnerabilitySeries),
        unplayableObstacleKeys: actor.law.unplayableObstacleKeys,
        playedTechniqueExternalIds: actor.input.repertoire
          .filter((_, index) => actor.law.playedTechniques[index])
          .map((technique) => technique.externalId),
        attackRunDays: actor.law.inputs.actorClass.attackRunDays,
        reactionTimeExceededShare: (actor.law.chains.withoutInitialAccess?.share ?? 0) >= 1
          ? null
          : 1 - inTimeOf(actor.world, actor.world.longChain.length)[1],
      })),
      controlValues: inputs.controls.flatMap((control, controlIndex) => (leverPriced[controlIndex]
        ? [{
          controlId: control.controlId,
          capabilityExternalId: control.capabilityExternalId,
          declaredStrengthRung: control.strengthRung,
          declaredCoverageBucket: control.coverageBucket,
          levers: leversOf(controlIndex),
        }]
        : [])),
      planValues: plans.map((plan, planIndex) => ({
        planId: plan.planId,
        aleReduction: spreadOf(planSavingsOf(planIndex)),
      })),
      basketDifferenceValues: (inputs.basketDifferences ?? []).map((difference) => ({
        key: difference.key,
        value: spreadOf(basketDifferenceOf(difference)),
      })),
      basketAnnualLosses: annualLossBaskets.map((basketId) => ({
        basketId,
        annualLoss: annualLossOfRates(sampledRates.get(postureIndexOf(basketId))!),
      })),
      cveValues: whatIfCves.flatMap((cve, index) => {
        const series = cveSeries[index];
        if (series === null) {
          return [];
        }
        const spread = spreadOf(series);
        return [{ cveId: cve.cveId, aleReductionMean: spread.mean, aleReductionP10: spread.p10, aleReductionP90: spread.p90 }];
      }),
      techniqueValues: whatIfs.techniques
        ? actors.flatMap((actor) => actor.input.repertoire.flatMap((technique, index) => (!actor.law.playedTechniques[index]
          ? []
          : [{
            actorKey: actor.input.key,
            techniqueExternalId: technique.externalId,
            preventValue: actor.techniquePreventAle[index] / worldCount,
            detectValue: actor.techniqueDetectAle[index] / worldCount,
          }])))
        : [],
    }),
  };
};

const mixtureOutcomes = (actors: ReadonlyArray<ActorState>, worldCount: number): AttackRunOutcomes => {
  const totals = { blocked: 0, evicted: 0, impactDetected: 0, impactUndetected: 0 };
  for (const actor of actors) {
    const share = actor.input.share / worldCount;
    totals.blocked += share * actor.outcomeTotals.blocked;
    totals.evicted += share * actor.outcomeTotals.evicted;
    totals.impactDetected += share * actor.outcomeTotals.impactDetected;
    totals.impactUndetected += share * actor.outcomeTotals.impactUndetected;
  }
  return totals;
};

const mixturePaths = (actors: ReadonlyArray<ActorState>, worldCount: number): AttackPathShares => {
  const totals = { stoppedAtInitialAccess: 0, direct: 0, long: 0, withoutInitialAccess: 0 };
  for (const actor of actors) {
    const share = actor.input.share / worldCount;
    totals.stoppedAtInitialAccess += share * actor.pathTotals.stoppedAtInitialAccess;
    totals.direct += share * actor.pathTotals.direct;
    totals.long += share * actor.pathTotals.long;
    totals.withoutInitialAccess += share * actor.pathTotals.withoutInitialAccess;
  }
  return totals;
};
