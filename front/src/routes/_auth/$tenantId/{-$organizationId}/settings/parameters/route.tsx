import { t } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/parameters')({
  loader: () => ({ crumb: t`Parameters` }),
});
