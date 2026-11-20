import { compareCodePoints, newError } from '@app/utils';
import type { ActivityAnchor, AnchorProvenance } from './activity-scoring';
import type { ThreatEntityType } from './entity-types';
import { computeTau } from './outcome-counter/outcome-weight';

/**
 * Attacker-mixture weighting of MITRE techniques for a risk scenario.
 *
 * ```
 * rho_g    = 2^(-ageDays / halfLife)                     // half-life split by anchor grade, no floor
 * tau_g    = 2.5^countryMatch * 4^sectorMatch            // in {1, 2.5, 4, 10}
 * theta_g  = rho_g * tau_g * weight_g                     // weight_g in [0, 1]: how likely g's threat is to lead to the outcome
 * D        = SUM theta_h
 * pi_g     = theta_g / D
 * weight_p = min(SUM over the clusters using p of pi_g, 1)   // in [0, 1]
 * ```
 *
 * The shares are a distribution over the clusters the catalogue could name, so a technique used by
 * every admitted cluster reaches 1, up to float accumulation error.
 *
 * Every function is pure and deterministic: `now` is injected, no clock, no I/O, and every
 * ordering tie-break compares code points rather than going through the host's ICU locale, so the
 * emitted order (and with it the last ulp of an accumulated weight) is reproducible across hosts.
 *
 * Clone invariance, stated exactly: re-ingesting an actor as a strictly weaker duplicate (a row
 * whose theta stays at or below the cluster representative's) leaves every share bit-identical,
 * whatever that row's targeting flags are. A duplicate carrying stronger evidence (fresher anchor,
 * better targeting) does raise the cluster theta and therefore moves the shares: `theta_cluster` is
 * the max over members, so the best evidence on file wins rather than being diluted. Only the
 * sum-over-members reading, which the design rejects, would be moved by an ingestion count.
 *
 * The returned payload never aliases a mutable input: dates and arrays are copied on the way out.
 */

/**
 * Activity of a group whose anchors carry no date at all. Per the locked decision this is a plain
 * constant, calibrated once against the 365-day authored default (three of those half-lives), and it
 * is deliberately NOT derived from the tenant-tunable `act_half_life_authored_days` PR 3 introduces:
 * an undated group must keep the same floor whatever the tenant sets.
 */
export const NULL_ANCHOR_RHO = 0.125;

export const DEFAULT_ACT_HALF_LIFE_OBSERVED_DAYS = 180;
export const DEFAULT_ACT_HALF_LIFE_AUTHORED_DAYS = 365;

/**
 * Shorter normalized labels are ignored as cluster keys: STIX alias arrays carry two-letter tags
 * and other generic strings that would merge unrelated actors.
 */
const MIN_CLUSTER_LABEL_LENGTH = 3;

const MS_PER_DAY = 86_400_000;

export interface MixtureGroupInput {
  /** Stable identity of the ingested group, typically its analysis id. */
  groupKey: string,
  name: string,
  entityType: ThreatEntityType,
  aliases: Array<string>,
  mitreGroupId: string | null,
  stixId: string | null,
  /** Graded temporal anchor: an undated anchor drives `rho` to `NULL_ANCHOR_RHO`. */
  anchor: ActivityAnchor,
  countryMatch: boolean,
  sectorMatch: boolean,
  /** How likely the group's threat is to lead to the outcome, in [0, 1]: scales theta, 0 drops the group from the shares. */
  weight: number,
  /** Ingested repertoire, sub-techniques allowed (folded to their parent here). */
  techniqueExternalIds: Array<string>,
}

