import { FINDINGS_SEARCH_MAX_LENGTH, INTEGRATION_SOURCES } from '@app/module/client';
import { z } from 'zod';
import { EVIDENCE_STATE_FILTERS, urlSearchText } from '../../utils';
import { isVulnerabilityToken } from './vulnerability-filter-utils';

// `applicable` is the list's business default, kept as it was: `stripSearchParams` drops it from
// the address, so the menu entry stays a bare link and `?state=all` is what an explicit
// "every state" looks like.
export const FINDINGS_LIST_SEARCH_DEFAULTS = { search: '', state: 'applicable', source: 'all' } as const;

// Which sources a tenant actually has is data, resolved by `resolveOptionFilter`; which strings
// name a source at all is a fixed enumeration, and the same one the server validates against.
// Reading it here is what keeps an invented `?source=` from reaching the list query.
export const findingSourceSearchParam = z.enum([...INTEGRATION_SOURCES, 'user', 'all']).catch('all').default('all');

// Held to the server's bound, which refuses the whole query past it.
export const findingsSearchParam = urlSearchText.transform((search) => search.slice(0, FINDINGS_SEARCH_MAX_LENGTH));

export const findingsListSearchSchema = z.object({
  search: findingsSearchParam,
  state: z.enum(EVIDENCE_STATE_FILTERS).catch('applicable').default('applicable'),
  source: findingSourceSearchParam,
  /** One unique finding, spelled as `parseVulnerabilityToken` reads it. */
  vulnerability: z.string().refine(isVulnerabilityToken).optional().catch(undefined),
});
