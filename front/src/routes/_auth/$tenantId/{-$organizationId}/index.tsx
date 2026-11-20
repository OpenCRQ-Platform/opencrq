import { createFileRoute, redirect, stripSearchParams } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import { DASHBOARD_PAGE_LIST_SEARCH_DEFAULTS, dashboardPageListSearchSchema } from '../../../../features/dashboard/dashboard-page-list-search';
import { opensGetStarted } from '../../../../features/onboarding';
import { DashboardPage, PerimeterEmptyCard } from '../../../../features';
import { trpcClient } from '../../../../lib';

const ScopeDashboard: FunctionComponent = () => {
  const { organizationId } = Route.useParams();

  if (organizationId !== undefined) {
    return <DashboardPage organizationId={organizationId} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <PerimeterEmptyCard />
      <DashboardPage />
    </div>
  );
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/')({
  validateSearch: dashboardPageListSearchSchema,
  search: { middlewares: [stripSearchParams(DASHBOARD_PAGE_LIST_SEARCH_DEFAULTS)] },
  beforeLoad: async ({ context, params }) => {
    if (params.organizationId !== undefined) {
      return;
    }
    const readWizard = () => trpcClient.onboardingWizard.getOnboardingWizard.query();
    if (await opensGetStarted({ userId: context.auth.user.id, tenantId: params.tenantId, readWizard })) {
      throw redirect({ to: '/$tenantId/{-$organizationId}/get-started', params: { tenantId: params.tenantId, organizationId: undefined } });
    }
  },
  component: ScopeDashboard,
});
