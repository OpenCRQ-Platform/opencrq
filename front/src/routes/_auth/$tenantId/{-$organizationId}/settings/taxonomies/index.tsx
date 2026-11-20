import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/taxonomies/')({
  beforeLoad: () => {
    throw redirect({ from: '/$tenantId/{-$organizationId}/settings/taxonomies', to: 'business-value-categories' });
  },
});
