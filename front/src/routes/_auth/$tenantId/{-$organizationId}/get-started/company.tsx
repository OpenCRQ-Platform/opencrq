import { t } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { CompanyStep } from '../../../../../features/onboarding';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/get-started/company')({
  component: CompanyStep,
  loader: () => ({ crumb: t`Company` }),
});
