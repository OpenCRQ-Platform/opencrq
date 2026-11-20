import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/taxonomies/mitre-attack/')({
  beforeLoad: () => {
    throw redirect({ from: '/$tenantId/{-$organizationId}/settings/taxonomies/mitre-attack', to: 'matrix' });
  },
});
