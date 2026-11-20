import { ASSET_CATEGORY_VALUES, INTEGRATION_SOURCES } from '@app/module/client';
import { z } from 'zod';
import { urlSearchText } from '../../utils';

export const SUPPORTING_ASSETS_LIST_SEARCH_DEFAULTS = { search: '', source: 'all', category: 'all', categoryMode: 'only', group: 'all' } as const;

export const supportingAssetsListSearchSchema = z.object({
  search: urlSearchText,
  // Which sources a tenant actually has is data, resolved by `resolveOptionFilter`; which strings
  // name a source at all is a fixed enumeration, and the same one the server validates against.
  // Reading it here is what keeps an invented `?source=` from reaching the list query.
  source: z.enum([...INTEGRATION_SOURCES, 'user', 'all']).catch('all').default('all'),
  // The eleven categories are a fixed enumeration on both sides, so this needs no option
  // resolution: a category a tenant happens to hold none of is still a category.
  category: z.enum([...ASSET_CATEGORY_VALUES, 'all']).catch('all').default('all'),
  categoryMode: z.enum(['only', 'except']).catch('only').default('only'),
  // A group is tenant data like a source: the id is only shape-checked here, and
  // `resolveOptionFilter` drops one the tenant no longer has once the groups are loaded.
  group: z.union([z.uuid(), z.literal('all')]).catch('all').default('all'),
});
