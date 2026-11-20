import { z } from 'zod';
import { urlSearchText } from '../../utils';

export const MITRE_ATTACK_LIST_SEARCH_DEFAULTS = { search: '' } as const;

export const mitreAttackListSearchSchema = z.object({
  search: urlSearchText,
});
