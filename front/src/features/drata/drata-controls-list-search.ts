import { z } from 'zod';
import { urlBoolean, urlSearchText } from '../../utils';

// `notReadyOnly` is this table's business default: `stripSearchParams` drops it from the address,
// so a bare `…/controls` stays short and still lists what is left to do, and `?notReadyOnly=false`
// is what asking for every control looks like.
export const DRATA_CONTROLS_LIST_SEARCH_DEFAULTS = { search: '', notReadyOnly: true } as const;

export const drataControlsListSearchSchema = z.object({
  search: urlSearchText,
  notReadyOnly: urlBoolean(true),
});
