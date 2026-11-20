import { t } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { ThreatsStep } from '../../../../../features/onboarding';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/get-started/threats')({
  component: ThreatsStep,
  loader: () => ({ crumb: t`Threats` }),
});
