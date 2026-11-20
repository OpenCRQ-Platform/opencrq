import { t } from '@lingui/core/macro';
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { trpcClient } from '../../../../../../lib';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/jobs')({
  beforeLoad: async ({ params }) => {
    const [hasManageSecurity, hasPlatformAccess] = await Promise.all([
      trpcClient.capabilities.hasManageSecurity.query(),
      trpcClient.platformCapabilities.hasPlatformAccess.query(),
    ]);
    if (!hasManageSecurity && !hasPlatformAccess) {
      throw redirect({ to: '/$tenantId/{-$organizationId}', params: { tenantId: params.tenantId, organizationId: params.organizationId } });
    }
  },
  loader: () => ({ crumb: t`Jobs` }),
  component: () => <Outlet />,
});
