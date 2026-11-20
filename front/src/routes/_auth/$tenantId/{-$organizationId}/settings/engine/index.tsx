import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/engine/')({
  beforeLoad: () => {
    throw redirect({ from: '/$tenantId/{-$organizationId}/settings/engine', to: 'threat-relevance' });
  },
});
