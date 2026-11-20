import { t } from '@lingui/core/macro';
import { createFileRoute, linkOptions, Outlet, redirect } from '@tanstack/react-router';
import { NavToolbarMenu } from '../../../../../../components';
import { trpcClient } from '../../../../../../lib';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/engine')({
  beforeLoad: async ({ params }) => {
    if (!await trpcClient.capabilities.hasManageSecurity.query()) {
      throw redirect({ to: '/$tenantId/{-$organizationId}', params: { tenantId: params.tenantId, organizationId: params.organizationId } });
    }
  },
  loader: () => ({ crumb: t`Engine` }),
  component: () => {
    const entries = [
      { linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/settings/engine', to: 'threat-relevance' }), label: t`Threat Relevance` },
      { linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/settings/engine', to: 'crq-indicators' }), label: t`CRQ Indicators` },
    ];
    return (
      <div className="mr-[200px]">
        <Outlet />
        <NavToolbarMenu entries={entries} />
      </div>
    );
  },
});
