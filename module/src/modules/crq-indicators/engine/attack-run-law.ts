import { newError } from '@app/utils';
import type { UnknownExposureCountsAs } from '../../attack-surfaces/entry-applicability';
import type { ActorClass } from '../../threat-analyses/actor-classes';
import type { AssetCategory, AssetCriticality, DeclaredCriticality } from '../../supporting-assets/constants';
import type { AttackRunObstacle } from './attack-run-obstacles';
import type { DoorEstate } from './attack-run-door';
import type { SupportingAssetExposure } from '../../supporting-assets/schema';
import type { PhishingStageName } from './attack-run-constants';
import type { CapabilityFunction } from '../../controls/capability/constants';
import type { TestedResult } from '../../controls/capability/tested-efficacy';
import { CONTROL_FAMILY_PROTECTION } from '../../controls/capability/data/control-family-protection';
import { countedExposure, isEffectivelyExposed, isPlayedAtInitialAccess, needsExposureOutsidePerimeter } from '../../attack-surfaces/entry-applicability';
import { countedCriticality } from '../../supporting-assets/constants';
import { lowestTestedEfficacy } from '../../controls/capability/tested-efficacy';
import { resourceStepWeight, stepWeight } from './asset-scalars';
import { noiseForAction } from './attack-noise';
import { PHISHING_CONSTANTS, PHISHING_STAGE_TECHNIQUES, PHISHING_TRAINING_CAPABILITIES, phishingCampaignSize } from './attack-run-constants';
import { phishingSusceptibility } from './attack-run-phishing';
import { buildObstacles } from './attack-run-obstacles';
import { capabilitiesTakenDownBy } from './impairment-relation';
import { isActionPlayable } from './walk-resolver';

/**
 * The attack run law of the engine specification, sections 5 to 9, in closed form.
 *
 * Synchronous, allocation-light, and free of database, clock and randomness: one world is a set of
 * numbers handed in, and the same call answers the same thing forever. That is what lets the
 * property tests and the production job run the identical code.
 *
 * Three orderings inside are load-bearing and none of them is visible in the algebra: the sabotage
 * establishments read the intact posture and are computed before any knockout applies, or the law
 * becomes a fixed point rather than a closed form; the accumulator is read before an obstacle emits
 * its own noise, so the door is never amplified; and the deployment products are cached per world
 * and degraded by dividing the knocked capabilities back out, never rebuilt per technique.
 */

export interface AttackRunTechnique {
  readonly externalId: string,
  readonly tacticExternalIds: ReadonlyArray<string>,
  readonly families: ReadonlyArray<AssetCategory>,
  /** Reaches its whole group in one move rather than one asset. Section 6.2. */
  readonly populationScoped?: boolean,
  /**
   * The share of the attacker population that holds the technique. One when absent. A technique at
   * zero is held by nobody: only the path around the door plays it.
   */
  readonly prevalence?: number,
  /**
   * The families the path around the door plays this technique on, which the catalogue's reach does
   * not narrow. {@link AttackRunTechnique.families} when absent.
   */
  readonly pathFamilies?: ReadonlyArray<AssetCategory>,
}

/** The attack path that bypasses initial access, as the scenario's outcome declares it. */
export interface AttackRunWithoutInitialAccess {
  /** Names the path among the unplayable obstacles. */
  readonly key: string,
  /** The share of the attacks that take it, in [0, 1]. */
  readonly share: number,
  /** The terminal tactic's techniques it plays. */
  readonly techniqueExternalIds: ReadonlyArray<string>,
}

/** A technique this group carries a floored route for, and the share of its holders that exploit one. */
export interface AttackRunCveFloor {
  readonly techniqueExternalId: string,
  /** In [0, 1], conditioned on holding the technique: one for a single actor citing the CVE. */
  readonly share: number,
}

export interface AttackRunGroup {
  readonly id: string,
  readonly family: AssetCategory,
  readonly assets: number,
  readonly exposure: SupportingAssetExposure,
  readonly criticality: AssetCriticality,
  readonly matchedByScenarioGroup: boolean,
  /** The floored-route mask: the techniques this group carries an actor-exploited CVE for. */
  readonly cveFloors?: ReadonlyArray<AttackRunCveFloor>,
  /**
   * The drawn kinds ({@link AttackRunDeclaredKind.kind}) whose internal virtual assets `assets`
   * holds at their low bound, which each world moves by its own draw.
   */
  readonly declaredKinds?: ReadonlyArray<string>,
}

/**
 * A declared kind whose count each world draws between its bounds, keeping the larger of the draw
 * and what the kind already holds. Its internal virtual assets are the difference.
 */
