import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/taxonomies/attack-outcomes/$attackOutcomeId/')({
  loader: () => {
    throw redirect({
      from: '/$tenantId/{-$organizationId}/settings/taxonomies/attack-outcomes/$attackOutcomeId',
      to: 'overview',
    });
  },
});
