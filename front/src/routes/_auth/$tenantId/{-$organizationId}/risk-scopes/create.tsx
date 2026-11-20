import { createFileRoute } from '@tanstack/react-router';
import { t } from '@lingui/core/macro';
import { RiskScopeWizard } from '../../../../../features';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/risk-scopes/create')({
  component: RiskScopeWizard,
  loader: () => ({
    crumb: t`Create a risk scope`,
  }),
});
