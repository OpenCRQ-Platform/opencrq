import { createFileRoute, stripSearchParams } from '@tanstack/react-router';
import { CVE_LIST_SEARCH_DEFAULTS, cveListSearchSchema } from '../../../../../../../features/cve/cve-list-search';
import { CveDataTable } from '../../../../../../../features';

const RouteComponent = () => <CveDataTable />;

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/taxonomies/cve/')({
  validateSearch: cveListSearchSchema,
  search: { middlewares: [stripSearchParams(CVE_LIST_SEARCH_DEFAULTS)] },
  component: RouteComponent,
});
