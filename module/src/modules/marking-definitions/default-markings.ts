import type { markingDefinitions } from './schema';
import { deriveSeedId } from '../../seed-ids';
import { markingStixId } from './marking-stix-id';

interface MarkingSeed {
  readonly definitionType: string,
  readonly definition: string,
  readonly color: string,
  readonly order: number,
}

/**
 * The TLP 2.0 markings every tenant starts with, the set OpenAEV seeds a tenant with
 * (`PresetTenantData.createDefaultMarkings`) and OpenCTI ships, each under OpenCTI's static id.
 */
export const DEFAULT_MARKINGS: ReadonlyArray<MarkingSeed> = [
  { definitionType: 'TLP', definition: 'TLP:CLEAR', color: '#E6E7E8', order: 1 },
  { definitionType: 'TLP', definition: 'TLP:GREEN', color: '#4CAF50', order: 2 },
  { definitionType: 'TLP', definition: 'TLP:AMBER', color: '#FFB300', order: 3 },
  { definitionType: 'TLP', definition: 'TLP:AMBER+STRICT', color: '#FF8F00', order: 4 },
  { definitionType: 'TLP', definition: 'TLP:RED', color: '#E53935', order: 5 },
];

/** The PAP markings OpenCTI ships, with the rank it gives them. */
const PAP_MARKINGS: ReadonlyArray<{ readonly definition: string, readonly order: number }> = [
  { definition: 'PAP:CLEAR', order: 1 },
  { definition: 'PAP:GREEN', order: 2 },
  { definition: 'PAP:AMBER', order: 3 },
  { definition: 'PAP:RED', order: 4 },
];

const TLP_STIX_IDS: ReadonlySet<string> = new Set(DEFAULT_MARKINGS.map((seed) => markingStixId(seed.definitionType, seed.definition)));

const KNOWN_RANKS: ReadonlyMap<string, number> = new Map([
  ...DEFAULT_MARKINGS.map((seed): [string, number] => [markingStixId(seed.definitionType, seed.definition), seed.order]),
  ...PAP_MARKINGS.map(({ definition, order }): [string, number] => [markingStixId('PAP', definition), order]),
]);

/**
 * The rank OpenCTI gives a marking it ships (the TLP 2.0 and PAP markings), whatever a peer states:
 * a peer that omits or mis-states it must not move where the marking stands in a clearance.
 */
export const knownMarkingRank = (stixId: string): number | undefined => KNOWN_RANKS.get(stixId);

/** The default TLP markings, whose rank cannot be changed and which cannot be deleted, as in OpenAEV. */
export const isProtectedMarking = (stixId: string): boolean => TLP_STIX_IDS.has(stixId);

/** A tenant's default marking rows, keyed by an id derived from the tenant and the STIX id so a rerun converges. */
export const buildDefaultMarkingRows = (tenantId: string): Array<typeof markingDefinitions.$inferInsert> =>
  DEFAULT_MARKINGS.map((seed) => {
    const stixId = markingStixId(seed.definitionType, seed.definition);
    return { id: deriveSeedId(stixId, tenantId), tenantId, stixId, ...seed };
  });
