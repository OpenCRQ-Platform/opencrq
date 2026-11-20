import { t } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { ScenariosStep } from '../../../../../features/onboarding';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/get-started/scenarios')({
  component: ScenariosStep,
  loader: () => ({ crumb: t`Scenarios` }),
});
