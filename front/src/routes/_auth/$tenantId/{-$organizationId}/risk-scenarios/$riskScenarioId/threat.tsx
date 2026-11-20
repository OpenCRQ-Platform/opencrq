import { createFileRoute } from '@tanstack/react-router';
import { t } from '@lingui/core/macro';
import { useQuery } from '@tanstack/react-query';
import { RiskScenarioThreat, ScenarioConfigurationAccordion, useMissingDataItems } from '../../../../../../features/risk-scenarios';
import { useTRPC } from '../../../../../../lib';
import { Route as RiskScenarioRoute } from '../$riskScenarioId';

const RiskScenarioThreatPage = () => {
  const trpc = useTRPC();
  const { riskScenario: initialData } = RiskScenarioRoute.useLoaderData();

  const { data: riskScenario } = useQuery(trpc.riskScenarios.getRiskScenario.queryOptions(
    { id: initialData.id },
    { initialData },
  ));

  const missingDataItems = useMissingDataItems({
    riskScenarioId: initialData.id,
    currentLabel: 'tef' as const,
  });

  if (!riskScenario) {
    return null;
  }

  return (
    <div className="flex flex-col gap-6">
      <ScenarioConfigurationAccordion items={missingDataItems} />
      <RiskScenarioThreat
        riskScenarioId={riskScenario.id}
        riskScenarioName={riskScenario.name}
        organizationId={riskScenario.organizationId}
        attackOutcomeId={riskScenario.attackOutcomeId}
      />
    </div>
  );
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId/threat')({
  loader: () => ({ crumb: t`Threat` }),
  component: RiskScenarioThreatPage,
});
