import { createFileRoute, stripSearchParams } from '@tanstack/react-router';
import { CAPABILITIES_LIST_SEARCH_DEFAULTS, capabilitiesListSearchSchema } from '../../../../../features/controls/capability/capabilities-list-search';
import { CapabilitiesDataTable } from '../../../../../features';

const RouteComponent = () => <CapabilitiesDataTable />;

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/controls/')({
  validateSearch: capabilitiesListSearchSchema,
  search: { middlewares: [stripSearchParams(CAPABILITIES_LIST_SEARCH_DEFAULTS)] },
  component: RouteComponent,
});
