import { z } from 'zod';
import { urlBoolean, urlSearchText } from '../../utils';

export const THREAT_LOCATIONS_SECTORS_LIST_SEARCH_DEFAULTS = {
  locationSearch: '',
  locationsConcerningYou: false,
  country: '',
  sectorSearch: '',
  sectorsConcerningYou: false,
} as const;

export const threatLocationsSectorsListSearchSchema = z.object({
  locationSearch: urlSearchText,
  locationsConcerningYou: urlBoolean(false),
  // A country of the reference data, picked on the map: one the threat does not target falls back to
  // no filter once the locations are known.
  country: z.union([z.literal(''), z.guid()]).catch('').default(''),
  sectorSearch: urlSearchText,
  sectorsConcerningYou: urlBoolean(false),
});
