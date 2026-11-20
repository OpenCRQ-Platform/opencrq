import { createFileRoute } from '@tanstack/react-router';
import { threatEventFrequencyListSearchSchema } from '../../../../../features/threat-event-frequency/threat-event-frequency-list-search';
import { ThreatEventFrequencyPage } from '../../../../../features';

const RouteComponent = () => {
  const { organizationId } = Route.useParams();
  return <ThreatEventFrequencyPage organizationId={organizationId} />;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/threat-event-frequency/')({
  validateSearch: threatEventFrequencyListSearchSchema,
  component: RouteComponent,
});
