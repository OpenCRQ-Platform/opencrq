import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/details/')({
  loader: () => {
    throw redirect({
      from: '/$tenantId/{-$organizationId}/details',
      to: 'overview',
    });
  },
});
