import type { ActorClass } from '../threat-analyses/actor-classes';
import type { AssetCategory, DeclaredCriticality } from '../supporting-assets/constants';
import type { EngineRunActor, EngineRunBasket, EngineRunBasketDifference, EngineRunControl, EngineRunInputs, EngineRunPlan } from './engine/engine-run';
import type { AttackRunTechnique, AttackRunTestedCell, AttackRunWithoutInitialAccess } from './engine/attack-run-law';
import type { CoverageBucket, StrengthRung } from '../controls/capability/constants';
import type { EstateCollapseMember, EstateCountRow, EstateRouteRow } from './attack-run-estate';
import type { UnknownExposureCountsAs } from '../attack-surfaces/entry-applicability';
import type { DoorCountRow, EntryOpeningRow, PrimaryUserRow } from './attack-run-door-estate';
import type { DeclaredEstateCompletion } from './declared-estate-completion';
import type { PertRange } from './engine/attack-run-worlds';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { compareCodePoints } from '@app/utils';
import { ACTOR_CLASS_VALUES } from '../threat-analyses/actor-classes';
import { mitreTacticsData, mitreTechniquesData } from '../mitre-attack/data';
import { CONTROL_FAMILY_PROTECTION } from '../controls/capability/data/control-family-protection';
import { controlCapabilitiesData, controlCapabilityEdgesData } from '../controls/capability/data/capabilities.generated';
import { ATTACK_WALK_TABLES_RELEASE } from './engine/attack-walk';
import { POPULATION_SCOPED_TECHNIQUE_EXTERNAL_IDS } from './engine/population-scoped-techniques';
import { actorClassKnobs, ATTACK_RUN_CONSTANTS } from './engine/attack-run-constants';
import { prepareCollapse } from './attack-run-estate';
import { buildDoorEstate } from './attack-run-door-estate';
import { isDoorTechnique, testedCellReader } from './engine/attack-run-law';

/**
 * The layer between the repositories and the law: it turns a tenant's rows into the specification's
 * section 3 inputs, and it is the only place that knows what was dropped on the way.
 *
 * Everything the surface has to say about reach is produced here for that reason. Two gaps travel
 * separately and must never be reported as one: a pair **this estate does not contest** is a real
 * defensive gap the tenant can close, while a pair **no capability in the catalogue reaches** is a
 * modelling gap that drives catalogue work and says nothing about the tenant.
 */

/** One (technique, family) pair and why it left the run. */
export interface UnreachedPair {
  readonly techniqueExternalId: string,
  readonly family: AssetCategory,
}

export interface AttackRunReachReport {
  /**
   * Playable pairs the tenant's own declared posture contests with nothing. A tenant fact. Both this
   * list and the set below hold every repertoire technique, a path technique at prevalence 0 too:
   * whether the engine plays one is the law's to say, so the run narrows them to what it played.
   */
  readonly uncontestedByEstate: ReadonlyArray<UnreachedPair>,
  /**
   * The techniques at least one declared control contests somewhere it is played. It is the
   * complement of the list above at the technique grain rather than at the pair grain, because a
   * technique contested on one family and not another is covered, not uncovered.
   */
  readonly contestedTechniqueExternalIds: ReadonlySet<string>,
  /** Pairs no capability of the catalogue reaches at all, excluded from the run. A model fact. */
  readonly uncontestableByCatalogue: ReadonlyArray<UnreachedPair>,
  /** Assets carrying no vulnerability data, over the estate the scenario touches. */
  readonly unscannedAssetShare: number,
  readonly unscannedAssetCount: number,
  readonly estateAssetCount: number,
  /**
   * The virtual assets the declared estate added to the walked families, and their share of the
   * walked estate with them. Absent when the scope declared nothing, so the digest of a run without
   * a declaration is the one it always was.
   */
  readonly declared?: { readonly assetCount: number, readonly assetShare: number },
  readonly catalogueVintage: string,
  readonly threatRelevance: {
    readonly evidenceMode: string,
    readonly admittedActorCount: number,
  },
}

/**
 * A fingerprint standing in for a version the capability catalogue does not carry.
 *
 * An ALE move caused by a catalogue release has to be attributable as such, and the only stable
 * things to hang that on today are the ATT&CK release the reference tables are written against and
 * the shape of the catalogue itself. Both change exactly when the reach can change.
 */
