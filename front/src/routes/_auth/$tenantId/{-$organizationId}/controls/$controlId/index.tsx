import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/controls/$controlId/')({
  loader: () => {
    throw redirect({
      from: '/$tenantId/{-$organizationId}/controls/$controlId',
      to: 'overview',
    });
  },
});
