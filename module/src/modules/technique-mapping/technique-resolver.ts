import type { MappingRole, TechniquesByRole } from './data/curated-technique-mappings';
import type { MappingLane } from './constants';
import { CURATED_TECHNIQUE_MAPPINGS, MAPPING_ROLES } from './data';

/** A mapping a connector states on the finding itself, rather than one resolved from the tables. */
export interface SuppliedTechnique {
  readonly techniqueExternalId: string,
  readonly role?: MappingRole | null,
}

export interface ResolvedTechnique {
  readonly techniqueExternalId: string,
  readonly role: MappingRole,
  readonly lane: MappingLane,
}

export interface TechniqueResolverInput {
  readonly cveId: string,
  readonly supplied?: ReadonlyArray<SuppliedTechnique>,
}

export interface ResolverTables {
  readonly curated: Readonly<Record<string, TechniquesByRole>>,
}

export const VENDORED_RESOLVER_TABLES: ResolverTables = {
  curated: CURATED_TECHNIQUE_MAPPINGS,
};

const DEFAULT_SUPPLIED_ROLE: MappingRole = 'exploitation_technique';

const LANE_STRENGTH: Readonly<Record<MappingLane, number>> = {
  supplied: 0,
  curated: 1,
  structural: 2,
};

const rowsFromTechniquesByRole = (techniques: TechniquesByRole, lane: MappingLane): Array<ResolvedTechnique> =>
  MAPPING_ROLES.flatMap((role) => techniques[role].map((techniqueExternalId) => ({ techniqueExternalId, role, lane })));

export const resolveSuppliedLane = (supplied: ReadonlyArray<SuppliedTechnique>): Array<ResolvedTechnique> =>
  supplied.map(({ techniqueExternalId, role }) => ({
    techniqueExternalId,
    role: role ?? DEFAULT_SUPPLIED_ROLE,
    lane: 'supplied' as const,
  }));

export const resolveCuratedLane = (
  cveId: string,
  table: Readonly<Record<string, TechniquesByRole>>,
): Array<ResolvedTechnique> => {
  const entry = table[cveId];
  return entry === undefined ? [] : rowsFromTechniquesByRole(entry, 'curated');
};

/**
 * One claim per technique and role, the strongest lane's. Generic because the stored claims and
 * the weakness link read at display time meet here too.
 */
export const keepStrongestLane = <T extends { techniqueExternalId: string, role: MappingRole, lane: MappingLane }>(
  rows: ReadonlyArray<T>,
): Array<T> => {
  const strongestByPair = new Map<string, T>();
  for (const row of rows) {
    const pair = `${row.techniqueExternalId}|${row.role}`;
    const kept = strongestByPair.get(pair);
    if (kept === undefined || LANE_STRENGTH[row.lane] < LANE_STRENGTH[kept.lane]) {
      strongestByPair.set(pair, row);
    }
  }
  return [...strongestByPair.values()];
};

const inPublishedOrder = (rows: Array<ResolvedTechnique>): Array<ResolvedTechnique> => rows.sort((left, right) => {
  const byRole = MAPPING_ROLES.indexOf(left.role) - MAPPING_ROLES.indexOf(right.role);
  if (byRole !== 0) {
    return byRole;
  }
  if (left.techniqueExternalId === right.techniqueExternalId) {
    return 0;
  }
  return left.techniqueExternalId < right.techniqueExternalId ? -1 : 1;
});

export const resolveTechniquesWith = (
  input: TechniqueResolverInput,
  tables: ResolverTables,
): Array<ResolvedTechnique> => {
  const supplied = input.supplied ?? [];
  if (supplied.length > 0) {
    return inPublishedOrder(keepStrongestLane(resolveSuppliedLane(supplied)));
  }
  return inPublishedOrder(keepStrongestLane(resolveCuratedLane(input.cveId, tables.curated)));
};

/**
 * Pure: no database, no network, no model. Grain and the catalogue row belong to the caller, the
 * only side that knows the product's technique catalogue.
 */
export const resolveTechniques = (input: TechniqueResolverInput): Array<ResolvedTechnique> =>
  resolveTechniquesWith(input, VENDORED_RESOLVER_TABLES);