export const ATTACK_RUN_CATALOGUE_VINTAGE =
  `${ATTACK_WALK_TABLES_RELEASE}/${controlCapabilitiesData.length}c-${controlCapabilityEdgesData.length}e`;

const CAPABILITY_EXTERNAL_ID_BY_ID = new Map(controlCapabilitiesData.map((capability) => [capability.id, capability.externalId]));

/**
 * The tactics each technique serves, from the vendored ATT&CK release rather than from the database.
 * The walk table, the noise table and the impairment relation are all written against that release,
 * so reading the tactics from anywhere else would let one of the four drift from the other three.
 */
const TACTIC_EXTERNAL_IDS_BY_TECHNIQUE: ReadonlyMap<string, ReadonlyArray<string>> = (() => {
  const externalIdByTacticId = new Map(mitreTacticsData.map((tactic) => [tactic.id, tactic.externalId]));
  return new Map(mitreTechniquesData.map((technique) => [
    technique.externalId,
    technique.tacticIds.flatMap((tacticId) => {
      const externalId = externalIdByTacticId.get(tacticId);
      return externalId === undefined ? [] : [externalId];
    }),
  ]));
})();

const protectedFamilies = (capabilityExternalId: string): ReadonlyArray<AssetCategory> =>
  (CONTROL_FAMILY_PROTECTION as Readonly<Record<string, ReadonlyArray<AssetCategory>>>)[capabilityExternalId] ?? [];

/**
 * The families some capability of the catalogue can contest a technique on, either function.
 *
 * A pair covered only by detect capabilities stays in the run with an empty prevent product,
 * because that gap belongs to the tenant. Reach is read off the catalogue alone: a tenant's own
 * technique overrides move the products and never the excluded set, or a tenant could widen the
 * modelled world by declaring an edge.
 */
const CATALOGUE_CONTESTED_FAMILIES: ReadonlyMap<string, ReadonlySet<AssetCategory>> = (() => {
  const byTechnique = new Map<string, Set<AssetCategory>>();
  for (const edge of controlCapabilityEdgesData) {
    const capabilityExternalId = CAPABILITY_EXTERNAL_ID_BY_ID.get(edge.capabilityId);
    if (capabilityExternalId === undefined) {
      continue;
    }
    const held = byTechnique.get(edge.techniqueExternalId) ?? new Set<AssetCategory>();
    for (const family of protectedFamilies(capabilityExternalId)) {
      held.add(family);
    }
    byTechnique.set(edge.techniqueExternalId, held);
  }
  return byTechnique;
})();

export interface AttackRunInputsSource {
  readonly terminalTacticExternalId: string,
  /**
   * Per technique external id, the asset families the surface table admits it on. It must carry the
   * techniques of `withoutInitialAccess` too: one with no family here is dropped from the path.
   */
  readonly applicableFamiliesByTechnique: ReadonlyMap<string, ReadonlyArray<AssetCategory>>,
  readonly mixture: ReadonlyArray<{
    readonly groupKey: string,
    readonly name: string,
    readonly share: number,
    readonly techniqueExternalIds: ReadonlyArray<string>,
    readonly actorClass: ActorClass,
    readonly cveExternalIds: ReadonlySet<string>,
  }>,
  readonly controls: ReadonlyArray<{
    readonly controlId: string,
    readonly capabilityExternalId: string,
    readonly strengthRung: StrengthRung,
    readonly coverageBucket: CoverageBucket,
    readonly preventTechniqueExternalIds: ReadonlyArray<string>,
    readonly detectTechniqueExternalIds: ReadonlyArray<string>,
    /** What OpenAEV observed of the control on the scenario's risk scope. */
    readonly tested?: ReadonlyArray<AttackRunTestedCell>,
  }>,
  readonly estate: {
    readonly counts: ReadonlyArray<EstateCountRow>,
    readonly scenarioGroupCounts: ReadonlyArray<EstateCountRow>,
    readonly routes: ReadonlyArray<EstateRouteRow>,
    readonly unscannedAssetCount: number,
    /** What the initial access campaign reads, over every family and not only the touched ones. */
    readonly door: {
      readonly counts: ReadonlyArray<DoorCountRow>,
      readonly openings: ReadonlyArray<EntryOpeningRow>,
      /** The user accounts and the devices they are the primary user of, which phishing reads its people from. */
      readonly primaryUsers: ReadonlyArray<PrimaryUserRow>,
    },
    /** The virtual assets completing the measured estate up to the scope's declaration; absent when it declared nothing. */
    readonly declared?: DeclaredEstateCompletion,
  },
  /** What the tenant declares about the people phishing reaches. */
  readonly phishing: { readonly declaredSusceptibility: number | null },
  readonly unknownExposureCountsAs: UnknownExposureCountsAs,
  readonly unknownCriticalityCountsAs: DeclaredCriticality,
  /** The attack path the scenario's outcome sends around the door; absent when it sends none. */
  readonly withoutInitialAccess?: AttackRunWithoutInitialAccess,
  /** The tenant's treatment plans, which the engine resolves against the controls of this run. */
  readonly plans: ReadonlyArray<EngineRunPlan>,
  /** The postures the scope's open budget reviews are priced on, and the differences that are their figures. */
  readonly baskets?: ReadonlyArray<EngineRunBasket>,
  readonly basketDifferences?: ReadonlyArray<EngineRunBasketDifference>,
  readonly annualLossBaskets?: ReadonlyArray<string>,
  readonly tef: PertRange | null,
  readonly lossDrivers: ReadonlyArray<PertRange>,
  readonly reactionTimeHours: PertRange,
  readonly worlds: number,
  readonly seed: string,
  readonly threatRelevance: AttackRunReachReport['threatRelevance'],
  /** Whether the run prices the CVE what-ifs: only then are the groups of each priced CVE built. */
  readonly computesCveWhatIfs: boolean,
}

