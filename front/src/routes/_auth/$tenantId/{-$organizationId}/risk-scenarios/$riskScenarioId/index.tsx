import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId/')({
  loader: () => {
    throw redirect({
      from: '/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId',
      to: 'overview',
    });
  },
});