export interface AttackRunDeclaredKind {
  readonly kind: string,
  readonly low: number,
  readonly high: number,
  /** The measured assets of the kind, and the exposed virtual one a "yes" adds. */
  readonly held: number,
}

/** What OpenAEV observed of a control on one parent technique and function, on the scope's hosts. */
export interface AttackRunTestedCell extends TestedResult {
  readonly function: CapabilityFunction,
  readonly techniqueExternalId: string,
}

export interface AttackRunControl {
  /** Stable identity: every draw of every world is keyed by it, never by position. */
  readonly capabilityExternalId: string,
  readonly preventTechniqueExternalIds: ReadonlyArray<string>,
  readonly detectTechniqueExternalIds: ReadonlyArray<string>,
  /**
   * The techniques OpenAEV tested on the scope. Each one {@link testedCellReader} reads audits the
   * declaration on every family the control protects, and every other technique reads the
   * declaration alone.
   */
  readonly tested?: ReadonlyArray<AttackRunTestedCell>,
  /**
   * What the control prevents in every world at its declaration, `theta x c`. The law reads it
   * only to price the declared posture of the training at compile time, so a control without it
   * counts as undeclared there, which compiling refuses once a simulation rate is declared; the
   * worlds carry the efficacy every evaluation reads.
   */
  readonly declaredPreventEfficacy?: number,
}

export interface AttackRunActorClass {
  readonly capability: number,
  readonly stealth: number,
  readonly patience: number,
  readonly attackRunDays: number,
}

export interface AttackRunConstants {
  /** The visits of every obstacle after the door, which reads the whole estate instead. */
  readonly visitQuota: number,
  /** The most detection opportunities one population-scoped technique gets, at any obstacle. */
  readonly populationDetectionCap: number,
  /** The share of the class capability that the unknown flaw floor of a family is drawn at. */
  readonly unknownFlawFloorScale: number,
  readonly detectionScale: number,
  readonly signalGain: number,
  readonly execFloor: number,
  readonly postDetectionRate: number,
  readonly coupleSuccessCap: number,
  readonly actorExploitedCveFloor: number,
}

export interface AttackRunLawInputs {
  readonly terminalTacticExternalId: string,
  readonly actorClass: AttackRunActorClass,
  readonly repertoire: ReadonlyArray<AttackRunTechnique>,
  readonly groups: ReadonlyArray<AttackRunGroup>,
  readonly controls: ReadonlyArray<AttackRunControl>,
  readonly constants: AttackRunConstants,
  /**
   * The estate the door is played on, shared by every actor of a run. Its families are indexed by
   * their own order, which is the order of the run's `familyUniform` columns; the law reads them
   * through `families` and never through its own family index, which follows the groups.
   */
  readonly door: DoorEstate,
  /** Absent means no attack goes around the door. */
  readonly withoutInitialAccess?: AttackRunWithoutInitialAccess,
  /** What an unknown exposure counts as wherever the law reads an exposure: the step weights and the path around the door. */
  readonly unknownExposureCountsAs: UnknownExposureCountsAs,
  /** What an unknown criticality counts as in the step weights. */
  readonly unknownCriticalityCountsAs: DeclaredCriticality,
  /** The kinds the groups and the door name, in the order of the world's `declaredCount`. */
  readonly declaredKinds?: ReadonlyArray<AttackRunDeclaredKind>,
  /**
   * What sizes a phishing campaign and how susceptible its recipients are. The class names the
   * campaign, which the knobs above do not carry; the default class and no declared rate when absent.
   */
  readonly phishing?: {
    readonly actorClass: ActorClass,
    readonly declaredSusceptibility: number | null,
  },
}

/** The five functions of section 7, each the repertoire's techniques of one tactic. */
export const ATTACK_RUN_FUNCTION_TACTICS = {
  tooling: 'TA0002',
  discretion: 'TA0005',
  sabotage: 'TA0112',
  persistence: 'TA0003',
  channel: 'TA0011',
} as const;

export type AttackRunFunctionName = keyof typeof ATTACK_RUN_FUNCTION_TACTICS;

/** Builds one value per function, typed, so no index signature has to be cast back into shape. */
const byFunction = <T>(build: (name: AttackRunFunctionName) => T): Readonly<Record<AttackRunFunctionName, T>> => ({
  tooling: build('tooling'),
  discretion: build('discretion'),
  sabotage: build('sabotage'),
  persistence: build('persistence'),
  channel: build('channel'),
});

