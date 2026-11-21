import { defineService } from '../../registry';
import { globalSearchRepository } from './repository';

/** Results per entity type: the header shows a first page of each, the entity's own list the rest. */
export const GLOBAL_SEARCH_LIMIT_PER_TYPE = 10;

/** The first matches of one entity type and how many match in all, so the page never shows the cap as the count. */
const page = async <T>(hits: Promise<Array<T>>, total: Promise<number>) => {
  const [rows, all] = await Promise.all([hits, total]);
  return { hits: rows, total: Math.max(all, rows.length) };
};

export const globalSearchService = defineService(
  'globalSearch',
  globalSearchRepository,
).implement({
  search: async ({ repo }, search: string) => {
    const limit = GLOBAL_SEARCH_LIMIT_PER_TYPE;
    const [riskScenarios, primaryAssets, supportingAssets, threats, organizations, controls] = await Promise.all([
      page(repo.findRiskScenarios(search, limit), repo.countRiskScenarios(search)),
      page(repo.findPrimaryAssets(search, limit), repo.countPrimaryAssets(search)),
      page(repo.findSupportingAssets(search, limit), repo.countSupportingAssets(search)),
      page(repo.findThreats(search, limit), repo.countThreats(search)),
      page(repo.findOrganizations(search, limit), repo.countOrganizations(search)),
      page(repo.findControlCapabilities(search, limit), repo.countControlCapabilities(search)),
    ]);
    return { riskScenarios, primaryAssets, supportingAssets, threats, organizations, controls };
  },
});
