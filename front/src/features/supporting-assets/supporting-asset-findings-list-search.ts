import { EXPECTATION_TYPE_VALUES, FINDINGS_SEARCH_MAX_LENGTH, TECHNIQUE_EXTERNAL_ID_MAX_LENGTH } from '@app/module/client';
import { z } from 'zod';
import { EVIDENCE_STATE_FILTERS, urlSearchText } from '../../utils';

export const SUPPORTING_ASSET_FINDINGS_LIST_SEARCH_DEFAULTS = { search: '', state: 'applicable' } as const;

// Held to the server's bounds, which refuse the whole query past them.
export const supportingAssetFindingsListSearchSchema = z.object({
  search: urlSearchText.transform((search) => search.slice(0, FINDINGS_SEARCH_MAX_LENGTH)),
  state: z.enum(EVIDENCE_STATE_FILTERS).catch('applicable').default('applicable'),
  /** A technique's external id, which narrows the list to the OpenAEV results on it. */
  technique: z.string().min(1).max(TECHNIQUE_EXTERNAL_ID_MAX_LENGTH).optional().catch(undefined),
  expectation: z.enum(EXPECTATION_TYPE_VALUES).optional().catch(undefined),
});
