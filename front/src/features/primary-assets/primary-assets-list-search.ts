import type { PrimaryToPrimaryLinkStrength } from '@app/module/client';
import { PRIMARY_TO_PRIMARY_LINK_STRENGTHS, SECURITY_NEED_LEVELS } from '@app/module/client';
import { z } from 'zod';
import { urlSearchText } from '../../utils';
import { ANY_RESOURCE_TYPE, NO_RESOURCE_TYPE } from '../asset-dependencies/primary-to-primary-links-utils';

const NO_HIDDEN_STRENGTHS: Array<PrimaryToPrimaryLinkStrength> = [];

export const PRIMARY_ASSETS_LIST_SEARCH_DEFAULTS = {
  search: '',
  businessFunction: '',
  level: 'all',
  resourceType: ANY_RESOURCE_TYPE,
  hiddenStrengths: NO_HIDDEN_STRENGTHS,
} as const;

/** `resourceType` and `hiddenStrengths` filter the links of the graph view alone. */
export const primaryAssetsListSearchSchema = z.object({
  search: urlSearchText,
  businessFunction: urlSearchText,
  level: z.enum(['all', 'not_set', ...SECURITY_NEED_LEVELS]).catch('all').default('all'),
  // Which types the links carry is resolved by `resolveOptionFilter`.
  resourceType: z.union([z.literal(ANY_RESOURCE_TYPE), z.literal(NO_RESOURCE_TYPE), z.uuid()]).catch(ANY_RESOURCE_TYPE).default(ANY_RESOURCE_TYPE),
  hiddenStrengths: z.array(z.enum(PRIMARY_TO_PRIMARY_LINK_STRENGTHS)).catch([]).default([]),
});
