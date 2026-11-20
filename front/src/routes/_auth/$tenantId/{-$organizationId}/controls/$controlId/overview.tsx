import { createFileRoute } from '@tanstack/react-router';
import { t } from '@lingui/core/macro';
import { CapabilityOverviewContent } from '../../../../../../features/controls/capability/components/capability-overview';
import { Route as ControlRoute } from './route';

const CapabilityOverviewPage = () => {
  const { capability } = ControlRoute.useLoaderData();
  return <CapabilityOverviewContent capability={capability} />;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/controls/$controlId/overview')({
  loader: () => ({ crumb: t`Overview` }),
  component: CapabilityOverviewPage,
});
