import { z } from 'zod';
import { EVIDENCE_STATE_FILTERS } from '../../utils/evidence-state-utils';

export const UNIQUE_TECHNIQUE_FINDING_ASSETS_LIST_SEARCH_DEFAULTS = { state: 'applicable' } as const;

export const uniqueTechniqueFindingAssetsListSearchSchema = z.object({
  state: z.enum(EVIDENCE_STATE_FILTERS).catch('applicable').default('applicable'),
});
