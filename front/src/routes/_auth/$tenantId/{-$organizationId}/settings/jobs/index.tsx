import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/jobs/')({
  beforeLoad: () => {
    throw redirect({ from: '/$tenantId/{-$organizationId}/settings/jobs', to: 'runs' });
  },
});
