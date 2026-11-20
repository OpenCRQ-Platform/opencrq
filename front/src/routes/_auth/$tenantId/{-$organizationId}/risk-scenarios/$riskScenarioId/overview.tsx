import { createFileRoute } from '@tanstack/react-router';
import { t } from '@lingui/core/macro';
import { useQuery } from '@tanstack/react-query';
import { RiskScenarioOverview } from '../../../../../../features/risk-scenarios';
import { useTRPC } from '../../../../../../lib';
import { Route as RiskScenarioRoute } from '../$riskScenarioId';

const RiskScenarioOverviewPage = () => {
  const trpc = useTRPC();
  const { riskScenario: initialData } = RiskScenarioRoute.useLoaderData();
  const { data: riskScenario } = useQuery(trpc.riskScenarios.getRiskScenario.queryOptions(
    { id: initialData.id },
    { initialData },
  ));
  if (!riskScenario) {
    return null;
  }
  return <RiskScenarioOverview riskScenario={riskScenario} />;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId/overview')({
  loader: () => ({ crumb: t`Overview` }),
  component: RiskScenarioOverviewPage,
});
