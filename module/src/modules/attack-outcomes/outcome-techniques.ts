import type { AttackerMixture, TechniqueWeight } from '../threat-analyses/technique-weighting';
import type { ThreatEntityType } from '../threat-analyses/entity-types';
import { foldToParentTechnique } from '../threat-analyses/technique-weighting';
import {
  INFERRED_MAX_COUNT,
  INFERRED_MIN_GROUPS,
  INFERRED_MIN_WEIGHT,
  NO_EVIDENCE_RELATED_WEIGHT,
  NO_EVIDENCE_SIGNATURE_WEIGHT,
} from './constants';

/**
 * Why the weights were computed the way they were:
 * - `attacker-mixture`: at least one admitted relevant threat uses at least one technique, so every
 *   weight is a repertoire share of that mixture.
 * - `no-relevant-threats`: nothing was admitted (or nothing admitted uses anything), so the curated
 *   techniques fall back to flat editorial levels.
 * - `mixture-pending`: the pair carries a risk scenario but its mixture is not stored yet, so there
 *   is nothing to read.
 * - `no-scenario`: no mixture is stored and the pair carries no risk scenario, so none will be
 *   computed, and the curated techniques fall back to flat editorial levels as for
 *   `no-relevant-threats`.
 */
export type OutcomeEvidenceMode = 'attacker-mixture' | 'no-relevant-threats' | 'mixture-pending' | 'no-scenario';

export type EmptyEvidenceMode = 'mixture-pending' | 'no-scenario';

export type CuratedFallbackMode = 'no-relevant-threats' | 'no-scenario';

export type CuratedCategory = 'signature' | 'related';

/** One curated `attack_outcome_mitre_techniques` row, as the repository projects it. */
export interface CuratedTechnique {
  mitreTechniqueId: string,
  category: CuratedCategory,
  externalId: string,
  name: string,
  revoked: boolean,
}

/** One MITRE catalog row, used to resolve an inferred external id into a technique. */
export interface CatalogTechnique {
  mitreTechniqueId: string,
  externalId: string,
  name: string,
  revoked: boolean,
}

/** One deduplicated actor of the mixture behind a technique weight. */
export interface OutcomeTechniqueThreat {
  id: string,
  canonicalName: string,
  entityType: ThreatEntityType,
  /** `pi_g`, the actor's own share of the mixture. The contributions sum to the technique's weight. */
  share: number,
}

export interface OutcomeTechnique {
  mitreTechniqueId: string,
  externalId: string,
  name: string,
  category: 'signature' | 'related' | 'inferred',
  revoked: boolean,
  /**
   * P(the attacker uses this technique | a threat event of this outcome occurs), read as the share
   * of the admitted actor mixture whose repertoire contains it. In [0, 1], 0 when nobody admitted
   * uses it.
   */
  weight: number,
  /** Contributing actors, highest share first. Empty when the weight is 0 or came from a fallback. */
  threats: Array<OutcomeTechniqueThreat>,
  /** Number of contributing actors: the corroboration count the inferred gate is expressed on. */
  sourceCount: number,
  /**
   * The part of `weight` that blocking this technique would actually DENY rather than displace: the
   * summed shares of the contributing actors whose ingested repertoire holds no other technique
   * sharing a tactic with it. At `bindingShare = weight` every user of the technique loses a stage;
   * at 0 every one of them has a documented alternative and the interdiction only reroutes it.
   *
   * Display metadata, computed at read time and never persisted: it is a property of the ingested
   * repertoires and of the MITRE catalog, both of which move under a stored run.
   */
  bindingShare: number,
}

/**
 * One admitted actor of the mixture, published for the group-conditional CRQ engine.
 *
 * `techniqueExternalIds` is the actor's repertoire INTERSECTED with the emitted technique set, which
 * is the same universe the published weights were computed over. That intersection is the binding
 * same-universe contract of `computeScenarioTechniqueWeights`: the engine iterates this playbook for
 * the per-actor term against the published `weight_t`, so the two halves of V must be read over one
 * set of techniques.
 */
export interface OutcomeMixtureGroup {
  groupKey: string,
  name: string,
  entityType: ThreatEntityType,
  /** `pi_g`, the share of attacks this actor carries. */
  share: number,
  techniqueExternalIds: Array<string>,
}

export interface OutcomeTechniques {
  evidenceMode: OutcomeEvidenceMode,
  /** Empty in the fallback mode, where no actor was admitted. */
  mixtureGroups: Array<OutcomeMixtureGroup>,
  techniques: Array<OutcomeTechnique>,
}

