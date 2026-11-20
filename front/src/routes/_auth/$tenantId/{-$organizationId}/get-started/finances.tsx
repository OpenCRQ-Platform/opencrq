import { t } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { FinancesStep } from '../../../../../features/onboarding';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/get-started/finances')({
  component: FinancesStep,
  loader: () => ({ crumb: t`Finances` }),
});
