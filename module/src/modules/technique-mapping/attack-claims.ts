import type { SupportingAssetExposure } from '../supporting-assets/schema';
import type { MappingRole } from './data/curated-technique-mappings';
import type { AttackGroup, MappingConfidence, MappingLane, TechniqueClaimLane, TechniqueGrain } from './constants';
import type { TopologyReading } from './topology-rule';
import { ATTACK_GROUP_VALUES, MAPPING_LANE_CONFIDENCE, strongerConfidence } from './constants';
import { readTopologyExploitation } from './topology-rule';

export interface StoredTechniqueClaim {
  readonly mitreTechniqueId: string,
  readonly techniqueExternalId: string,
  readonly techniqueName: string,
  readonly role: MappingRole,
  readonly lane: MappingLane,
  readonly grain: TechniqueGrain,
  /** The CVE's weaknesses whose link names the technique, on a claim read from the weakness link. */
  readonly weaknesses?: ReadonlyArray<string>,
}

export interface CatalogueTechnique {
  readonly id: string,
  readonly externalId: string,
  readonly name: string,
  readonly isSubtechnique: boolean,
}

export type ClaimJustification =
  | { readonly kind: 'supplied' }
  | { readonly kind: 'curated' }
  | { readonly kind: 'topology', readonly reading: TopologyReading }
  /** The CVE's own weakness classes that lead to the technique. */
  | { readonly kind: 'weakness', readonly cwe: Array<string> };

export interface AttackClaim {
  readonly mitreTechniqueId: string,
  readonly techniqueExternalId: string,
  readonly techniqueName: string,
  readonly role: MappingRole,
  readonly lane: TechniqueClaimLane,
  readonly grain: TechniqueGrain,
  readonly group: AttackGroup,
  readonly justification: ClaimJustification,
}

export interface AttackClaimsInput {
  readonly stored: ReadonlyArray<StoredTechniqueClaim>,
  readonly cwe: ReadonlyArray<string> | null,
  readonly cvssVector: string | null,
  readonly cvssV2UserInteractionRequired: boolean | null,
  readonly exposure: SupportingAssetExposure,
  /** The catalogue rows of the techniques the topology rule can name, keyed by external id. */
  readonly ruleCatalogue: ReadonlyMap<string, CatalogueTechnique>,
}

const GROUP_OF_ROLE: Readonly<Record<MappingRole, AttackGroup>> = {
  exploitation_technique: 'exploitation',
  primary_impact: 'primary_impact',
  secondary_impact: 'secondary_impact',
};

const namesExploitation = (stored: ReadonlyArray<{ role: MappingRole, lane: MappingLane }>): boolean =>
  stored.some((claim) => claim.role === 'exploitation_technique' && claim.lane !== 'structural');

const fromStored = (claim: StoredTechniqueClaim): AttackClaim => {
  const { mitreTechniqueId, techniqueExternalId, techniqueName, role, lane, grain } = claim;
  const shared = { mitreTechniqueId, techniqueExternalId, techniqueName, role, lane, grain };
  switch (lane) {
    case 'structural':
      return { ...shared, group: 'weakness', justification: { kind: 'weakness', cwe: [...(claim.weaknesses ?? [])] } };
    case 'supplied':
    case 'curated':
      return { ...shared, group: GROUP_OF_ROLE[role], justification: { kind: lane } };
  }
};

/**
 * The topology rule answers the exploitation whenever no claim naming this CVE does. It reads the
 * asset, so it is never stored: two findings on one CVE may be reached two different ways. A rule
 * technique the catalogue lacks is dropped rather than left dangling.
 */
export const readAttackClaims = ({ stored, ruleCatalogue, ...cve }: AttackClaimsInput): Array<AttackClaim> => {
  const claims = stored.map(fromStored);
  const rule = namesExploitation(stored) ? null : readTopologyExploitation(cve);
  const ruleClaims = (rule?.techniqueExternalIds ?? []).flatMap((externalId): Array<AttackClaim> => {
    const technique = ruleCatalogue.get(externalId);
    return technique === undefined ? [] : [{
      mitreTechniqueId: technique.id,
      techniqueExternalId: technique.externalId,
      techniqueName: technique.name,
      role: 'exploitation_technique',
      lane: 'topology',
      grain: technique.isSubtechnique ? 'sub_technique' : 'parent',
      group: 'exploitation',
      justification: { kind: 'topology', reading: rule!.reading },
    }];
  });
  const byGroupThenId = (left: AttackClaim, right: AttackClaim): number =>
    ATTACK_GROUP_VALUES.indexOf(left.group) - ATTACK_GROUP_VALUES.indexOf(right.group)
    || left.techniqueExternalId.localeCompare(right.techniqueExternalId);
  return [...ruleClaims, ...claims.sort(byGroupThenId)];
};

const strongestClaimOf = (
  claims: ReadonlyArray<AttackClaim>,
  groups: ReadonlyArray<AttackGroup>,
): Map<string, MappingConfidence> => {
  const inReach = new Map<string, MappingConfidence>();
  for (const claim of claims) {
    if (!groups.includes(claim.group)) {
      continue;
    }
    const claimed = MAPPING_LANE_CONFIDENCE[claim.lane];
    const known = inReach.get(claim.mitreTechniqueId);
    inReach.set(claim.mitreTechniqueId, known === undefined ? claimed : strongerConfidence(known, claimed));
  }
  return inReach;
};

/**
 * How the flaw is exploited, and nothing else: the weakness link names no role, and most of its
 * rows are what the flaw yields once exploited, so it sits on the impact side.
 */
export const techniquesInReachOf = (claims: ReadonlyArray<AttackClaim>): Map<string, MappingConfidence> =>
  strongestClaimOf(claims, ['exploitation']);

/** What follows the breach: both impact groups and everything the weakness makes possible. */
export const impactTechniquesOf = (claims: ReadonlyArray<AttackClaim>): Map<string, MappingConfidence> =>
  strongestClaimOf(claims, ['primary_impact', 'secondary_impact', 'weakness']);

/**
 * The techniques a CVE opens for the campaign engine, by external id, for a reader that holds no
 * catalogue rows: its exploitation claims and its weakness link together.
 */
export const techniqueExternalIdsInReach = (
  { stored, ...cve }: Omit<AttackClaimsInput, 'stored' | 'ruleCatalogue'> & {
    stored: ReadonlyArray<{ techniqueExternalId: string, role: MappingRole, lane: MappingLane }>,
  },
): Array<string> => {
  const rule = namesExploitation(stored) ? null : readTopologyExploitation(cve);
  return [...new Set([
    ...(rule?.techniqueExternalIds ?? []),
    ...stored.filter((claim) => claim.role === 'exploitation_technique').map((claim) => claim.techniqueExternalId),
  ])];
};
