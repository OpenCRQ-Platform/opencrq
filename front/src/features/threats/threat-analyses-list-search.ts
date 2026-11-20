import { THREAT_ENTITY_TYPES, THREAT_SOURCE_KINDS } from '@app/module/client';
import { z } from 'zod';
import { urlSearchText } from '../../utils';

export const THREAT_ANALYSES_LIST_SEARCH_DEFAULTS = { search: '', outcomeId: 'all', entityType: 'all', kind: 'all' } as const;

export const threatAnalysesListSearchSchema = z.object({
  search: urlSearchText,
  // Which outcomes a tenant actually has is data, resolved by `resolveOptionFilter` once the
  // catalogue lands; what a well-formed outcome looks like is not. Reading the uuid shape here is
  // what keeps a hand-written `?outcomeId=` from reaching the list query's own `z.uuid()` input
  // and raising a validation toast before the catalogue can answer.
  outcomeId: z.union([z.literal('all'), z.uuid()]).catch('all').default('all'),
  entityType: z.enum(['all', ...THREAT_ENTITY_TYPES]).catch('all').default('all'),
  kind: z.enum(['all', ...THREAT_SOURCE_KINDS]).catch('all').default('all'),
});