export interface MixtureGroup {
  /** Identity of the cluster representative, that is the member carrying the highest theta, the lowest key on a tie. */
  groupKey: string,
  /**
   * Display name of the cluster: the first member in group-key order carrying a MITRE group id,
   * else the first member. Deliberately independent of the theta-max representative, so a fresher
   * alias row cannot rename the cluster by outweighing it.
   */
  name: string,
  /** Type of the member `name` comes from. */
  entityType: ThreatEntityType,
  /**
   * Normalized MITRE group id of the cluster: the first member in group-key order carrying one, null
   * when no member does. Same member as `name`, so the pair always deep-links consistently.
   */
  mitreGroupId: string | null,
  share: number,
  theta: number,
  rho: number,
  tau: number,
  anchorProvenance: AnchorProvenance,
  lastActivityAt: Date | null,
  countryMatch: boolean,
  sectorMatch: boolean,
  /** Every input group folded into this cluster, representative included. */
  memberGroupKeys: Array<string>,
  /**
   * STIX ids of the cluster members, in member order, each appearing once: two ingested rows can
   * carry the same STIX id under distinct group keys, and the cluster folds them into one entry.
   */
  dedupedStixIds: Array<string>,
  /**
   * Full ingested repertoire of the cluster: the union of the members' techniques folded to their
   * parent, never filtered by outcome. This is `playbook(g)`, the input PR 5's group-conditional
   * engine must use. It is deliberately NOT the same set as the `links` handed to
   * `computeScenarioTechniqueWeights`, which may be an outcome-filtered subset: the published
   * weight is a property of the links, the playbook is a property of the actor.
   */
  techniqueExternalIds: Array<string>,
}

export interface AttackerMixture {
  groups: Array<MixtureGroup>,
  denominator: number,
}

/**
 * One ingested group-to-technique edge. The caller decides which edges to pass: the whole ingested
 * repertoire, or the outcome-filtered subset. Whatever it passes defines the published weight,
 * while `MixtureGroup.techniqueExternalIds` always keeps the unfiltered repertoire.
 */
export interface TechniqueLink {
  /** Input group key, resolved to its cluster here. */
  groupKey: string,
  mitreExternalId: string,
}

/** One contributing cluster of a technique weight. Non-using clusters are not emitted. */
export interface TechniqueContribution {
  groupKey: string,
  name: string,
  entityType: ThreatEntityType,
  /** Cluster-normalized MITRE group id, null when no member carries one. Deep-link key for PR 7. */
  mitreGroupId: string | null,
  share: number,
  rho: number,
  tau: number,
  anchorProvenance: AnchorProvenance,
  lastActivityAt: Date | null,
  dedupedStixIds: Array<string>,
}

export interface TechniqueWeight {
  /** Parent technique id: sub-technique links are folded before weighting. */
  mitreExternalId: string,
  /**
   * Sum of the contributed shares, clamped to 1: reaching it up to float accumulation error when
   * every admitted cluster uses the technique.
   */
  weight: number,
  /**
   * Contributing clusters only. Their shares sum exactly to `weight`, except when the clamp binds
   * (float accumulation over many clusters can overshoot 1 by a few ulp), in which case `weight` is
   * 1 and the sum sits a few ulp above it.
   */
  contributions: Array<TechniqueContribution>,
}

export const foldToParentTechnique = (mitreExternalId: string): string =>
  mitreExternalId.trim().toUpperCase().split('.')[0];

// Aliases arrive as free-form STIX strings: "APT 41", "apt41" and "APT-41" are the same actor.
const normalizeLabel = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

// MITRE group ids are case- and whitespace-insensitive identities: "g1045 " is "G1045".
const normalizeMitreGroupId = (value: string): string => value.trim().toUpperCase();

const computeRho = (
  group: MixtureGroupInput,
  now: Date,
  halfLifeObservedDays: number,
  halfLifeAuthoredDays: number,
): number => {
  if (group.anchor.provenance === 'none') {
    return NULL_ANCHOR_RHO;
  }
  const halfLifeDays = group.anchor.provenance === 'observed' ? halfLifeObservedDays : halfLifeAuthoredDays;
  const ageDays = Math.max(0, (now.getTime() - group.anchor.date.getTime()) / MS_PER_DAY);
  return 2 ** (-ageDays / halfLifeDays);
};

