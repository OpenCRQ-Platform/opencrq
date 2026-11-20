import { SECURITY_NEED_LEVELS } from '@app/module/client';
import { z } from 'zod';
import { urlSearchText } from '../../utils';

export const PRIMARY_ASSETS_LIST_SEARCH_DEFAULTS = { search: '', businessFunction: '', level: 'all' } as const;

export const primaryAssetsListSearchSchema = z.object({
  search: urlSearchText,
  businessFunction: urlSearchText,
  level: z.enum(['all', 'not_set', ...SECURITY_NEED_LEVELS]).catch('all').default('all'),
});