interface CompiledFunction {
  /** Repertoire indexes, in repertoire order. */
  readonly techniques: ReadonlyArray<number>,
  readonly noise: ReadonlyArray<number>,
  /** Positions into {@link CompiledFunction.techniques} playable on each family index. */
  readonly byFamily: ReadonlyArray<ReadonlyArray<number>>,
  /** Aligned with {@link CompiledFunction.byFamily}: the {@link choiceOf} over each family's positions. */
  readonly choiceByFamily: ReadonlyArray<ReadonlyArray<number>>,
}

interface CompiledObstacleGroup {
  readonly groupIndex: number,
  readonly weightShare: number,
  /** The group's step weight per asset, from which a world whose counts move rebuilds the shares. */
  readonly unitWeight: number,
  /** Positions into {@link CompiledObstacle.techniques} playable on this group's family. */
  readonly playable: ReadonlyArray<number>,
  /** Aligned with {@link CompiledObstacleGroup.playable}: the {@link choiceOf} over them. */
  readonly choice: ReadonlyArray<number>,
}

export interface CompiledObstacle {
  readonly key: string,
  /** Repertoire indexes the walk admits here, the technique-level exceptions applied. */
  readonly techniques: ReadonlyArray<number>,
  readonly noise: ReadonlyArray<number>,
  readonly groups: ReadonlyArray<CompiledObstacleGroup>,
  /** No technique the walk admits here, or no group any of them applies to. Section 6, `A = 0`. */
  readonly unplayable: boolean,
  /** A group of the obstacle holds a drawn kind, so each world reads its own shares. */
  readonly varies: boolean,
}

/** One pass of the door's per-technique law, reading at most one repertoire technique per technique of the estate. */
interface CompiledDoorLayer {
  /** Per technique of the door estate, the repertoire index this layer plays there, -1 for none. */
  readonly repertoire: Int32Array,
  /** Per technique of the door estate, the share of the attempts this layer's technique takes. */
  readonly choice: Float64Array,
}

/**
 * The door's techniques as the estate sees them. A repertoire technique and its parent are the same
 * technique of the estate but not the same technique of the defence, so techniques sharing a parent
 * go to separate layers and each layer is one pass over the estate.
 */
interface CompiledDoor {
  readonly layers: ReadonlyArray<CompiledDoorLayer>,
  /** Per family of the door estate, the law's own family index, -1 where no group holds that family. */
  readonly familyIndexes: Int32Array,
}

interface CompiledGroup {
  readonly familyIndex: number,
  readonly assets: number,
  /** Indexes into the law's drawn kinds. */
  readonly declaredKinds: ReadonlyArray<number>,
  /** Per technique index, the floor share of {@link AttackRunCveFloor}, zero where none applies. */
  readonly cveFloorShare: Float64Array,
}

/** The stages of a phishing campaign a control can act at, which index the first dimension of the stage let-through. */
export const PHISHING_STAGE = { delivery: 0, credential: 1, payload: 2 } as const;
export const PHISHING_STAGE_NAMES = ['delivery', 'credential', 'payload'] as const satisfies ReadonlyArray<PhishingStageName>;
export const PHISHING_STAGE_COUNT = PHISHING_STAGE_NAMES.length;

/** What the door reads to play T1566 on the people of the estate, resolved once against the law's families. */
export interface CompiledPhishing {
  /** Index of T1566 among the door estate's techniques. */
  readonly technique: number,
  /** The law's index of the identity family, which people are counted in and whose controls the credential branch reads, -1 where no group holds it. */
  readonly personFamily: number,
  readonly susceptibility: number,
  readonly campaignSize: number,
}

interface CompiledControl {
  readonly capabilityExternalId: string,
  readonly familyIndexes: ReadonlyArray<number>,
  /** The same families as a bitmask, so "does this control reach any surviving family" is one AND. */
  readonly familyMask: number,
  readonly preventTechniques: ReadonlyArray<number>,
  readonly detectTechniques: ReadonlyArray<number>,
  /** Positions into the sabotage function's technique list that take this capability down. */
  readonly impairedBy: ReadonlyArray<number>,
  /** The one {@link PHISHING_STAGE} the control acts at, -1 for none. */
  readonly phishingStage: number,
  /** Per repertoire technique the control covers, what OpenAEV observed there. */
  readonly testedPrevent: ReadonlyMap<number, TestedResult>,
  readonly testedDetect: ReadonlyMap<number, TestedResult>,
  /** What OpenAEV observed on each technique the control's phishing stage models, the weakest of which the stage reads. */
  readonly testedStage: ReadonlyArray<TestedResult>,
}