/**
 * Transitive closure over the two identity signals: a shared normalized name or alias, and a shared
 * normalized MITRE group id. Returns one cluster (as input indices, ascending) per distinct actor,
 * ordered by their lowest member index.
 *
 * Repertoire overlap is deliberately not a signal: feeds inflate repertoires, so unrelated actors
 * overlap almost by construction and the closure chains hundreds of them into one.
 *
 * Known over-merge hazard: STIX alias arrays are free-form, so two unrelated actors sharing one
 * campaign or operation name collapse into a single cluster, which halves the group count and moves
 * every share. Labels shorter than `MIN_CLUSTER_LABEL_LENGTH` normalized characters are dropped as
 * the cheapest guard, but no stop-list of generic names is applied in V1. `memberGroupKeys` records
 * exactly what was folded so PR 7 can surface the merge for analyst review.
 */
const clusterGroups = (groups: Array<MixtureGroupInput>): Array<Array<number>> => {
  const parents = groups.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parents[root] !== root) {
      root = parents[root];
    }
    let cursor = index;
    while (parents[cursor] !== root) {
      const next = parents[cursor];
      parents[cursor] = root;
      cursor = next;
    }
    return root;
  };
  const union = (first: number, second: number): void => {
    const firstRoot = find(first);
    const secondRoot = find(second);
    if (firstRoot !== secondRoot) {
      parents[Math.max(firstRoot, secondRoot)] = Math.min(firstRoot, secondRoot);
    }
  };

  const firstIndexByLabel = new Map<string, number>();
  const firstIndexByMitreGroupId = new Map<string, number>();
  groups.forEach((group, index) => {
    const labels = [group.name, ...group.aliases]
      .map(normalizeLabel)
      .filter((label) => label.length >= MIN_CLUSTER_LABEL_LENGTH);
    for (const label of labels) {
      const seen = firstIndexByLabel.get(label);
      if (seen === undefined) {
        firstIndexByLabel.set(label, index);
      } else {
        union(seen, index);
      }
    }
    const mitreGroupId = group.mitreGroupId === null ? '' : normalizeMitreGroupId(group.mitreGroupId);
    if (mitreGroupId.length > 0) {
      const seen = firstIndexByMitreGroupId.get(mitreGroupId);
      if (seen === undefined) {
        firstIndexByMitreGroupId.set(mitreGroupId, index);
      } else {
        union(seen, index);
      }
    }
  });

  const membersByRoot = new Map<number, Array<number>>();
  groups.forEach((_, index) => {
    const root = find(index);
    const members = membersByRoot.get(root) ?? [];
    members.push(index);
    membersByRoot.set(root, members);
  });
  return [...membersByRoot.entries()].sort(([first], [second]) => first - second).map(([, members]) => members);
};

/**
 * Programming-error guard, not a domain validation: it fires on a value no caller should ever
 * build. Validating what a tenant may store is owned by the PR 3 settings boundary (zod input plus
 * a column CHECK constraint), so a stored value can never reach a CRQ run out of domain and turn
 * this throw into a run killer.
 */
const requireInRange = (value: number, bounds: { min: number, exclusiveMin: boolean, name: string }): void => {
  const belowMin = bounds.exclusiveMin ? value <= bounds.min : value < bounds.min;
  if (!Number.isFinite(value) || belowMin) {
    throw newError('Attacker mixture parameter is out of domain', {
      parameter: bounds.name,
      value,
      min: bounds.min,
      exclusiveMin: bounds.exclusiveMin,
    });
  }
};

/**
 * Normalizes the admitted relevant groups into a distribution over one attack event: a share per
 * deduplicated actor, summing to 1 over the groups the catalogue could name.
 *
 * `theta = rho * tau * weight`. `rho`, `tau`, `countryMatch`, `sectorMatch` and the anchor are read off the cluster's theta-max
 * representative rather than maximized over its members, so an alias row cannot move the shares on
 * its own. The accepted loss is that targeting evidence carried only by a non-representative member
 * is dropped, so an actor ingested twice (once fresh with no location or sector relationship, once
 * stale with both) is anchored at `tau = 1` instead of 10.
 *
 * The result depends on the set of `groups`, never on their order: members are taken in group-key
 * order, and the clusters come out in the order of their first member.
 *
 * Degenerate case: `D` is not strictly positive only when every admitted cluster has a theta of
 * exactly 0: underflowed by decades of staleness at any settable half-life, or a weight of 0. The clusters are still reported,
 * with a 0 share, rather than letting a NaN reach a consumer that cannot tell it from a real
 * distribution.
 */
