import { t } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { ProtectStep } from '../../../../../features/onboarding';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/get-started/protect')({
  component: ProtectStep,
  loader: () => ({ crumb: t`Protect` }),
});