export interface CompiledAttackRunLaw {
  readonly inputs: AttackRunLawInputs,
  readonly obstacles: ReadonlyArray<CompiledObstacle>,
  readonly walk: ReadonlyArray<AttackRunObstacle>,
  readonly groups: ReadonlyArray<CompiledGroup>,
  readonly door: CompiledDoor,
  readonly controls: ReadonlyArray<CompiledControl>,
  readonly functions: Readonly<Record<AttackRunFunctionName, CompiledFunction>>,
  readonly populationScoped: ReadonlyArray<boolean>,
  readonly prevalence: Float64Array,
  /** Per technique, the families it is playable on, as a bitmask over the estate's family index. */
  readonly techniqueFamilyMask: ReadonlyArray<number>,
  /** Per technique, the controls covering it, which is what an estate-grain product multiplies. */
  readonly preventControlsByTechnique: ReadonlyArray<ReadonlyArray<number>>,
  readonly detectControlsByTechnique: ReadonlyArray<ReadonlyArray<number>>,
  readonly techniqueCount: number,
  /**
   * Per technique, whether some chain plays it: held by the class, or played by the path around the
   * door although nobody holds it. A technique no chain plays has no what-if to price.
   */
  readonly playedTechniques: ReadonlyArray<boolean>,
  readonly familyCount: number,
  /**
   * Per repertoire technique, the {@link PHISHING_STAGE} its parent names, -1 for none: interdicting
   * it closes that stage, which no cell of the per-technique products holds.
   */
  readonly phishingStageOfTechnique: ReadonlyArray<number>,
  /**
   * Per family of the law, what the training controls let through at delivery at their declared
   * posture: no knockout, no what-if, fixed for the run. One where no training control acts.
   */
  readonly phishingTrainingLetThrough: Float64Array,
  /** Null when the door estate holds no person: T1566 then clears nothing at the door and sends no email to detect. */
  readonly phishing: CompiledPhishing | null,
  /**
   * Per drawn kind, the internal virtual assets the groups and the door hold at the low bound, and
   * the door's places for them by kind index. Null when no kind is drawn.
   */
  readonly declared: {
    readonly lowCounts: Float64Array,
    readonly door: ReadonlyArray<{ readonly kind: number, readonly family: number, readonly techniques: ReadonlyArray<number>, readonly people: boolean }>,
  } | null,
  /**
   * Obstacles the actor's repertoire cannot play at all, named rather than left a silent zero: the
   * walk's by their key, and the path around the door, when it is taken, by its path key.
   */
  readonly unplayableObstacleKeys: ReadonlyArray<string>,
  readonly chains: {
    /** Indexes into `obstacles`: the door, then the resource-touching ones. Null when it is the long chain. */
    readonly direct: ReadonlyArray<number> | null,
    /** The terminal obstacle restricted to the path's techniques, with no door before it. Null without a share. */
    readonly withoutInitialAccess: { readonly obstacle: CompiledObstacle, readonly share: number, readonly key: string } | null,
  },
}

const DOOR_TACTIC_EXTERNAL_ID = 'TA0001';

const parentOf = (techniqueExternalId: string): string => techniqueExternalId.split('.')[0];

/**
 * The techniques the door plays: those of the Initial Access tactic that a campaign can land on an
 * asset. Valid accounts is among them although the walk asks for credentials before it elsewhere:
 * at the door it is one more way in, and only the other obstacles keep that prerequisite.
 */
export const isDoorTechnique = (technique: AttackRunTechnique): boolean =>
  technique.tacticExternalIds.includes(DOOR_TACTIC_EXTERNAL_ID) && isPlayedAtInitialAccess(technique.externalId);

const protectedFamilies = (capabilityExternalId: string): ReadonlyArray<AssetCategory> =>
  (CONTROL_FAMILY_PROTECTION as Readonly<Record<string, ReadonlyArray<AssetCategory>>>)[capabilityExternalId] ?? [];

/**
 * The probability that one attempt plays each of the given techniques: their prevalence normalised
 * over them, so an attempt always plays something. An actor the CTI documents for nothing on a
 * tactic still attacks there, the way the documented ones do. Uniform when none carries prevalence.
 */
const choiceOf = (repertoire: ReadonlyArray<AttackRunTechnique>, indexes: ReadonlyArray<number>): Array<number> => {
  const total = indexes.reduce((sum, index) => sum + (repertoire[index].prevalence ?? 1), 0);
  return indexes.map((index) => (total > 0 ? (repertoire[index].prevalence ?? 1) / total : 1 / indexes.length));
};

/**
 * Whether the long chain plays the technique. A technique nobody holds, or that no family of the
 * run's catalogue reach admits, is played only by the path around the door.
 */
