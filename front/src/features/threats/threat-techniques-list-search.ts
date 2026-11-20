import { z } from 'zod';
import { CAPABILITY_FUNCTIONS } from '@app/module/client';
import { urlSearchText } from '../../utils';
import { EFFICACY_SEGMENTS } from '../controls/capability/utils/control-technique-readings-utils';

export const THREAT_TECHNIQUES_LIST_SEARCH_DEFAULTS = { search: '', tactic: '', function: 'prevent', result: 'all' } as const;

export const threatTechniquesListSearchSchema = z.object({
  search: urlSearchText,
  // Which tactics a threat falls under is data, resolved by `resolveOptionFilter` against its own
  // techniques; the empty tactic is every tactic.
  tactic: z.string().catch('').default(''),
  function: z.enum(CAPABILITY_FUNCTIONS).catch('prevent').default('prevent'),
  result: z.enum(EFFICACY_SEGMENTS).catch('all').default('all'),
});
