import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/security/')({
  beforeLoad: () => {
    throw redirect({ from: '/$tenantId/{-$organizationId}/settings/security', to: 'users', search: true });
  },
});
