import { z } from 'zod';
import { urlBoolean, urlSearchText } from '../../utils';

export const DRATA_REQUIREMENTS_LIST_SEARCH_DEFAULTS = { search: '', inScopeOnly: false, notReadyOnly: false } as const;

export const drataRequirementsListSearchSchema = z.object({
  search: urlSearchText,
  inScopeOnly: urlBoolean(false),
  notReadyOnly: urlBoolean(false),
});
