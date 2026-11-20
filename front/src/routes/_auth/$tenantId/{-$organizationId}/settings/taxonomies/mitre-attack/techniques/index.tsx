import { createFileRoute, stripSearchParams } from '@tanstack/react-router';
import {
  MITRE_ATTACK_LIST_SEARCH_DEFAULTS,
  mitreAttackListSearchSchema,
} from '../../../../../../../../features/mitre-attack/mitre-attack-list-search';
import { MitreTechniquesDataTable } from '../../../../../../../../features';

const RouteComponent = () => <MitreTechniquesDataTable />;

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/taxonomies/mitre-attack/techniques/')({
  validateSearch: mitreAttackListSearchSchema,
  search: { middlewares: [stripSearchParams(MITRE_ATTACK_LIST_SEARCH_DEFAULTS)] },
  component: RouteComponent,
});
