import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/assets/$supportingAssetId/')({
  loader: () => {
    throw redirect({
      from: '/$tenantId/{-$organizationId}/assets/$supportingAssetId',
      to: 'overview',
    });
  },
});