export interface ResolvedAttackRunInputs {
  readonly inputs: EngineRunInputs,
  readonly reach: AttackRunReachReport,
}

/**
 * What the input fingerprint covers: the baseline every profile computes alike, and the plans apart.
 * The groups of each priced CVE and the CVEs priced by their floor alone are left out, since only a
 * run that prices the CVE what-ifs builds them.
 */
export const fingerprintedBaseline = (inputs: EngineRunInputs) => {
  const {
    plans,
    baskets: _baskets,
    basketDifferences: _basketDifferences,
    annualLossBaskets: _annualLossBaskets,
    floorCves: _floorCves,
    ...baseline
  } = inputs;
  return { plans, baseline: { ...baseline, actors: baseline.actors.map(({ cveGroups: _cveGroups, ...actor }) => actor) } };
};

/*
 * Every collection below reaches a float reduction or a per-index seed, so the run's output depends
 * on its order. None of the reads that fill them fixes one: they come back in whatever order the
 * planner produced, which moves with the table statistics. Canonicalising here rather than adding
 * an `order by` to each read keeps the engine's determinism a property of the engine, which the
 * tests rely on and which the next read added cannot take away.
 */
const canonicalise = (source: AttackRunInputsSource): AttackRunInputsSource => ({
  ...source,
  applicableFamiliesByTechnique: new Map([...source.applicableFamiliesByTechnique]
    .map(([externalId, families]) => [externalId, [...families].sort(compareCodePoints)])),
  mixture: [...source.mixture]
    .sort((first, second) => compareCodePoints(first.groupKey, second.groupKey))
    .map((group) => ({ ...group, techniqueExternalIds: [...group.techniqueExternalIds].sort(compareCodePoints) })),
  controls: [...source.controls]
    .sort((first, second) => compareCodePoints(first.controlId, second.controlId))
    .map((control) => (control.tested === undefined ? control : {
      ...control,
      tested: [...control.tested].sort((first, second) => compareCodePoints(first.function, second.function)
        || compareCodePoints(first.techniqueExternalId, second.techniqueExternalId)),
    })),
  estate: {
    ...source.estate,
    door: {
      ...source.estate.door,
      primaryUsers: [...source.estate.door.primaryUsers].sort((first, second) =>
        compareCodePoints(first.identityId, second.identityId) || compareCodePoints(first.deviceId, second.deviceId)),
    },
  },
  withoutInitialAccess: source.withoutInitialAccess === undefined ? undefined : {
    key: source.withoutInitialAccess.key,
    share: source.withoutInitialAccess.share,
    techniqueExternalIds: [...source.withoutInitialAccess.techniqueExternalIds].sort(compareCodePoints),
  },
  plans: [...source.plans]
    .sort((first, second) => compareCodePoints(first.planId, second.planId))
    .map((plan) => ({
      ...plan,
      moves: [...plan.moves].sort((first, second) => compareCodePoints(first.controlId, second.controlId)),
    })),
  baskets: [...source.baskets ?? []]
    .sort((first, second) => compareCodePoints(first.basketId, second.basketId))
    .map((basket) => ({
      ...basket,
      moves: [...basket.moves].sort((first, second) => compareCodePoints(first.controlId, second.controlId)),
    })),
  /* Two drivers holding the same range are interchangeable: they draw two columns the magnitude
   * sums, and swapping two addends is exact. So the range is a sufficient key, and the estimate id
   * the engine has no other use for stays out of its inputs. */
  lossDrivers: [...source.lossDrivers]
    .sort((first, second) => (first.min - second.min) || (first.likely - second.likely) || (first.max - second.max)),
});