const NO_EVIDENCE_WEIGHTS: Record<CuratedCategory, number> = {
  signature: NO_EVIDENCE_SIGNATURE_WEIGHT,
  related: NO_EVIDENCE_RELATED_WEIGHT,
};

const CATEGORY_RANK: Record<CuratedCategory, number> = { signature: 2, related: 1 };

const isParentRow = (technique: CuratedTechnique): boolean =>
  foldToParentTechnique(technique.externalId) === technique.externalId.trim().toUpperCase();

/**
 * One curated row per PARENT technique.
 *
 * The mixture is keyed by parent (`weightByParentId`), so a curated pair like T1003 and T1003.001 on
 * the same outcome would both be emitted as active carrying the identical share, and the CRQ Monte
 * Carlo would then multiply `(1 - a_t(1 - r_t))` twice for what the model treats as a single
 * repertoire membership, inflating vulnerability by technique bookkeeping alone. The curated
 * junction is seeded parent-only today, so this is an invariant guard rather than a live fix, but
 * nothing in the schema enforces it and a future custom-outcome feature would use this same path.
 *
 * Representative: the parent row when the outcome carries one, else the strongest category, else the
 * first in input order (the repository returns a stable order, so the result is reproducible).
 */
export const dedupeCuratedByParent = (curated: Array<CuratedTechnique>): Array<CuratedTechnique> => {
  const byParentId = new Map<string, CuratedTechnique>();
  for (const technique of curated) {
    const parentId = foldToParentTechnique(technique.externalId);
    const incumbent = byParentId.get(parentId);
    if (!incumbent) {
      byParentId.set(parentId, technique);
      continue;
    }
    if (isParentRow(incumbent) !== isParentRow(technique)) {
      if (isParentRow(technique)) {
        byParentId.set(parentId, technique);
      }
      continue;
    }
    if (CATEGORY_RANK[technique.category] > CATEGORY_RANK[incumbent.category]) {
      byParentId.set(parentId, technique);
    }
  }
  return [...byParentId.values()];
};

/**
 * Techniques of the mixture repertoire no analyst curated on the outcome, gated on corroboration
 * (`INFERRED_MIN_GROUPS` distinct actors), on magnitude (`INFERRED_MIN_WEIGHT`) and on count
 * (`INFERRED_MAX_COUNT` strongest). `weights` arrives sorted by descending weight, so the slice
 * keeps the strongest candidates and the emitted order is the ranking.
 */
export const selectInferredCandidates = (
  weights: Array<TechniqueWeight>,
  curatedParentIds: Set<string>,
): Array<TechniqueWeight> => weights
  .filter((weight) => !curatedParentIds.has(weight.mitreExternalId)
    && weight.contributions.length >= INFERRED_MIN_GROUPS
    && weight.weight >= INFERRED_MIN_WEIGHT)
  .slice(0, INFERRED_MAX_COUNT);

export const buildNoEvidenceResult = (curated: Array<CuratedTechnique>, evidenceMode: CuratedFallbackMode): OutcomeTechniques => ({
  evidenceMode,
  mixtureGroups: [],
  techniques: dedupeCuratedByParent(curated).map((technique) => ({
    mitreTechniqueId: technique.mitreTechniqueId,
    externalId: technique.externalId,
    name: technique.name,
    category: technique.category,
    revoked: technique.revoked,
    weight: NO_EVIDENCE_WEIGHTS[technique.category],
    threats: [],
    sourceCount: 0,
    // No actor was admitted or read, so there is no repertoire to look for an alternative in: the
    // fallback levels are editorial, and claiming a chokepoint from them would be claiming CTI there
    // is none.
    bindingShare: 0,
  })),
});

export const buildPendingOutcomeTechniques = (): OutcomeTechniques => ({
  evidenceMode: 'mixture-pending',
  mixtureGroups: [],
  techniques: [],
});

const toThreats = (weight: TechniqueWeight): Array<OutcomeTechniqueThreat> =>
  weight.contributions.map((contribution) => ({
    id: contribution.groupKey,
    canonicalName: contribution.name,
    entityType: contribution.entityType,
    share: contribution.share,
  }));

/**
 * Per contributing actor, whether blocking a technique leaves that actor a same-tactic alternative
 * IN ITS OWN INGESTED REPERTOIRE, and the summed shares of the actors it leaves with none.
 *
 * The repertoire read here is the actor's whole ingested one, not the outcome-filtered subset: an
 * actor that would simply switch to a technique this outcome does not describe still has the stage
 * covered, and pretending otherwise would manufacture chokepoints out of the curation boundary.
 *
 * A technique with no tactic on file is never counted as binding. The claim "this blocks a stage"
 * needs to know which stage; absent that, the honest answer is silence, not a chokepoint. The same
 * asymmetry applies to reporting gaps in general: MITRE technique-to-tactic mapping is positive-only,
 * so an unlisted alternative reads as no alternative, which is why this is display metadata and not
 * an input to the ranking.
 */
