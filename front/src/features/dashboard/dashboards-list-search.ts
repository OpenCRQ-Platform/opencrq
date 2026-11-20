import { z } from 'zod';
import { urlSearchText } from '../../utils';

export const DASHBOARDS_LIST_SEARCH_DEFAULTS = { search: '' } as const;

export const dashboardsListSearchSchema = z.object({
  search: urlSearchText,
});
