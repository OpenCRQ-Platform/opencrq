import type { FunctionComponent } from 'react';
import { CrqTefInput } from './crq-tef-input';
import { RiskScenarioRelevantThreats } from './risk-scenario-relevant-threats';

interface RiskScenarioThreatProps {
  riskScenarioId: string,
  riskScenarioName: string,
  organizationId: string,
  attackOutcomeId: string,
}

export const RiskScenarioThreat: FunctionComponent<RiskScenarioThreatProps> = ({ riskScenarioId, riskScenarioName, organizationId, attackOutcomeId }) => (
  <div className="flex flex-col gap-6">
    <CrqTefInput riskScenarioId={riskScenarioId} organizationId={organizationId} attackOutcomeId={attackOutcomeId} />
    <RiskScenarioRelevantThreats riskScenarioId={riskScenarioId} riskScenarioName={riskScenarioName} />
  </div>
);
