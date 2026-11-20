import { createFileRoute } from '@tanstack/react-router';
import { t } from '@lingui/core/macro';
import { z } from 'zod';
import { RiskScenarioWizard } from '../../../../../features';

const RouteComponent = () => {
  const { organizationId } = Route.useParams();
  const { attackOutcomeId } = Route.useSearch();
  return <RiskScenarioWizard organizationId={organizationId} initialAttackOutcomeId={attackOutcomeId} />;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/risk-scenarios/create')({
  // The threat page's "Quantify risk" action prefills the outcome; a malformed value opens the wizard blank.
  validateSearch: z.object({ attackOutcomeId: z.uuid().optional().catch(undefined) }),
  component: RouteComponent,
  loader: () => ({
    crumb: t`Create`,
  }),
});
