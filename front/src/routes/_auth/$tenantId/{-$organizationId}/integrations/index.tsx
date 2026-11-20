import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/integrations/')({
  beforeLoad: () => {
    throw redirect({ from: '/$tenantId/{-$organizationId}/integrations', to: 'deployed' });
  },
});
