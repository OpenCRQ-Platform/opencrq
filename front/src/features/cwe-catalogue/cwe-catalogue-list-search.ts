import { z } from 'zod';
import { urlBoolean, urlSearchText } from '../../utils';

export const CWE_CATALOGUE_LIST_SEARCH_DEFAULTS = { search: '', presentInFindings: true, modified: false } as const;

export const cweCatalogueListSearchSchema = z.object({
  search: urlSearchText,
  presentInFindings: urlBoolean(true),
  modified: urlBoolean(false),
});