/** The virtual assets join the estate counts only in the walked families, as the measured ones are read. */
const withDeclaredEstate = (source: AttackRunInputsSource): { source: AttackRunInputsSource, declared?: { assetCount: number } } => {
  const completion = source.estate.declared;
  if (completion === undefined) {
    return { source };
  }
  const walkedFamilies = new Set([...source.applicableFamiliesByTechnique.values()].flat());
  const counts = completion.counts.filter((row) => walkedFamilies.has(row.categoryId));
  return {
    source: {
      ...source,
      estate: {
        ...source.estate,
        counts: [...source.estate.counts, ...counts],
        door: { ...source.estate.door, counts: [...source.estate.door.counts, ...completion.doorCounts] },
      },
    },
    declared: { assetCount: counts.reduce((sum, row) => sum + row.count, 0) },
  };
};

/**
 * One attacker per actor class, standing for the class's admitted actors: it carries the sum of
 * their shares, and each technique of their pooled repertoire carries the share of the class holding
 * it.
 *
 * Yields to the event loop between attackers: each estate collapse is one synchronous pass over the
 * whole route set, and a run holding the loop for the length of several of them starves the job
 * runtime and the HTTP server it shares a process with.
 */
export const resolveAttackRunInputs = async (unordered: AttackRunInputsSource): Promise<ResolvedAttackRunInputs> => {
  const { source, declared } = withDeclaredEstate(canonicalise(unordered));
  const estateFamilies = new Set(source.estate.counts.map((row) => row.categoryId));
  const uncontestableByCatalogue: Array<UnreachedPair> = [];
  const seenPair = new Set<string>();

  const applicableOn = (externalId: string): Array<AssetCategory> =>
    (source.applicableFamiliesByTechnique.get(externalId) ?? []).filter((family) => estateFamilies.has(family));

  const techniqueOf = (externalId: string): AttackRunTechnique => {
    const applicable = applicableOn(externalId);
    const contested = CATALOGUE_CONTESTED_FAMILIES.get(externalId) ?? new Set<AssetCategory>();
    for (const family of applicable) {
      const pair = `${externalId}|${family}`;
      if (!contested.has(family) && !seenPair.has(pair)) {
        seenPair.add(pair);
        uncontestableByCatalogue.push({ techniqueExternalId: externalId, family });
      }
    }
    return {
      externalId,
      tacticExternalIds: TACTIC_EXTERNAL_IDS_BY_TECHNIQUE.get(externalId) ?? [],
      families: applicable.filter((family) => contested.has(family)),
      populationScoped: POPULATION_SCOPED_TECHNIQUE_EXTERNAL_IDS.has(externalId),
    };
  };

  // A result the engine does not read stays out, or moving it would change the run's fingerprint.
  const controls: Array<EngineRunControl> = source.controls.map((control) => {
    const tested = (control.tested ?? []).filter(testedCellReader(control));
    return {
      controlId: control.controlId,
      capabilityExternalId: control.capabilityExternalId,
      strengthRung: control.strengthRung,
      coverageBucket: control.coverageBucket,
      preventTechniqueExternalIds: control.preventTechniqueExternalIds,
      detectTechniqueExternalIds: control.detectTechniqueExternalIds,
      ...(tested.length === 0 ? {} : { tested }),
    };
  });

  const declaredFamiliesByTechnique = new Map<string, Set<AssetCategory>>();
  for (const control of source.controls) {
    if (control.strengthRung === 'L0' || control.coverageBucket === 'L0') {
      continue;
    }
    const families = protectedFamilies(control.capabilityExternalId);
    for (const externalId of [...control.preventTechniqueExternalIds, ...control.detectTechniqueExternalIds]) {
      const held = declaredFamiliesByTechnique.get(externalId) ?? new Set<AssetCategory>();
      for (const family of families) {
        held.add(family);
      }
      declaredFamiliesByTechnique.set(externalId, held);
    }
  }

  /*
   * The path around the door is never closed by what the catalogue can contest: its techniques keep
   * every family the surface admits, on the side of the repertoire only that path reads, and a pair
   * the catalogue cannot contest is no entry of the reach report unless the class holds the technique.
   */
  const pathTechniqueIds = source.withoutInitialAccess?.techniqueExternalIds.filter((externalId) => applicableOn(externalId).length > 0) ?? [];
  const pathTechniqueOf = (externalId: string, prevalence: number): AttackRunTechnique => {
    const applicable = applicableOn(externalId);
    const contested = CATALOGUE_CONTESTED_FAMILIES.get(externalId) ?? new Set<AssetCategory>();
    return {
      externalId,
      tacticExternalIds: TACTIC_EXTERNAL_IDS_BY_TECHNIQUE.get(externalId) ?? [],
      families: applicable.filter((family) => contested.has(family)),
      pathFamilies: applicable,
      populationScoped: POPULATION_SCOPED_TECHNIQUE_EXTERNAL_IDS.has(externalId),
      prevalence,
    };
  };

  const techniqueByExternalId = new Map<string, AttackRunTechnique>();
  const playableOf = (externalIds: ReadonlyArray<string>): Array<AttackRunTechnique> => externalIds.flatMap((externalId) => {
    const technique = techniqueByExternalId.get(externalId) ?? techniqueOf(externalId);
    techniqueByExternalId.set(externalId, technique);
    return technique.families.length > 0 ? [technique] : [];
  });

  const pending: Array<{ actor: Omit<EngineRunActor, 'groups' | 'cveGroups'>, members: Array<EstateCollapseMember> }> = [];
  for (const actorClass of ACTOR_CLASS_VALUES) {
    const members = source.mixture
      .filter((group) => group.actorClass === actorClass)
      .map((group) => ({
        share: group.share,
        cveExternalIds: group.cveExternalIds,
        techniqueExternalIds: new Set(playableOf(group.techniqueExternalIds).map((technique) => technique.externalId)),
      }));
    const share = members.reduce((sum, member) => sum + member.share, 0);
    if (members.length === 0 || !(share > 0)) {
      continue;
    }
    const heldShare = new Map<string, number>();
    for (const member of members) {
      for (const externalId of member.techniqueExternalIds) {
        heldShare.set(externalId, (heldShare.get(externalId) ?? 0) + member.share);
      }
    }
    const pathHeldShare = (externalId: string): number => source.mixture
      .filter((group) => group.actorClass === actorClass && group.techniqueExternalIds.includes(externalId))
      .reduce((sum, group) => sum + group.share, 0);
    const repertoire = [
      ...[...heldShare]
        .filter(([externalId]) => !pathTechniqueIds.includes(externalId))
        .map(([externalId, held]) => ({ ...techniqueByExternalId.get(externalId)!, prevalence: Math.min(1, held / share) })),
      ...pathTechniqueIds.map((externalId) => pathTechniqueOf(externalId, Math.min(1, pathHeldShare(externalId) / share))),
    ].sort((first, second) => compareCodePoints(first.externalId, second.externalId));
    pending.push({
      actor: { key: actorClass, name: null, actorClass, knobs: actorClassKnobs(actorClass), share, repertoire },
      members,
    });
  }

  const door = buildDoorEstate({
    techniqueExternalIds: [...new Set(pending.flatMap(({ actor }) => actor.repertoire
      .filter(isDoorTechnique)
      .map((technique) => technique.externalId.split('.')[0])))],
    applicableFamiliesByTechnique: source.applicableFamiliesByTechnique,
    counts: source.estate.door.counts,
    openings: source.estate.door.openings,
    primaryUsers: source.estate.door.primaryUsers,
    unknownExposureCountsAs: source.unknownExposureCountsAs,
  });
  const pricedCveIds = door.cves.filter((cve) => cve.priced).map((cve) => cve.cveId).sort(compareCodePoints);
  /* A cited CVE the door does not price still floors routes after it, so it is priced on a law of its own. */
  const doorCveIds = new Set(door.cves.map((cve) => cve.cveId));
  const pricedCveIdSet = new Set(pricedCveIds);
  const floorCandidateIds = source.computesCveWhatIfs
    ? [...new Set(source.estate.routes
      .filter((route) => !pricedCveIdSet.has(route.cveRowId))
      .map((route) => route.cveRowId))]
    : [];
  const whatIfCveIds = [...pricedCveIds, ...floorCandidateIds].sort(compareCodePoints);

  const actors: Array<EngineRunActor> = [];
  for (const { actor, members } of pending) {
    const collapse = prepareCollapse({
      counts: source.estate.counts,
      scenarioGroupCounts: source.estate.scenarioGroupCounts,
      routes: source.estate.routes,
      members,
    });
    actors.push({
      ...actor,
      groups: collapse.groups,
      cveGroups: source.computesCveWhatIfs
        ? whatIfCveIds.flatMap((cveId) => {
          const groups = collapse.without(cveId);
          return groups === null ? [] : [{ cveId, groups }];
        })
        : [],
    });
    await yieldToEventLoop();
  }

  const floorCveIds = [...new Set(actors.flatMap((actor) => (actor.cveGroups ?? [])
    .map((entry) => entry.cveId)
    .filter((cveId) => !doorCveIds.has(cveId))))].sort(compareCodePoints);

  const uncontestedByEstate: Array<UnreachedPair> = [];
  const seenUncontested = new Set<string>();
  const contestedTechniqueExternalIds = new Set<string>();
  for (const actor of actors) {
    for (const technique of actor.repertoire) {
      const declaredFamilies = declaredFamiliesByTechnique.get(technique.externalId);
      for (const family of technique.families) {
        const pair = `${technique.externalId}|${family}`;
        if (declaredFamilies?.has(family) === true) {
          contestedTechniqueExternalIds.add(technique.externalId);
        } else if (!seenUncontested.has(pair)) {
          seenUncontested.add(pair);
          uncontestedByEstate.push({ techniqueExternalId: technique.externalId, family });
        }
      }
    }
  }

  const estateAssetCount = source.estate.counts.reduce((sum, row) => sum + row.count, 0) - (declared?.assetCount ?? 0);
  return {
    inputs: {
      terminalTacticExternalId: source.terminalTacticExternalId,
      controls,
      actors,
      plans: source.plans,
      baskets: source.baskets,
      basketDifferences: source.basketDifferences,
      annualLossBaskets: source.annualLossBaskets,
      tef: source.tef,
      lossDrivers: source.lossDrivers,
      reactionTimeHours: source.reactionTimeHours,
      constants: ATTACK_RUN_CONSTANTS,
      door,
      floorCves: floorCveIds.map((cveId) => ({ cveId })),
      phishing: source.phishing,
      unknownExposureCountsAs: source.unknownExposureCountsAs,
      unknownCriticalityCountsAs: source.unknownCriticalityCountsAs,
      ...(source.withoutInitialAccess === undefined ? {} : { withoutInitialAccess: source.withoutInitialAccess }),
      ...((source.estate.declared?.kinds.length ?? 0) === 0 ? {} : { declaredKinds: source.estate.declared!.kinds }),
      worlds: source.worlds,
      seed: source.seed,
    },
    reach: {
      uncontestedByEstate,
      contestedTechniqueExternalIds,
      uncontestableByCatalogue,
      unscannedAssetCount: source.estate.unscannedAssetCount,
      unscannedAssetShare: estateAssetCount === 0 ? 0 : source.estate.unscannedAssetCount / estateAssetCount,
      estateAssetCount,
      ...(declared === undefined ? {} : {
        declared: {
          assetCount: declared.assetCount,
          assetShare: estateAssetCount + declared.assetCount === 0 ? 0 : declared.assetCount / (estateAssetCount + declared.assetCount),
        },
      }),
      catalogueVintage: ATTACK_RUN_CATALOGUE_VINTAGE,
      threatRelevance: source.threatRelevance,
    },
  };
};