export const computeBindingShares = (params: {
  groups: Array<{ groupKey: string, share: number, techniqueExternalIds: Array<string> }>,
  tacticIdsByTechniqueExternalId: ReadonlyMap<string, Array<string>>,
}): Map<string, Map<string, boolean>> => {
  const bindingByGroupKey = new Map<string, Map<string, boolean>>();
  for (const group of params.groups) {
    const repertoire = [...new Set(group.techniqueExternalIds.map(foldToParentTechnique))];
    const techniqueCountByTacticId = new Map<string, number>();
    for (const externalId of repertoire) {
      for (const tacticId of params.tacticIdsByTechniqueExternalId.get(externalId) ?? []) {
        techniqueCountByTacticId.set(tacticId, (techniqueCountByTacticId.get(tacticId) ?? 0) + 1);
      }
    }
    const binding = new Map<string, boolean>();
    for (const externalId of repertoire) {
      const tacticIds = params.tacticIdsByTechniqueExternalId.get(externalId) ?? [];
      binding.set(externalId, tacticIds.length > 0
        && tacticIds.every((tacticId) => (techniqueCountByTacticId.get(tacticId) ?? 0) <= 1));
    }
    bindingByGroupKey.set(group.groupKey, binding);
  }
  return bindingByGroupKey;
};

const bindingShareOf = (
  externalId: string,
  weight: TechniqueWeight | undefined,
  bindingByGroupKey: ReadonlyMap<string, ReadonlyMap<string, boolean>>,
): number => {
  if (!weight) {
    return 0;
  }
  const parentId = foldToParentTechnique(externalId);
  return weight.contributions.reduce(
    (total, contribution) =>
      bindingByGroupKey.get(contribution.groupKey)?.get(parentId) === true ? total + contribution.share : total,
    0,
  );
};

/**
 * Turns one outcome's curated technique rows plus the mixture computed over its admitted actors into
 * the published technique list. Pure: the MITRE catalog rows the inferred set resolves against are
 * handed in, so a batch of outcomes issues one catalog query instead of one per outcome.
 *
 * Curated techniques are always emitted, at weight 0 when no admitted actor uses them: a technique
 * the analyst curated must stay visible on the TTPs tab even when the CTI does not corroborate it
 * (the CRQ set is what `isActiveTechnique` filters afterwards, not this list).
 *
 * An inferred external id absent from the catalog is dropped rather than fabricated.
 */
export const buildOutcomeTechniques = (params: {
  curated: Array<CuratedTechnique>,
  mixture: AttackerMixture,
  weights: Array<TechniqueWeight>,
  inferredCandidates: Array<TechniqueWeight>,
  catalogByExternalId: Map<string, CatalogTechnique>,
  /** Tactic ids per PARENT technique external id, over the admitted actors' ingested repertoires. */
  tacticIdsByTechniqueExternalId: ReadonlyMap<string, Array<string>>,
}): OutcomeTechniques => {
  const curated = dedupeCuratedByParent(params.curated);
  const weightByParentId = new Map(params.weights.map((weight) => [weight.mitreExternalId, weight]));
  const bindingByGroupKey = computeBindingShares({
    groups: params.mixture.groups,
    tacticIdsByTechniqueExternalId: params.tacticIdsByTechniqueExternalId,
  });

  const directTechniques: Array<OutcomeTechnique> = curated.map((technique) => {
    const weight = weightByParentId.get(foldToParentTechnique(technique.externalId));
    return {
      mitreTechniqueId: technique.mitreTechniqueId,
      externalId: technique.externalId,
      name: technique.name,
      category: technique.category,
      revoked: technique.revoked,
      weight: weight?.weight ?? 0,
      threats: weight ? toThreats(weight) : [],
      sourceCount: weight?.contributions.length ?? 0,
      bindingShare: bindingShareOf(technique.externalId, weight, bindingByGroupKey),
    };
  });

  const inferredTechniques: Array<OutcomeTechnique> = params.inferredCandidates.flatMap((weight) => {
    const technique = params.catalogByExternalId.get(weight.mitreExternalId);
    if (!technique) {
      return [];
    }
    return [{
      mitreTechniqueId: technique.mitreTechniqueId,
      externalId: technique.externalId,
      name: technique.name,
      category: 'inferred' as const,
      revoked: technique.revoked,
      weight: weight.weight,
      threats: toThreats(weight),
      sourceCount: weight.contributions.length,
      bindingShare: bindingShareOf(technique.externalId, weight, bindingByGroupKey),
    }];
  });

  const techniques = [...directTechniques, ...inferredTechniques];
  // No actor uses anything the outcome can be described with: the mixture carries no information
  // here, so fall back rather than hand the CRQ engine an all-zero technique set it cannot run on.
  if (!techniques.some((technique) => technique.weight > 0)) {
    return buildNoEvidenceResult(params.curated, 'no-relevant-threats');
  }
  const emittedParentIds = new Set(techniques.map((technique) => foldToParentTechnique(technique.externalId)));
  return {
    evidenceMode: 'attacker-mixture',
    mixtureGroups: params.mixture.groups.map((group) => ({
      groupKey: group.groupKey,
      name: group.name,
      entityType: group.entityType,
      share: group.share,
      techniqueExternalIds: group.techniqueExternalIds.filter((externalId) => emittedParentIds.has(externalId)),
    })),
    techniques,
  };
};

