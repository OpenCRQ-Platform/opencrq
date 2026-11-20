import type { DatatableI18nKey } from '@filigran/ui';
import { t } from '@lingui/core/macro';

/**
 * `@filigran/ui`'s `DataTable` renders its own labels, pagination and column menu included, through
 * this dictionary and falls back to its English source for any key it is not handed.
 */
export const getDataTableI18nKey = (): DatatableI18nKey => ({
  'Rows per page': t`Rows per page`,
  'Manage columns visibility': t`Manage columns visibility`,
  Asc: t`Asc`,
  Desc: t`Desc`,
  Hide: t`Hide`,
  'Go to first page': t`Go to first page`,
  'Go to previous page': t`Go to previous page`,
  'Go to next page': t`Go to next page`,
  'Go to last page': t`Go to last page`,
  Columns: t`Columns`,
  'Reset table': t`Reset table`,
});
