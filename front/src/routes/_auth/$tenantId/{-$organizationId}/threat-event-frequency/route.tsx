import { t } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/threat-event-frequency')({
  // The page sits outside `threat-center/` so that the Threats entry stays unlit on it: no route
  // spans the Threats menu group, so each of its entries names the group itself.
  loader: () => ({
    ancestorCrumbs: [{ label: t`Threats` }],
    crumb: t`Threat Event Frequency`,
  }),
});
