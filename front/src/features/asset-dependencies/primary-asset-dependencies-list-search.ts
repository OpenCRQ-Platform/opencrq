import { z } from 'zod';
import { ANY_RESOURCE_TYPE, NO_RESOURCE_TYPE } from './primary-to-primary-links-utils';

export const PRIMARY_ASSET_DEPENDENCIES_LIST_SEARCH_DEFAULTS = { resourceType: ANY_RESOURCE_TYPE } as const;

export const primaryAssetDependenciesListSearchSchema = z.object({
  // Which types the links carry is resolved by `resolveOptionFilter`.
  resourceType: z.union([z.literal(ANY_RESOURCE_TYPE), z.literal(NO_RESOURCE_TYPE), z.uuid()]).catch(ANY_RESOURCE_TYPE).default(ANY_RESOURCE_TYPE),
});
