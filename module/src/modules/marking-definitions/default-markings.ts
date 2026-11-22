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

/** A tenant's default marking rows, keyed by an id derived from the tenant and the STIX id so a rerun converges. */
export const buildDefaultMarkingRows = (tenantId: string): Array<typeof markingDefinitions.$inferInsert> =>
  DEFAULT_MARKINGS.map((seed) => {
    const stixId = markingStixId(seed.definitionType, seed.definition);
    return { id: deriveSeedId(stixId, tenantId), tenantId, stixId, ...seed };
  });
