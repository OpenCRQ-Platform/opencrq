import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/findings/technique/$externalId/$expectationType/')({
  loader: () => {
    throw redirect({ from: '/$tenantId/{-$organizationId}/findings/technique/$externalId/$expectationType', to: 'overview' });
  },
});
