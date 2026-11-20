import { INTEGRATION_SOURCES } from '@app/module/client';
import { z } from 'zod';
import { urlSearchText } from '../../utils';
import { MANUAL_SOURCE, XTM_ONE_SOURCE } from './components/tag-management-utils';

export const TAGS_LIST_SEARCH_DEFAULTS = { search: '', source: 'all' } as const;

export const tagsListSearchSchema = z.object({
  search: urlSearchText,
  // Which of these the tenant's tags have is resolved by `resolveOptionFilter`.
  source: z.enum([...INTEGRATION_SOURCES, MANUAL_SOURCE, XTM_ONE_SOURCE, 'all']).catch('all').default('all'),
});
