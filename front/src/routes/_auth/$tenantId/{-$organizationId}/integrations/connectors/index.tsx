import { createFileRoute, redirect } from '@tanstack/react-router';

// The list moved up one level; an existing link or bookmark to this address still lands on it.
export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/integrations/connectors/')({
  beforeLoad: () => {
    throw redirect({ from: '/$tenantId/{-$organizationId}/integrations', to: 'deployed' });
  },
});
