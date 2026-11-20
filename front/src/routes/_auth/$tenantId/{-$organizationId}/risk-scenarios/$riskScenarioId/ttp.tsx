import { createFileRoute } from '@tanstack/react-router';
import { t } from '@lingui/core/macro';
import { useQuery } from '@tanstack/react-query';
import { RiskScenarioTtps } from '../../../../../../features';
import { useTRPC } from '../../../../../../lib';
import { Route as RiskScenarioRoute } from '../$riskScenarioId';

const RiskScenarioTtpsPage = () => {
  const trpc = useTRPC();
  const { riskScenario: initialData } = RiskScenarioRoute.useLoaderData();

  const { data: riskScenario } = useQuery(trpc.riskScenarios.getRiskScenario.queryOptions(
    { id: initialData.id },
    { initialData },
  ));

  if (!riskScenario) {
    return null;
  }

  return <RiskScenarioTtps riskScenario={riskScenario} />;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId/ttp')({
  loader: () => ({ crumb: t`TTP` }),
  component: RiskScenarioTtpsPage,
});
