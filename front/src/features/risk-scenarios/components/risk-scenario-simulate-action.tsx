import { Button } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent, ReactElement } from 'react';
import { TooltipHint, TooltipHintProvider } from '../../../components/shared/tooltip-hint';
import { useTRPC } from '../../../lib';
import { composeThreatScore } from '../../threats';
import { useCounterparts } from '../../xtm/xtm-counterparts';

interface RiskScenarioSimulateActionProps {
  riskScenarioId: string,
}

/**
 * The cross-module action a risk scenario offers: "Simulate in OpenAEV" opens the OpenAEV scenario
 * built from the scenario's most relevant threat, so the risk quantified here is validated there.
 * Reads the relevant threats the Relevant Threats tab already caches and one batched counterpart
 * lookup; renders nothing while OpenAEV is not connected or holds none of those threats.
 */
export const RiskScenarioSimulateAction: FunctionComponent<RiskScenarioSimulateActionProps> = ({ riskScenarioId }): ReactElement | null => {
  const trpc = useTRPC();
  const { data: relevant } = useQuery(trpc.threats.getRelevantForScenario.queryOptions({ scenarioId: riskScenarioId }));
  const items = relevant?.items ?? [];
  const counterparts = useCounterparts('THREAT', items.map((item) => item.stixId));
  const simulated = items
    .map((item) => ({
      item,
      score: composeThreatScore(item.combinedRelevance, item.activityWeight),
      scenario: counterparts.find((c) => c.product === 'openaev' && c.key === item.stixId.toLowerCase()),
    }))
    .filter((candidate) => candidate.scenario !== undefined)
    .sort((a, b) => b.score - a.score)[0];
  if (!simulated?.scenario) {
    return null;
  }
  const threatName = simulated.item.name;
  return (
    <TooltipHintProvider>
      <TooltipHint hint={t`Open the OpenAEV scenario of ${threatName}`}>
        <Button asChild priority="secondary">
          <a href={simulated.scenario.objectUrl} target="_blank" rel="noreferrer noopener">
            <img src="/img/icon-openaev.png" alt="" aria-hidden width={16} height={16} className="shrink-0" />
            {t`Simulate in OpenAEV`}
          </a>
        </Button>
      </TooltipHint>
    </TooltipHintProvider>
  );
};
