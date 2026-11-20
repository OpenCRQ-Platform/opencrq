import { createFileRoute } from '@tanstack/react-router';
import { t } from '@lingui/core/macro';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/notifications')({
  loader: () => ({ crumb: t`Notifications` }),
});
