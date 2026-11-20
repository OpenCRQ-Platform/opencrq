import type { FunctionComponent } from 'react';
import { CrqRunHistory } from './crq-run-history';
import { CrqSimulationResults } from './crq-simulation-results';

interface RiskScenario {
  id: string,
  organizationId: string,
  attackOutcomeId: string,
}

interface RiskScenarioCrqProps {
  riskScenario: RiskScenario,
}

export const RiskScenarioCrq: FunctionComponent<RiskScenarioCrqProps> = ({ riskScenario }) => (
  <div className="flex flex-col gap-6">
    <CrqSimulationResults riskScenarioId={riskScenario.id} organizationId={riskScenario.organizationId} />
    <CrqRunHistory riskScenarioId={riskScenario.id} />
  </div>
);
