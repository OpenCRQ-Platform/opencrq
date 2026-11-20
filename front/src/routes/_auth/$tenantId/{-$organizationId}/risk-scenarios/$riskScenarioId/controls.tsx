import { createFileRoute } from '@tanstack/react-router';
import { t } from '@lingui/core/macro';
import { useQuery } from '@tanstack/react-query';
import { RiskScenarioControls } from '../../../../../../features/risk-scenarios';
import { useTRPC } from '../../../../../../lib';
import { Route as RiskScenarioRoute } from '../$riskScenarioId';

const RiskScenarioControlsPage = () => {
  const trpc = useTRPC();
  const { riskScenario: initialData } = RiskScenarioRoute.useLoaderData();

  const { data: riskScenario } = useQuery(trpc.riskScenarios.getRiskScenario.queryOptions(
    { id: initialData.id },
    { initialData },
  ));

  if (!riskScenario) {
    return null;
  }

  return (
    <RiskScenarioControls
      riskScenarioId={riskScenario.id}
      organizationId={riskScenario.organizationId}
      attackOutcomeId={riskScenario.attackOutcomeId}
    />
  );
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId/controls')({
  loader: () => ({ crumb: t`Controls` }),
  component: RiskScenarioControlsPage,
});
