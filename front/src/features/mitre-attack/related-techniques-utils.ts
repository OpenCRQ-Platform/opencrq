import { searchCatalogue } from './catalogue-search-utils';

export interface RelatedTechnique {
  id: string,
  externalId: string,
  name: string,
  revoked: boolean,
  isSubtechnique?: boolean,
}

export const TECHNIQUE_GRAIN_FILTERS = ['all', 'technique', 'sub-technique'] as const;
export type TechniqueGrainFilter = typeof TECHNIQUE_GRAIN_FILTERS[number];

export const isTechniqueGrainFilter = (value: string): value is TechniqueGrainFilter =>
  (TECHNIQUE_GRAIN_FILTERS as ReadonlyArray<string>).includes(value);

export interface RelatedTechniquesFilters {
  search: string,
  grain: TechniqueGrainFilter,
}

const matchesGrain = (technique: RelatedTechnique, grain: TechniqueGrainFilter): boolean => {
  if (grain === 'all') {
    return true;
  }
  return grain === 'sub-technique' ? technique.isSubtechnique === true : technique.isSubtechnique !== true;
};

/**
 * The rows a tactic's or a mitigation's technique table shows. Both grains live in one table, so
 * the grain filter is what separates them on demand.
 */
export const filterRelatedTechniques = (
  techniques: ReadonlyArray<RelatedTechnique>,
  { search, grain }: RelatedTechniquesFilters,
): Array<RelatedTechnique> => searchCatalogue(techniques.filter((technique) => matchesGrain(technique, grain)), search);
