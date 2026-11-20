import { z } from 'zod';
import { urlSearchText } from '../../../utils';

export const CAPABILITIES_LIST_SEARCH_DEFAULTS = { search: '', assessment: 'all' } as const;

export const capabilitiesListSearchSchema = z.object({
  search: urlSearchText,
  assessment: z.enum(['all', 'unassessed', 'forced']).catch('all').default('all'),
});
