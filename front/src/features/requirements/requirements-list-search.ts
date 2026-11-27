import { z } from 'zod';
import { urlSearchText } from '../../utils';

export const REQUIREMENTS_LIST_SEARCH_DEFAULTS = { search: '' } as const;

export const requirementsListSearchSchema = z.object({
  search: urlSearchText,
});
