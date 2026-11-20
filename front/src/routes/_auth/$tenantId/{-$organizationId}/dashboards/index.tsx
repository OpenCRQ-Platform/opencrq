import { createFileRoute, stripSearchParams } from '@tanstack/react-router';
import { DASHBOARDS_LIST_SEARCH_DEFAULTS, dashboardsListSearchSchema } from '../../../../../features/dashboard/dashboards-list-search';
import { DashboardsListPage } from '../../../../../features';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/dashboards/')({
  validateSearch: dashboardsListSearchSchema,
  search: { middlewares: [stripSearchParams(DASHBOARDS_LIST_SEARCH_DEFAULTS)] },
  component: DashboardsListPage,
});
