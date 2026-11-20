import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/integrations/connectors/$connectorSlug/')({
  beforeLoad: ({ params }) => {
    throw redirect({
      from: '/$tenantId/{-$organizationId}/integrations/connectors/$connectorSlug',
      to: 'overview',
      params,
    });
  },
});
