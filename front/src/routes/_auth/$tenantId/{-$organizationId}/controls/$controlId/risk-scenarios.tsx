import { createFileRoute } from '@tanstack/react-router';
import { t } from '@lingui/core/macro';
import { CapabilityRiskScenariosTable } from '../../../../../../features/controls/capability/components/capability-risk-scenarios-table';
import { Route as ControlRoute } from './route';

const CapabilityRiskScenariosPage = () => {
  const { capability } = ControlRoute.useLoaderData();
  return <CapabilityRiskScenariosTable capabilityId={capability.id} />;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/controls/$controlId/risk-scenarios')({
  loader: () => ({ crumb: t`Risk Scenarios` }),
  component: CapabilityRiskScenariosPage,
});
