import { REVENUE_BAND_VALUES, TEF_SIZE_CLASSES } from '@app/module/client';
import { z } from 'zod';
import { urlSearchText } from '../../utils/url-search-text';

/** A profile part left out is the starting profile's, so the address holds only what the reader changed. */
export const threatEventFrequencyListSearchSchema = z.object({
  /** The attack outcome a risk scenario links here from, picked out on its risk scope's page. */
  outcome: z.uuid().optional().catch(undefined),
  /** The risk scope the simulator starts from. */
  from: z.uuid().optional().catch(undefined),
  countryId: z.uuid().optional().catch(undefined),
  sectorId: z.uuid().optional().catch(undefined),
  /** A size class, or `unknown` for no headcount, the revenue band then sizing the profile. */
  size: z.enum([...TEF_SIZE_CLASSES, 'unknown']).optional().catch(undefined),
  revenueBand: z.enum(REVENUE_BAND_VALUES).optional().catch(undefined),
});

export const THREAT_EVENT_FREQUENCY_SCOPES_LIST_SEARCH_DEFAULTS = { search: '' } as const;

export const threatEventFrequencyScopesListSearchSchema = z.object({
  search: urlSearchText,
});
