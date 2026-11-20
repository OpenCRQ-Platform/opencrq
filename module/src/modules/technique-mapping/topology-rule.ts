import type { SupportingAssetExposure } from '../supporting-assets/schema';
import { readCvssAccess } from '../cve/cvss-vector';

/** A weakness that is itself the way in: the attacker logs in with what the flaw hands over. */
const WAY_IN_WEAKNESSES: ReadonlyMap<string, string> = new Map([['CWE-798', 'T1078.001']]);

const VALID_ACCOUNTS = 'T1078';

const clientExecution = (exposure: SupportingAssetExposure): Array<string> => [
  'T1189',
  'T1566',
  ...(exposure === 'internet_facing' ? [] : ['T1534']),
  'T1203',
];

const networkService = (exposure: SupportingAssetExposure): Array<string> => [
  ...(exposure === 'internal' ? [] : ['T1190']),
  ...(exposure === 'internet_facing' ? [] : ['T1210']),
];

export interface TopologyRuleInput {
  readonly cvssVector: string | null,
  readonly cvssV2UserInteractionRequired: boolean | null,
  readonly cwe: ReadonlyArray<string> | null,
  readonly exposure: SupportingAssetExposure,
}

/** What the rule read, so a reader can tell which line of it produced the techniques. */
export type TopologyReading =
  | { readonly kind: 'weakness', readonly cwe: string }
  | {
    readonly kind: 'vector',
    readonly attackVector: string,
    readonly userInteraction: string,
    readonly privilegesRequired: string,
    readonly exposure: SupportingAssetExposure,
  };

export interface TopologyExploitation {
  /** In the order the attack runs them, alternatives side by side. */
  readonly techniqueExternalIds: ReadonlyArray<string>,
  readonly reading: TopologyReading,
}

/**
 * How a CVE outside the curated corpus is exploited on one asset, from where the flaw is reached
 * and what the attacker needs to reach it.
 *
 * An unknown exposure answers both the internet-facing and the internal reading, since either may
 * be the asset's. Null when the vector is absent or not a base vector the product reads, which is not
 * the same claim as a vector that leads nowhere.
 */
export const readTopologyExploitation = (
  { cvssVector, cvssV2UserInteractionRequired, cwe, exposure }: TopologyRuleInput,
): TopologyExploitation | null => {
  for (const weakness of cwe ?? []) {
    const technique = WAY_IN_WEAKNESSES.get(weakness);
    if (technique !== undefined) {
      return { techniqueExternalIds: [technique], reading: { kind: 'weakness', cwe: weakness } };
    }
  }

  const access = readCvssAccess(cvssVector, cvssV2UserInteractionRequired);
  if (access === null) {
    return null;
  }
  const { attackVector, userInteraction, privilegesRequired } = access;
  // CVSS 4.0 splits a required interaction into passive and active, and both need a user to act.
  const needsUser = userInteraction !== 'N';
  const signedIn = privilegesRequired === 'N' ? [] : [VALID_ACCOUNTS];

  const byVector = (): Array<string> => {
    switch (attackVector) {
      case 'N': return needsUser ? clientExecution(exposure) : networkService(exposure);
      case 'A': return ['T1210'];
      case 'L': return needsUser ? ['T1204.002', 'T1203'] : ['T1068'];
      case 'P': return ['T1200', 'T1091'];
      default: return [];
    }
  };
  const vectorTechniques = byVector();
  if (vectorTechniques.length === 0) {
    return null;
  }
  return {
    techniqueExternalIds: [...signedIn, ...vectorTechniques],
    reading: { kind: 'vector', attackVector, userInteraction, privilegesRequired, exposure },
  };
};

/** Every technique the rule can name, so the catalogue lookups and the table tests cover them all. */
export const TOPOLOGY_RULE_TECHNIQUE_EXTERNAL_IDS: ReadonlyArray<string> = [...new Set([
  ...WAY_IN_WEAKNESSES.values(),
  VALID_ACCOUNTS,
  ...clientExecution('unknown'),
  ...networkService('unknown'),
  'T1210',
  'T1204.002',
  'T1203',
  'T1068',
  'T1200',
  'T1091',
])].sort();
