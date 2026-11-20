import { z } from 'zod';
import { urlSearchText } from '../../utils';

// One schema for the three user lists — platform, tenant and the settings route that picks
// between them by scope: they share a single search field, and a route must validate the same
// shape whichever table it ends up rendering.
export const USERS_LIST_SEARCH_DEFAULTS = { search: '' } as const;

export const usersListSearchSchema = z.object({
  search: urlSearchText,
});
