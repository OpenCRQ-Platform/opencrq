import { createFileRoute } from '@tanstack/react-router';
import { t } from '@lingui/core/macro';
import { CapabilityFunctionTab } from '../../../../../../features/controls/capability/components/capability-function-tab';
import { Route as ControlRoute } from './route';

const CapabilityPreventionPage = () => {
  const { capability } = ControlRoute.useLoaderData();
  return <CapabilityFunctionTab capability={capability} capabilityFunction="prevent" />;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/controls/$controlId/prevention')({
  loader: () => ({ crumb: t`Prevention` }),
  component: CapabilityPreventionPage,
});
