import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/compliance/$frameworkId/')({
  loader: () => {
    throw redirect({
      from: '/$tenantId/{-$organizationId}/compliance/$frameworkId',
      to: 'requirements',
    });
  },
});
