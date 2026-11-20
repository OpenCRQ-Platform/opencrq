import { createFileRoute, stripSearchParams } from '@tanstack/react-router';
import {
  THREAT_EVENT_FREQUENCY_SCOPES_LIST_SEARCH_DEFAULTS,
  threatEventFrequencyScopesListSearchSchema,
} from '../../../../../features/threat-event-frequency/threat-event-frequency-list-search';
import { ThreatEventFrequencyPage } from '../../../../../features';

const RouteComponent = () => {
  const { organizationId } = Route.useParams();
  return <ThreatEventFrequencyPage organizationId={organizationId} tab="scopes" />;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/threat-event-frequency/scopes')({
  validateSearch: threatEventFrequencyScopesListSearchSchema,
  search: { middlewares: [stripSearchParams(THREAT_EVENT_FREQUENCY_SCOPES_LIST_SEARCH_DEFAULTS)] },
  component: RouteComponent,
});
