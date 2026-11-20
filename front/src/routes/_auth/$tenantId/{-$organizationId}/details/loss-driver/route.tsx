import { createFileRoute } from '@tanstack/react-router';
import { t } from '@lingui/core/macro';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/details/loss-driver')({
  loader: () => ({ crumb: t`Loss Driver` }),
});
