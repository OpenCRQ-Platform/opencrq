import { t } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { DependencyRulesDataTable } from '../../../../../../../features/asset-dependencies';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/engine/dependency-rules/')({
  loader: () => ({ crumb: t`Dependency Rules` }),
  component: DependencyRulesDataTable,
});
