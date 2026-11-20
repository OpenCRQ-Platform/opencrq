import { createFileRoute } from '@tanstack/react-router';
import { ServiceAccountsDataTable } from '../../../../../../../features';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/security/service-accounts/')({
  component: () => <ServiceAccountsDataTable />,
});
