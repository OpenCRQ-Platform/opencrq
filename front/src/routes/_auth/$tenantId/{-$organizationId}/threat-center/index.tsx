import { createFileRoute, stripSearchParams } from '@tanstack/react-router';
import {
  THREAT_ANALYSES_LIST_SEARCH_DEFAULTS,
  threatAnalysesListSearchSchema,
} from '../../../../../features/threats/threat-analyses-list-search';
import { ThreatAnalysesDataTable } from '../../../../../features';

const RouteComponent = () => <ThreatAnalysesDataTable />;

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/threat-center/')({
  validateSearch: threatAnalysesListSearchSchema,
  search: { middlewares: [stripSearchParams(THREAT_ANALYSES_LIST_SEARCH_DEFAULTS)] },
  component: RouteComponent,
});
