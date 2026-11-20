import { t } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/threat-center')({
  loader: () => ({ ancestorCrumbs: [{ label: t`Threats` }], crumb: t`Threats` }),
});
