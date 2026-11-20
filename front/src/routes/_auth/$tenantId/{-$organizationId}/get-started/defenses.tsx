import { t } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { DefensesStep } from '../../../../../features/onboarding';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/get-started/defenses')({
  component: DefensesStep,
  loader: () => ({ crumb: t`Defenses` }),
});