const isPlayedInChain = (technique: AttackRunTechnique): boolean =>
  (technique.prevalence ?? 1) > 0 && technique.families.length > 0;

/** The door is the first obstacle of every walk: the one nothing is required for. */
export const DOOR_OBSTACLE = 0;

const positionsOf = <T>(items: ReadonlyArray<T>, keep: (item: T, position: number) => boolean): Array<number> =>
  items.flatMap((item, position) => (keep(item, position) ? [position] : []));

const phishingStageOf = (preventTechniqueExternalIds: ReadonlyArray<string>): number => {
  const parents = new Set(preventTechniqueExternalIds.map(parentOf));
  return PHISHING_STAGE_NAMES.findIndex((name) => PHISHING_STAGE_TECHNIQUES[name].some((externalId) => parents.has(externalId)));
};

/** The stage a control with these prevent edges acts at, null for none. */
export const phishingStageNameOf = (preventTechniqueExternalIds: ReadonlyArray<string>): PhishingStageName | null =>
  PHISHING_STAGE_NAMES[phishingStageOf(preventTechniqueExternalIds)] ?? null;

/** The techniques of the control's phishing stage it has a prevent edge under, in the stage's order. */
export const phishingStageTechniquesOf = (preventTechniqueExternalIds: ReadonlyArray<string>): Array<string> => {
  const stage = phishingStageNameOf(preventTechniqueExternalIds);
  const parents = new Set(preventTechniqueExternalIds.map(parentOf));
  return stage === null ? [] : PHISHING_STAGE_TECHNIQUES[stage].filter((externalId) => parents.has(externalId));
};

/**
 * Which of a control's tested results the law reads: one on a technique the control has an edge on
 * for that function, and on prevent one on a technique of its phishing stage it has an edge under.
 * Elsewhere the control declares nothing, so a result there has no declaration to audit. The
 * per-technique products then read only the run's repertoire among them.
 */
export const testedCellReader = (
  control: Pick<AttackRunControl, 'preventTechniqueExternalIds' | 'detectTechniqueExternalIds'>,
): (cell: Pick<AttackRunTestedCell, 'function' | 'techniqueExternalId'>) => boolean => {
  const read: Readonly<Record<CapabilityFunction, ReadonlySet<string>>> = {
    prevent: new Set([...control.preventTechniqueExternalIds, ...phishingStageTechniquesOf(control.preventTechniqueExternalIds)]),
    detect: new Set(control.detectTechniqueExternalIds),
  };
  return (cell) => read[cell.function].has(cell.techniqueExternalId);
};

const definedIndexes = (externalIds: ReadonlyArray<string>, indexOf: ReadonlyMap<string, number>): Array<number> =>
  [...new Set(externalIds.flatMap((externalId) => {
    const index = indexOf.get(externalId);
    return index === undefined ? [] : [index];
  }))];

/**
 * Everything a run can index once and read for every world: the obstacle chain, which technique is
 * playable where, the group weights, and which capability each impairment technique takes down.
 *
 * A per-technique interdiction does not recompile: it is an argument to {@link evaluateAttackRun},
 * which reads that technique's prevent or detect side as perfectly covered and changes nothing else.
 */
