import { createFileRoute, notFound, stripSearchParams } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import { getDashboardDefinition, isDashboardId } from '../../../../../features/dashboard/dashboard-registry';
import { DASHBOARD_PAGE_LIST_SEARCH_DEFAULTS, dashboardPageListSearchSchema } from '../../../../../features/dashboard/dashboard-page-list-search';
import { DashboardPage, PerimeterEmptyCard } from '../../../../../features';

const DashboardRoute: FunctionComponent = () => {
  const { organizationId, dashboardId } = Route.useParams();
  if (!isDashboardId(dashboardId)) {
    return null;
  }

  if (organizationId !== undefined) {
    return <DashboardPage organizationId={organizationId} dashboardId={dashboardId} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <PerimeterEmptyCard />
      <DashboardPage dashboardId={dashboardId} />
    </div>
  );
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/dashboards/$dashboardId')({
  validateSearch: dashboardPageListSearchSchema,
  search: { middlewares: [stripSearchParams(DASHBOARD_PAGE_LIST_SEARCH_DEFAULTS)] },
  beforeLoad: ({ params }) => {
    if (!isDashboardId(params.dashboardId)) {
      throw notFound();
    }
  },
  loader: ({ params }) => ({
    crumb: isDashboardId(params.dashboardId) ? getDashboardDefinition(params.dashboardId).getLabel() : '',
  }),
  component: DashboardRoute,
});
