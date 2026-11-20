import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/threat-center/threats/$threatId/')({
  loader: () => {
    throw redirect({
      from: '/$tenantId/{-$organizationId}/threat-center/threats/$threatId',
      to: 'overview',
    });
  },
});