export const computeAttackerMixture = (params: {
  groups: Array<MixtureGroupInput>,
  now: Date,
  halfLifeObservedDays?: number,
  halfLifeAuthoredDays?: number,
}): AttackerMixture => {
  const halfLifeObservedDays = params.halfLifeObservedDays ?? DEFAULT_ACT_HALF_LIFE_OBSERVED_DAYS;
  const halfLifeAuthoredDays = params.halfLifeAuthoredDays ?? DEFAULT_ACT_HALF_LIFE_AUTHORED_DAYS;
  requireInRange(halfLifeObservedDays, { min: 0, exclusiveMin: true, name: 'halfLifeObservedDays' });
  requireInRange(halfLifeAuthoredDays, { min: 0, exclusiveMin: true, name: 'halfLifeAuthoredDays' });
  // An `Invalid Date` would make every rho NaN and silently return an all-zero mixture, which is
  // indistinguishable downstream from a legitimate "no relevant threats" result. Fail loudly.
  if (!Number.isFinite(params.now.getTime())) {
    throw newError('Attacker mixture parameter is out of domain', {
      parameter: 'now',
      value: params.now.getTime(),
      min: Number.NEGATIVE_INFINITY,
      exclusiveMin: false,
    });
  }
  // Group keys index the cluster lookup `computeScenarioTechniqueWeights` resolves links against, so
  // a duplicate would silently attribute one group's links to another cluster.
  const distinctGroupKeys = new Set(params.groups.map((group) => group.groupKey));
  if (distinctGroupKeys.size !== params.groups.length) {
    throw newError('Attacker mixture groups carry duplicate group keys', {
      groupCount: params.groups.length,
      distinctGroupKeyCount: distinctGroupKeys.size,
    });
  }

  // The caller's order is a database row order, which moves without any data change.
  const admitted = [...params.groups].sort((first, second) => compareCodePoints(first.groupKey, second.groupKey));
  const playbooks = admitted.map((group) => new Set(
    group.techniqueExternalIds.map(foldToParentTechnique).filter((techniqueId) => techniqueId.length > 0),
  ));
  const rhos = admitted.map((group) => computeRho(group, params.now, halfLifeObservedDays, halfLifeAuthoredDays));
  const taus = admitted.map(computeTau);
  const thetas = admitted.map((group, index) => rhos[index] * taus[index] * group.weight);

  const clusters = clusterGroups(admitted);
  const merged = clusters.map((members) => {
    // Cluster theta is the max over members, never the sum: an actor ingested three times must not
    // outweigh an actor ingested once.
    const representative = members.reduce((best, member) => (thetas[member] > thetas[best] ? member : best), members[0]);
    const named = members.find((member) => {
      const mitreGroupId = admitted[member].mitreGroupId;
      return mitreGroupId !== null && normalizeMitreGroupId(mitreGroupId).length > 0;
    }) ?? members[0];
    const namedMitreGroupId = admitted[named].mitreGroupId;
    const normalizedMitreGroupId = namedMitreGroupId === null ? null : normalizeMitreGroupId(namedMitreGroupId);
    return {
      representative,
      members,
      theta: thetas[representative],
      rho: rhos[representative],
      tau: taus[representative],
      group: admitted[representative],
      name: admitted[named].name,
      entityType: admitted[named].entityType,
      mitreGroupId: normalizedMitreGroupId !== null && normalizedMitreGroupId.length > 0
        ? normalizedMitreGroupId
        : null,
    };
  });

  // Float addition depends on order, and the cluster order moves when an alias joins with a lower
  // key: summed by value, the denominator depends on the cluster thetas alone.
  const denominator = merged
    .map((cluster) => cluster.theta)
    .sort((first, second) => first - second)
    .reduce((total, theta) => total + theta, 0);
  const degenerate = !(denominator > 0) || !Number.isFinite(denominator);

  const groups = merged.map((cluster) => ({
    groupKey: cluster.group.groupKey,
    name: cluster.name,
    entityType: cluster.entityType,
    mitreGroupId: cluster.mitreGroupId,
    share: degenerate ? 0 : cluster.theta / denominator,
    theta: cluster.theta,
    rho: cluster.rho,
    tau: cluster.tau,
    anchorProvenance: cluster.group.anchor.provenance,
    lastActivityAt: cluster.group.anchor.date === null ? null : new Date(cluster.group.anchor.date.getTime()),
    countryMatch: cluster.group.countryMatch,
    sectorMatch: cluster.group.sectorMatch,
    memberGroupKeys: cluster.members.map((member) => admitted[member].groupKey),
    dedupedStixIds: [...new Set(cluster.members
      .map((member) => admitted[member].stixId)
      .filter((stixId): stixId is string => stixId !== null))],
    // Usage is the OR over members: an alias row contributing a technique the representative
    // lacks still counts, the actor is one and the same.
    techniqueExternalIds: [...new Set(cluster.members.flatMap((member) => [...playbooks[member]]))].sort(),
  }));

  return { groups, denominator };
};

