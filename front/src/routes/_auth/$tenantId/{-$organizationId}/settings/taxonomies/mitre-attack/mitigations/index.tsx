import { createFileRoute, stripSearchParams } from '@tanstack/react-router';
import {
  MITRE_ATTACK_LIST_SEARCH_DEFAULTS,
  mitreAttackListSearchSchema,
} from '../../../../../../../../features/mitre-attack/mitre-attack-list-search';
import { MitreMitigationsDataTable } from '../../../../../../../../features';

const RouteComponent = () => <MitreMitigationsDataTable />;

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/taxonomies/mitre-attack/mitigations/')({
  validateSearch: mitreAttackListSearchSchema,
  search: { middlewares: [stripSearchParams(MITRE_ATTACK_LIST_SEARCH_DEFAULTS)] },
  component: RouteComponent,
});
