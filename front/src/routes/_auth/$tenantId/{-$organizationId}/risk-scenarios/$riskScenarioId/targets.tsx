import { createFileRoute } from '@tanstack/react-router';
import { t } from '@lingui/core/macro';
import { RiskScenarioTargets } from '../../../../../../features/risk-scenarios';
import { Route as RiskScenarioRoute } from '../$riskScenarioId';

const RiskScenarioTargetsPage = () => {
  const { riskScenario } = RiskScenarioRoute.useLoaderData();
  return <RiskScenarioTargets riskScenarioId={riskScenario.id} />;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId/targets')({
  loader: () => ({ crumb: t`Targets` }),
  component: RiskScenarioTargetsPage,
});
