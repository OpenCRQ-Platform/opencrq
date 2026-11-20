import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/jobs/kinds/$jobKind/')({
  beforeLoad: ({ params }) => {
    throw redirect({
      from: '/$tenantId/{-$organizationId}/settings/jobs/kinds/$jobKind',
      to: 'overview',
      params,
    });
  },
});