/** One technique of the admitted actors' observed repertoires, folded to its parent. */
export interface RepertoireTechnique {
  mitreTechniqueId: string,
  externalId: string,
  name: string,
  revoked: boolean,
  weight: number,
  threats: Array<OutcomeTechniqueThreat>,
  sourceCount: number,
  /** Kill-chain stages the technique belongs to, in ATT&CK's own order. */
  tacticNames: Array<string>,
}

/** One admitted actor of the mixture, whether or not it plays any given technique. */
export interface RepertoireActor {
  id: string,
  canonicalName: string,
  entityType: ThreatEntityType,
  share: number,
}

export interface RepertoireTechniques {
  evidenceMode: OutcomeEvidenceMode,
  /** Every admitted actor, highest share first, so a technique can name the ones NOT playing it. */
  actors: Array<RepertoireActor>,
  /** Highest weight first, the order `computeScenarioTechniqueWeights` emits. */
  techniques: Array<RepertoireTechnique>,
  /**
   * Curated on the outcome and played by no admitted actor. Counted rather than listed: they enter
   * neither the attack run engine nor the weights.
   */
  unplayedCuratedCount: number,
}

/**
 * The technique set the attack run engine walks: every admitted actor's whole observed repertoire,
 * since the engine builds its universe from those same repertoires and a reading restricted to the
 * outcome's curated list would hide the techniques the run actually priced.
 *
 * The inferred gate (`selectInferredCandidates`) is deliberately not applied: it exists to keep the
 * outcome page short, and a corroboration threshold here would drop priced techniques.
 */
export const buildRepertoireTechniques = (params: {
  curated: Array<CuratedTechnique>,
  mixture: AttackerMixture,
  weights: Array<TechniqueWeight>,
  catalogByExternalId: Map<string, CatalogTechnique>,
  /** Tactic name and ATT&CK order per PARENT technique external id. */
  tacticsByExternalId: ReadonlyMap<string, Array<{ name: string, order: number }>>,
}): RepertoireTechniques => {
  const playedParentIds = new Set(params.weights.map((weight) => weight.mitreExternalId));
  const techniques = params.weights.flatMap((weight) => {
    const technique = params.catalogByExternalId.get(weight.mitreExternalId);
    if (!technique) {
      return [];
    }
    const tactics = [...(params.tacticsByExternalId.get(weight.mitreExternalId) ?? [])]
      .sort((first, second) => first.order - second.order);
    return [{
      mitreTechniqueId: technique.mitreTechniqueId,
      externalId: technique.externalId,
      name: technique.name,
      revoked: technique.revoked,
      weight: weight.weight,
      threats: toThreats(weight),
      sourceCount: weight.contributions.length,
      tacticNames: tactics.map((tactic) => tactic.name),
    }];
  });
  return {
    evidenceMode: 'attacker-mixture',
    actors: [...params.mixture.groups]
      .sort((first, second) => second.share - first.share)
      .map((group) => ({ id: group.groupKey, canonicalName: group.name, entityType: group.entityType, share: group.share })),
    techniques,
    unplayedCuratedCount: dedupeCuratedByParent(params.curated)
      .filter((technique) => !playedParentIds.has(foldToParentTechnique(technique.externalId)))
      .length,
  };
};

export const buildNoRepertoireResult = (curated: Array<CuratedTechnique>, evidenceMode: CuratedFallbackMode): RepertoireTechniques => ({
  evidenceMode,
  actors: [],
  techniques: [],
  unplayedCuratedCount: dedupeCuratedByParent(curated).length,
});

export const buildPendingRepertoireTechniques = (): RepertoireTechniques => ({
  evidenceMode: 'mixture-pending',
  actors: [],
  techniques: [],
  unplayedCuratedCount: 0,
});
