import { defineService } from '../../registry';
import { globalSearchRepository } from './repository';

/** Results per entity type: the header shows a first page of each, the entity's own list the rest. */
export const GLOBAL_SEARCH_LIMIT_PER_TYPE = 10;

export const globalSearchService = defineService(
  'globalSearch',
  globalSearchRepository,
).implement({
  search: async ({ repo }, search: string) => {
    const [riskScenarios, primaryAssets, supportingAssets, threats, organizations, controls] = await Promise.all([
      repo.findRiskScenarios(search, GLOBAL_SEARCH_LIMIT_PER_TYPE),
      repo.findPrimaryAssets(search, GLOBAL_SEARCH_LIMIT_PER_TYPE),
      repo.findSupportingAssets(search, GLOBAL_SEARCH_LIMIT_PER_TYPE),
      repo.findThreats(search, GLOBAL_SEARCH_LIMIT_PER_TYPE),
      repo.findOrganizations(search, GLOBAL_SEARCH_LIMIT_PER_TYPE),
      repo.findControlCapabilities(search, GLOBAL_SEARCH_LIMIT_PER_TYPE),
    ]);
    return { riskScenarios, primaryAssets, supportingAssets, threats, organizations, controls };
  },
});
