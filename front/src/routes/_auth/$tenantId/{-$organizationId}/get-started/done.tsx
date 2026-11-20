import { t } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { GetStartedDone } from '../../../../../features/onboarding';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/get-started/done')({
  component: GetStartedDone,
  loader: () => ({ crumb: t`Done` }),
});
