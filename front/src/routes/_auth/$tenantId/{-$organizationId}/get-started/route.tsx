import { t } from '@lingui/core/macro';
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { useEffect } from 'react';
import type { FunctionComponent } from 'react';
import { trpcClient } from '../../../../../lib';
import { useLoggedUser } from '../../../../../providers/logged-user-provider';
import { markGetStartedSeen } from '../../../../../stores';

const GetStartedLayout: FunctionComponent = () => {
  const { userId } = useLoggedUser();
  const { tenantId } = Route.useParams();

  useEffect(() => {
    markGetStartedSeen(userId, tenantId);
  }, [userId, tenantId]);

  return <Outlet />;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/get-started')({
  // A tenant without a wizard (the platform seed's) has no Get started page: a bookmark goes to the home.
  beforeLoad: async ({ params }) => {
    const wizard = await trpcClient.onboardingWizard.getOnboardingWizard.query();
    if (wizard === null) {
      throw redirect({ to: '/$tenantId/{-$organizationId}', params: { tenantId: params.tenantId } });
    }
  },
  loader: () => ({ crumb: t`Get started` }),
  component: GetStartedLayout,
});
