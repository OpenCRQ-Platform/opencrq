import { t } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { UniqueFindingEvents } from '../../../../../../../features/unique-cve-finding';

const UniqueCveFindingEventsTab = () => {
  const { cveId, organizationId } = Route.useParams();
  return <UniqueFindingEvents cveId={cveId} organizationId={organizationId ?? null} />;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/findings/cve/$cveId/events')({
  loader: () => ({ crumb: t`Events` }),
  component: UniqueCveFindingEventsTab,
});
