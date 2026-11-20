import { t } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { CrqIndicatorSettings } from '../../../../../../../features/crq-indicator-settings';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/engine/crq-indicators/')({
  loader: () => ({ crumb: t`CRQ Indicators` }),
  component: CrqIndicatorSettings,
});
