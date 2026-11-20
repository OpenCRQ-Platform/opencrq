import { createFileRoute } from '@tanstack/react-router';
import { t } from '@lingui/core/macro';
import { ScenarioConfigurationAccordion, ScenarioLossEstimatesPage, useMissingDataItems } from '../../../../../../features/risk-scenarios';
import { Route as RiskScenarioRoute } from '../$riskScenarioId';

const FinancialImpact = () => {
  const { riskScenario } = RiskScenarioRoute.useLoaderData();

  const missingDataItems = useMissingDataItems({
    riskScenarioId: riskScenario.id,
    currentLabel: 'loss-drivers' as const,
  });

  return (
    <div className="flex flex-col gap-6">
      <ScenarioConfigurationAccordion items={missingDataItems} />
      <ScenarioLossEstimatesPage key={riskScenario.id} riskScenarioId={riskScenario.id} organizationId={riskScenario.organizationId} />
    </div>
  );
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId/financial-impact')({
  loader: () => ({ crumb: t`Financial Impact` }),
  component: FinancialImpact,
});
