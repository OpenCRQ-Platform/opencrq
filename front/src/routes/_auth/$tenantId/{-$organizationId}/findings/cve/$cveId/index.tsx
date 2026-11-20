import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/findings/cve/$cveId/')({
  loader: () => {
    throw redirect({ from: '/$tenantId/{-$organizationId}/findings/cve/$cveId', to: 'overview' });
  },
});
