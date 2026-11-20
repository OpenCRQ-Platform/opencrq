import { z } from 'zod';

export const RISK_SCOPE_LIST_SEARCH_DEFAULTS = { riskScope: 'all' } as const;

export const riskScopeListSearchSchema = z.object({
  riskScope: z.union([z.uuid(), z.literal('all')]).catch('all').default('all'),
});
