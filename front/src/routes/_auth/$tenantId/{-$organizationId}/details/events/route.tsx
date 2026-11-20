import { createFileRoute, redirect } from '@tanstack/react-router';
import { t } from '@lingui/core/macro';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/details/events')({
  loader: ({ params }) => {
    if (params.organizationId === undefined) {
      throw redirect({ to: '/$tenantId/{-$organizationId}', params: { tenantId: params.tenantId } });
    }
    return { crumb: t`Events` };
  },
});