export const compileAttackRunLaw = (inputs: AttackRunLawInputs): CompiledAttackRunLaw => {
  const families = [...new Set(inputs.groups.map((group) => group.family))];
  const familyIndexOf = new Map(families.map((family, index) => [family, index]));
  const techniqueIndexOf = new Map(inputs.repertoire.map((technique, index) => [technique.externalId, index]));
  const playableOnFamily = (index: number, familyIndex: number): boolean =>
    inputs.repertoire[index].families.includes(families[familyIndex]);
  const playableOnPathGroup = (index: number, groupIndex: number): boolean => {
    const technique = inputs.repertoire[index];
    const declared = inputs.groups[groupIndex];
    return (technique.pathFamilies ?? technique.families).includes(declared.family)
      && (!needsExposureOutsidePerimeter(technique.externalId) || isEffectivelyExposed(declared.exposure, inputs.unknownExposureCountsAs));
  };

  const floorShareOf = (floors: ReadonlyArray<AttackRunCveFloor>): Float64Array => {
    const share = new Float64Array(inputs.repertoire.length);
    for (const floor of floors) {
      const index = techniqueIndexOf.get(floor.techniqueExternalId);
      if (index !== undefined) {
        share[index] = Math.max(share[index], floor.share);
      }
    }
    return share;
  };
  const declaredKinds = inputs.declaredKinds ?? [];
  const kindIndexOf = new Map(declaredKinds.map((declared, index) => [declared.kind, index]));
  const kindIndexesOf = (kinds: ReadonlyArray<string>): Array<number> => kinds.map((kind) => {
    const index = kindIndexOf.get(kind);
    if (index === undefined) {
      throw newError('A group or the door names a declared kind the law was not given', { kind });
    }
    return index;
  });
  const groups: Array<CompiledGroup> = inputs.groups.map((group) => ({
    familyIndex: familyIndexOf.get(group.family)!,
    assets: group.assets,
    declaredKinds: kindIndexesOf(group.declaredKinds ?? []),
    cveFloorShare: floorShareOf(group.cveFloors ?? []),
  }));

  const functions = byFunction<CompiledFunction>((name) => {
    const tacticExternalId = ATTACK_RUN_FUNCTION_TACTICS[name];
    const techniques = positionsOf(inputs.repertoire, (technique) => isPlayedInChain(technique) && technique.tacticExternalIds.includes(tacticExternalId));
    const byFamily = families.map((_, familyIndex) => positionsOf(techniques, (index) => playableOnFamily(index, familyIndex)));
    return {
      techniques,
      noise: techniques.map((index) => noiseForAction(tacticExternalId, inputs.repertoire[index].externalId) ?? 0),
      byFamily,
      choiceByFamily: byFamily.map((positions) => choiceOf(inputs.repertoire, positions.map((position) => techniques[position]))),
    };
  });

  const walk = buildObstacles(inputs.terminalTacticExternalId);
  const compileObstacle = (
    obstacle: AttackRunObstacle,
    techniques: ReadonlyArray<number>,
    playableOn: (index: number, groupIndex: number) => boolean,
  ): CompiledObstacle => {
    const eligible = groups.flatMap((_, groupIndex) => {
      const playable = positionsOf(techniques, (index) => playableOn(index, groupIndex));
      return playable.length === 0 ? [] : [{ groupIndex, playable }];
    });
    const weightOf = (groupIndex: number): number => {
      const declared = inputs.groups[groupIndex];
      return declared.assets
        * stepWeight(
          countedExposure(declared.exposure, inputs.unknownExposureCountsAs),
          countedCriticality(declared.criticality, inputs.unknownCriticalityCountsAs),
          obstacle.depth,
        )
        * (obstacle.resourceTouching ? resourceStepWeight(declared.matchedByScenarioGroup) : 1);
    };
    const unitWeightOf = (groupIndex: number): number => {
      const declared = inputs.groups[groupIndex];
      return stepWeight(
        countedExposure(declared.exposure, inputs.unknownExposureCountsAs),
        countedCriticality(declared.criticality, inputs.unknownCriticalityCountsAs),
        obstacle.depth,
      ) * (obstacle.resourceTouching ? resourceStepWeight(declared.matchedByScenarioGroup) : 1);
    };
    const totalWeight = eligible.reduce((sum, entry) => sum + weightOf(entry.groupIndex), 0);
    return {
      key: obstacle.key,
      techniques,
      // A node pooling several tactics reads the loudest noise among the tactics the technique
      // serves there, so a walk-table edit that pools one more tactic cannot quieten a technique.
      noise: techniques.map((index) => Math.max(...inputs.repertoire[index].tacticExternalIds
        .filter((tacticExternalId) => obstacle.tacticExternalIds.includes(tacticExternalId))
        .map((tacticExternalId) => noiseForAction(tacticExternalId, inputs.repertoire[index].externalId) ?? 0))),
      groups: eligible.map((entry) => ({
        ...entry,
        choice: choiceOf(inputs.repertoire, entry.playable.map((position) => techniques[position])),
        weightShare: totalWeight === 0 ? 0 : weightOf(entry.groupIndex) / totalWeight,
        unitWeight: unitWeightOf(entry.groupIndex),
      })),
      unplayable: techniques.length === 0 || eligible.length === 0,
      varies: eligible.some((entry) => groups[entry.groupIndex].declaredKinds.length > 0),
    };
  };
  const obstacles: Array<CompiledObstacle> = walk.map((obstacle, obstacleIndex) => compileObstacle(
    obstacle,
    obstacleIndex === DOOR_OBSTACLE
      ? positionsOf(inputs.repertoire, (technique) => isPlayedInChain(technique) && isDoorTechnique(technique))
      : positionsOf(inputs.repertoire, (technique) => isPlayedInChain(technique) && technique.tacticExternalIds.some((tacticExternalId) => (
        obstacle.tacticExternalIds.includes(tacticExternalId)
        && isActionPlayable(obstacle.stateBefore, tacticExternalId, technique.externalId)
      ))),
    (index, groupIndex) => playableOnFamily(index, groups[groupIndex].familyIndex),
  ));

  const withoutInitialAccess = ((): CompiledAttackRunLaw['chains']['withoutInitialAccess'] => {
    const declared = inputs.withoutInitialAccess;
    if (declared === undefined || !(declared.share > 0)) {
      return null;
    }
    const terminal = walk[walk.length - 1];
    const onPath = new Set(declared.techniqueExternalIds);
    const admitted = positionsOf(inputs.repertoire, (technique) => onPath.has(technique.externalId)
      && technique.tacticExternalIds.some((tacticExternalId) => (
        terminal.tacticExternalIds.includes(tacticExternalId)
        && isActionPlayable(terminal.stateBefore, tacticExternalId, technique.externalId)
      )));
    const onEstate = admitted.filter((index) => groups.some((_, groupIndex) => playableOnPathGroup(index, groupIndex)));
    const held = onEstate.filter((index) => (inputs.repertoire[index].prevalence ?? 1) > 0);
    return {
      obstacle: compileObstacle(terminal, held.length > 0 ? held : onEstate, playableOnPathGroup),
      share: declared.share,
      key: declared.key,
    };
  })();

  const resourceTouching = positionsOf(walk, (obstacle, index) => index !== DOOR_OBSTACLE && obstacle.resourceTouching);
  const direct = resourceTouching.length + 1 === obstacles.length ? null : [DOOR_OBSTACLE, ...resourceTouching];

  const doorIndexOfTechnique = new Map(inputs.door.techniques.map((externalId, index) => [externalId, index]));
  const doorRepertoire = obstacles[DOOR_OBSTACLE].techniques;
  const doorChoice = choiceOf(inputs.repertoire, doorRepertoire);
  const layers: Array<{ repertoire: Int32Array, choice: Float64Array }> = [];
  doorRepertoire.forEach((repertoireIndex, position) => {
    const estateIndex = doorIndexOfTechnique.get(parentOf(inputs.repertoire[repertoireIndex].externalId));
    if (estateIndex === undefined) {
      return;
    }
    let layer = layers.find((candidate) => candidate.repertoire[estateIndex] < 0);
    if (layer === undefined) {
      layer = { repertoire: new Int32Array(inputs.door.techniques.length).fill(-1), choice: new Float64Array(inputs.door.techniques.length) };
      layers.push(layer);
    }
    layer.repertoire[estateIndex] = repertoireIndex;
    layer.choice[estateIndex] = doorChoice[position];
  });
  const door: CompiledDoor = {
    layers,
    familyIndexes: Int32Array.from(inputs.door.families, (family) => familyIndexOf.get(family) ?? -1),
  };

  const testedTechniques = (cells: ReadonlyArray<AttackRunTestedCell>, fn: CapabilityFunction, techniques: ReadonlyArray<number>): Map<number, TestedResult> => {
    const tested = new Map<number, TestedResult>();
    for (const cell of cells) {
      const technique = techniqueIndexOf.get(cell.techniqueExternalId);
      if (cell.function === fn && technique !== undefined && techniques.includes(technique)) {
        tested.set(technique, cell);
      }
    }
    return tested;
  };
  /** Every technique of the stage the control was tested on: a failure on any of them is one the stage lets through. */
  const testedStageOf = (cells: ReadonlyArray<AttackRunTestedCell>, stage: number): Array<TestedResult> => {
    if (stage < 0) {
      return [];
    }
    const prevented = new Map(cells
      .filter((cell) => cell.function === 'prevent')
      .map((cell) => [cell.techniqueExternalId, cell]));
    return PHISHING_STAGE_TECHNIQUES[PHISHING_STAGE_NAMES[stage]]
      .flatMap((externalId) => prevented.get(externalId) ?? []);
  };

  const controls: Array<CompiledControl> = inputs.controls.map((control) => {
    const familyIndexes = definedIndexes(protectedFamilies(control.capabilityExternalId), familyIndexOf);
    const preventTechniques = definedIndexes(control.preventTechniqueExternalIds, techniqueIndexOf);
    const detectTechniques = definedIndexes(control.detectTechniqueExternalIds, techniqueIndexOf);
    const phishingStage = phishingStageOf(control.preventTechniqueExternalIds);
    const tested = (control.tested ?? []).filter(testedCellReader(control));
    return {
      capabilityExternalId: control.capabilityExternalId,
      familyIndexes,
      familyMask: familyIndexes.reduce((mask, familyIndex) => mask | (1 << familyIndex), 0),
      preventTechniques,
      detectTechniques,
      impairedBy: positionsOf(functions.sabotage.techniques, (index) =>
        capabilitiesTakenDownBy(inputs.repertoire[index].externalId).includes(control.capabilityExternalId)),
      phishingStage,
      testedPrevent: testedTechniques(tested, 'prevent', preventTechniques),
      testedDetect: testedTechniques(tested, 'detect', detectTechniques),
      testedStage: testedStageOf(tested, phishingStage),
    };
  });

  const phishingTrainingLetThrough = new Float64Array(families.length).fill(1);
  controls.forEach((control, controlIndex) => {
    if (control.phishingStage === PHISHING_STAGE.delivery && PHISHING_TRAINING_CAPABILITIES.includes(control.capabilityExternalId)) {
      const { declaredPreventEfficacy } = inputs.controls[controlIndex];
      if (declaredPreventEfficacy === undefined && inputs.phishing?.declaredSusceptibility != null) {
        throw newError('A declared phishing simulation rate cannot be backed out of a training control with no declared prevent efficacy', {
          capabilityExternalId: control.capabilityExternalId,
        });
      }
      const silence = 1 - lowestTestedEfficacy(declaredPreventEfficacy ?? 0, control.testedStage);
      for (const familyIndex of control.familyIndexes) {
        phishingTrainingLetThrough[familyIndex] *= silence;
      }
    }
  });

  const phishingOf = (): CompiledPhishing | null => {
    const doorPhishing = inputs.door.phishing;
    const technique = inputs.door.techniques.findIndex((externalId) => PHISHING_STAGE_TECHNIQUES.delivery.includes(externalId));
    if (doorPhishing === null || technique < 0) {
      return null;
    }
    const familyOf = (doorFamily: number): number => (doorFamily < 0 ? -1 : door.familyIndexes[doorFamily]);
    const personFamily = familyOf(doorPhishing.personFamily);
    const declared = inputs.phishing ?? { actorClass: 'default' as const, declaredSusceptibility: null };
    return {
      technique,
      personFamily,
      susceptibility: phishingSusceptibility(
        declared.declaredSusceptibility,
        personFamily < 0 ? 1 : phishingTrainingLetThrough[personFamily],
        PHISHING_CONSTANTS.defaultSusceptibility,
      ),
      campaignSize: phishingCampaignSize(declared.actorClass, doorPhishing.people),
    };
  };

  const coveringControls = (pick: (control: CompiledControl) => ReadonlyArray<number>): Array<Array<number>> => {
    const byTechnique = inputs.repertoire.map((): Array<number> => []);
    controls.forEach((control, controlIndex) => {
      for (const technique of pick(control)) {
        byTechnique[technique].push(controlIndex);
      }
    });
    return byTechnique;
  };

  return {
    inputs,
    obstacles,
    walk,
    groups,
    door,
    controls,
    functions,
    populationScoped: inputs.repertoire.map((technique) => technique.populationScoped === true),
    prevalence: Float64Array.from(inputs.repertoire, (technique) => technique.prevalence ?? 1),
    techniqueFamilyMask: inputs.repertoire.map((_, index) =>
      families.reduce((mask, __, familyIndex) => (playableOnFamily(index, familyIndex) ? mask | (1 << familyIndex) : mask), 0)),
    preventControlsByTechnique: coveringControls((control) => control.preventTechniques),
    detectControlsByTechnique: coveringControls((control) => control.detectTechniques),
    techniqueCount: inputs.repertoire.length,
    playedTechniques: inputs.repertoire.map((technique, index) =>
      (technique.prevalence ?? 1) > 0 || (withoutInitialAccess?.obstacle.techniques.includes(index) ?? false)),
    familyCount: families.length,
    phishingStageOfTechnique: inputs.repertoire.map((technique) => phishingStageOf([technique.externalId])),
    phishingTrainingLetThrough,
    phishing: phishingOf(),
    declared: declaredKinds.length === 0 ? null : {
      lowCounts: Float64Array.from(declaredKinds, (declared) => Math.max(0, declared.low - declared.held)),
      door: (inputs.door.declared ?? []).map((entry) => ({
        kind: kindIndexesOf([entry.kind])[0],
        family: entry.family,
        techniques: entry.techniques,
        people: entry.people,
      })),
    },
    unplayableObstacleKeys: [
      ...(withoutInitialAccess !== null && withoutInitialAccess.share >= 1
        ? []
        : obstacles.filter((obstacle) => obstacle.unplayable).map((obstacle) => obstacle.key)),
      ...(withoutInitialAccess?.obstacle.unplayable ? [withoutInitialAccess.key] : []),
    ],
    chains: { direct, withoutInitialAccess },
  };
};
