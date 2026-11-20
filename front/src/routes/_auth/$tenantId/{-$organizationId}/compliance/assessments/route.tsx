import { t } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/compliance/assessments')({
  loader: () => ({ crumb: t`Assessments` }),
});
