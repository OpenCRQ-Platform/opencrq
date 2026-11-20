import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/compliance/')({
  beforeLoad: () => {
    throw redirect({ from: '/$tenantId/{-$organizationId}/compliance', to: 'assessments', replace: true });
  },
});
