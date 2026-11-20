import { createFileRoute, stripSearchParams } from '@tanstack/react-router';
import {
  CWE_CATALOGUE_LIST_SEARCH_DEFAULTS,
  cweCatalogueListSearchSchema,
} from '../../../../../../../features/cwe-catalogue/cwe-catalogue-list-search';
import { CweCatalogueDataTable } from '../../../../../../../features';

const RouteComponent = () => <CweCatalogueDataTable />;

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/taxonomies/cwe/')({
  validateSearch: cweCatalogueListSearchSchema,
  search: { middlewares: [stripSearchParams(CWE_CATALOGUE_LIST_SEARCH_DEFAULTS)] },
  component: RouteComponent,
});
