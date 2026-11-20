import { z } from 'zod';
import { findingSourceSearchParam, findingsSearchParam } from './findings-list-search';

export const UNIQUE_FINDINGS_LIST_SEARCH_DEFAULTS = { search: '', source: 'all' } as const;

/** No state: a unique finding groups applicable findings only. */
export const uniqueFindingsListSearchSchema = z.object({
  search: findingsSearchParam,
  source: findingSourceSearchParam,
});
