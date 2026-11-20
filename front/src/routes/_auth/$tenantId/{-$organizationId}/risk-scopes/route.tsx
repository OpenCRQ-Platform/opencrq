import { t } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/risk-scopes')({
  loader: () => ({ crumb: t`Risk scopes` }),
});
