import type { AnchorProvenance } from '../threat-analyses/activity-scoring';
import type { ThreatEntityType } from '../threat-analyses/entity-types';
import type { AttackerMixture, MixtureGroup, TechniqueLink } from '../threat-analyses/technique-weighting';

/** One (organization, attack outcome) pair of a tenant: the key of a stored mixture. */
export interface MixturePair {
  organizationId: string,
  attackOutcomeId: string,
}

/** A pair carrying a risk scenario, with the targeting profile of its organization. */
export interface ScenarioMixturePair extends MixturePair {
  countryId: string | null,
  sectorId: string | null,
}

export const mixturePairKey = (pair: MixturePair): string => `${pair.organizationId}/${pair.attackOutcomeId}`;

export interface StoredMixtureRow extends MixturePair {
  tenantId: string,
  computedAt: Date,
  denominator: number,
}

export interface StoredMixtureGroupRow extends MixturePair {
  tenantId: string,
  /** Index of the group in `AttackerMixture.groups`: the sums downstream depend on that order. */
  position: number,
  groupKey: string,
  name: string,
  entityType: ThreatEntityType,
  mitreGroupId: string | null,
  share: number,
  theta: number,
  rho: number,
  tau: number,
  anchorProvenance: AnchorProvenance,
  lastActivityAt: Date | null,
  countryMatch: boolean,
  sectorMatch: boolean,
  memberGroupKeys: Array<string>,
  dedupedStixIds: Array<string>,
  techniqueExternalIds: Array<string>,
}

/** The parent row and the group rows of one pair, as the repository writes and reads them. */
export interface StoredMixtureRows {
  mixture: StoredMixtureRow,
  groups: Array<StoredMixtureGroupRow>,
}

/**
 * The instant the actors' activity decays against: the start of the UTC day, so two runs of one day
 * over unchanged inputs are the same run. The price job is booked daily for what this holds back.
 */
export const mixtureClockOf = (instant: Date): Date => new Date(`${instant.toISOString().slice(0, 10)}T00:00:00.000Z`);

const copyDate = (date: Date | null): Date | null => (date === null ? null : new Date(date.getTime()));

export const mixtureToRows = (
  tenantId: string,
  pair: MixturePair,
  computedAt: Date,
  mixture: AttackerMixture,
): StoredMixtureRows => ({
  mixture: {
    tenantId,
    organizationId: pair.organizationId,
    attackOutcomeId: pair.attackOutcomeId,
    computedAt: new Date(computedAt.getTime()),
    denominator: mixture.denominator,
  },
  groups: mixture.groups.map((group, position) => ({
    tenantId,
    organizationId: pair.organizationId,
    attackOutcomeId: pair.attackOutcomeId,
    position,
    groupKey: group.groupKey,
    name: group.name,
    entityType: group.entityType,
    mitreGroupId: group.mitreGroupId,
    share: group.share,
    theta: group.theta,
    rho: group.rho,
    tau: group.tau,
    anchorProvenance: group.anchorProvenance,
    lastActivityAt: copyDate(group.lastActivityAt),
    countryMatch: group.countryMatch,
    sectorMatch: group.sectorMatch,
    memberGroupKeys: [...group.memberGroupKeys],
    dedupedStixIds: [...group.dedupedStixIds],
    techniqueExternalIds: [...group.techniqueExternalIds],
  })),
});

export const mixtureFromRows = (rows: StoredMixtureRows): AttackerMixture => ({
  groups: [...rows.groups]
    .sort((first, second) => first.position - second.position)
    .map((row): MixtureGroup => ({
      groupKey: row.groupKey,
      name: row.name,
      entityType: row.entityType,
      mitreGroupId: row.mitreGroupId,
      share: row.share,
      theta: row.theta,
      rho: row.rho,
      tau: row.tau,
      anchorProvenance: row.anchorProvenance,
      lastActivityAt: copyDate(row.lastActivityAt),
      countryMatch: row.countryMatch,
      sectorMatch: row.sectorMatch,
      memberGroupKeys: [...row.memberGroupKeys],
      dedupedStixIds: [...row.dedupedStixIds],
      techniqueExternalIds: [...row.techniqueExternalIds],
    })),
  denominator: rows.mixture.denominator,
});

/**
 * One link per technique of each cluster's folded repertoire, keyed by the cluster's own key.
 * `computeScenarioTechniqueWeights` resolves a link to its cluster through `memberGroupKeys`, so
 * these links give the weights the per-member links of the evidence read give.
 */
export const linksOfMixture = (mixture: AttackerMixture): Array<TechniqueLink> =>
  mixture.groups.flatMap((group) =>
    group.techniqueExternalIds.map((mitreExternalId) => ({ groupKey: group.groupKey, mitreExternalId })));

const sameField = (stored: unknown, computed: unknown): boolean => {
  if (Array.isArray(stored) && Array.isArray(computed)) {
    return stored.length === computed.length && stored.every((value, index) => value === computed[index]);
  }
  if (stored instanceof Date && computed instanceof Date) {
    return stored.getTime() === computed.getTime();
  }
  return stored === computed;
};

// Every key of the computed row is compared, so a field the mixture gains is compared without being
// listed here, and a stored row missing it reads as changed.
const sameRow = (stored: object, computed: object): boolean =>
  Object.entries(computed).every(([key, value]) => sameField(Reflect.get(stored, key), value));

/**
 * Strict equality, not a tolerance: a share one ulp off is a different mixture, and the write that
 * replaces it is what wakes the readers of the table.
 */
export const sameStoredMixture = (stored: StoredMixtureRows, computed: StoredMixtureRows): boolean => {
  if (!sameRow(stored.mixture, computed.mixture) || stored.groups.length !== computed.groups.length) {
    return false;
  }
  const byPosition = (first: StoredMixtureGroupRow, second: StoredMixtureGroupRow): number => first.position - second.position;
  const storedGroups = [...stored.groups].sort(byPosition);
  const computedGroups = [...computed.groups].sort(byPosition);
  return storedGroups.every((group, index) => sameRow(group, computedGroups[index]));
};
