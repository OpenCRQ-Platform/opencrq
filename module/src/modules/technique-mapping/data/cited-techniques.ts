import { mitreTechniquesData } from '../../mitre-attack/data/mitre-techniques';
import { TOPOLOGY_RULE_TECHNIQUE_EXTERNAL_IDS } from '../topology-rule';
import { CURATED_TECHNIQUE_MAPPINGS, MAPPING_ROLES } from './curated-technique-mappings';

/** Every ATT&CK external id the vendored table and the topology rule name, whichever role. */
export const CITED_TECHNIQUE_EXTERNAL_IDS: ReadonlyArray<string> = [...new Set([
  ...Object.values(CURATED_TECHNIQUE_MAPPINGS).flatMap((byRole) => MAPPING_ROLES.flatMap((role) => [...byRole[role]])),
  ...TOPOLOGY_RULE_TECHNIQUE_EXTERNAL_IDS,
])].sort();

const CATALOGUE_BY_EXTERNAL_ID = new Map(mitreTechniquesData.map((technique) => [technique.externalId, technique]));

/**
 * The external ids cited that the product's technique catalogue does not carry.
 * The co-located test asserts this is empty: a table naming a technique the catalogue lacks writes
 * a dangling identifier onto every finding it resolves, and the finding then joins to no control at
 * all while still looking mapped.
 */
export const UNRESOLVED_TECHNIQUE_EXTERNAL_IDS: ReadonlyArray<string> = CITED_TECHNIQUE_EXTERNAL_IDS
  .filter((externalId) => !CATALOGUE_BY_EXTERNAL_ID.has(externalId));

/**
 * The external ids the catalogue carries but has retired. Asserted empty for the same reason: the
 * generator rewrites retirements against the ATT&CK release the catalogue was built from, so a
 * non-empty list here means the two releases have drifted apart and the tables need regenerating.
 */
export const RETIRED_TECHNIQUE_EXTERNAL_IDS: ReadonlyArray<string> = CITED_TECHNIQUE_EXTERNAL_IDS
  .filter((externalId) => CATALOGUE_BY_EXTERNAL_ID.get(externalId)?.revoked === true);
