import { createFileRoute } from '@tanstack/react-router';
import { AttackOutcomesDataTable } from '../../../../../../../features';

const RouteComponent = () => <AttackOutcomesDataTable />;

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/taxonomies/attack-outcomes/')({
  component: RouteComponent,
});
