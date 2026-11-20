import { t } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { AssetsStep } from '../../../../../features/onboarding';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/get-started/assets')({
  component: AssetsStep,
  loader: () => ({ crumb: t`Assets` }),
});