/**
 * Weight per parent technique: the share of attacks whose actor is known to have the technique in
 * its repertoire. Links are keyed by input group key and resolved to their cluster, so alias rows
 * merge instead of accumulating. Techniques whose only links come from groups outside the mixture
 * are reported with a zero weight rather than dropped; links with an empty identifier are skipped.
 *
 * Caller contract: when the result feeds the group-conditional engine, `links` and
 * `MixtureGroup.techniqueExternalIds` must come from the same technique universe. That engine mixes
 * the two, iterating `playbook(g)` for the per-group term against the published `weight_t`, so
 * handing it outcome-filtered links against an unfiltered playbook computes the two halves of V
 * over inconsistent sets. Filter both or neither.
 */
export const computeScenarioTechniqueWeights = (params: {
  mixture: AttackerMixture,
  links: Array<TechniqueLink>,
}): Array<TechniqueWeight> => {
  const clusterIndexByGroupKey = new Map<string, number>();
  params.mixture.groups.forEach((group, index) => {
    for (const memberKey of group.memberGroupKeys) {
      clusterIndexByGroupKey.set(memberKey, index);
    }
  });

  const usersByTechnique = new Map<string, Set<number>>();
  for (const link of params.links) {
    const techniqueId = foldToParentTechnique(link.mitreExternalId);
    if (techniqueId.length === 0) {
      continue;
    }
    const users = usersByTechnique.get(techniqueId) ?? new Set<number>();
    const clusterIndex = clusterIndexByGroupKey.get(link.groupKey);
    if (clusterIndex !== undefined) {
      users.add(clusterIndex);
    }
    usersByTechnique.set(techniqueId, users);
  }

  return [...usersByTechnique.entries()]
    .map(([mitreExternalId, users]) => {
      const contributions = [...users]
        .map((index) => params.mixture.groups[index])
        .sort((first, second) => (second.share - first.share) || compareCodePoints(first.groupKey, second.groupKey))
        .map((group) => ({
          groupKey: group.groupKey,
          name: group.name,
          entityType: group.entityType,
          mitreGroupId: group.mitreGroupId,
          share: group.share,
          rho: group.rho,
          tau: group.tau,
          anchorProvenance: group.anchorProvenance,
          lastActivityAt: group.lastActivityAt === null ? null : new Date(group.lastActivityAt.getTime()),
          dedupedStixIds: [...group.dedupedStixIds],
        }));
      // Summed in the emitted order, then clamped: float accumulation over many clusters can
      // exceed 1 by a few ulp, and a weight is read as a probability downstream.
      const summed = contributions.reduce((total, contribution) => total + contribution.share, 0);
      return { mitreExternalId, weight: Math.min(summed, 1), contributions };
    })
    .sort((first, second) => (second.weight - first.weight) || compareCodePoints(first.mitreExternalId, second.mitreExternalId));
};
