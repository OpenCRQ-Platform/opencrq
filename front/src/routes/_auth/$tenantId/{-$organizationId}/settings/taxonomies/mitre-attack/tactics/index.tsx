import { createFileRoute, stripSearchParams } from '@tanstack/react-router';
import {
  MITRE_ATTACK_LIST_SEARCH_DEFAULTS,
  mitreAttackListSearchSchema,
} from '../../../../../../../../features/mitre-attack/mitre-attack-list-search';
import { MitreTacticsDataTable } from '../../../../../../../../features';

const RouteComponent = () => <MitreTacticsDataTable />;

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/taxonomies/mitre-attack/tactics/')({
  validateSearch: mitreAttackListSearchSchema,
  search: { middlewares: [stripSearchParams(MITRE_ATTACK_LIST_SEARCH_DEFAULTS)] },
  component: RouteComponent,
});
