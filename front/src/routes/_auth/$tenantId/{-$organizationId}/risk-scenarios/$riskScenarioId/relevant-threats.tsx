import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId/relevant-threats')({
  loader: () => {
    throw redirect({
      from: '/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId',
      to: 'threat',
      replace: true,
    });
  },
});
