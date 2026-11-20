import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/primary-assets/$primaryAssetId/')({
  loader: () => {
    throw redirect({
      from: '/$tenantId/{-$organizationId}/primary-assets/$primaryAssetId',
      to: 'overview',
    });
  },
});
