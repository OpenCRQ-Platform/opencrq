import { t } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { ToleranceStep } from '../../../../../features/onboarding';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/get-started/tolerance')({
  component: ToleranceStep,
  loader: () => ({ crumb: t`Tolerance` }),
});
