import { createFileRoute, stripSearchParams } from '@tanstack/react-router';
import { t } from '@lingui/core/macro';
import {
  RISK_SCENARIO_FINDINGS_LIST_SEARCH_DEFAULTS,
  riskScenarioFindingsListSearchSchema,
} from '../../../../../../features/risk-scenarios/risk-scenario-findings-list-search';
import { RiskScenarioFindings } from '../../../../../../features/risk-scenarios';
import { Route as RiskScenarioRoute } from '../$riskScenarioId';

const RiskScenarioFindingsPage = () => {
  const { riskScenario } = RiskScenarioRoute.useLoaderData();
  return <RiskScenarioFindings riskScenarioId={riskScenario.id} />;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId/findings')({
  validateSearch: riskScenarioFindingsListSearchSchema,
  search: { middlewares: [stripSearchParams(RISK_SCENARIO_FINDINGS_LIST_SEARCH_DEFAULTS)] },
  loader: () => ({ crumb: t`Findings` }),
  component: RiskScenarioFindingsPage,
});
