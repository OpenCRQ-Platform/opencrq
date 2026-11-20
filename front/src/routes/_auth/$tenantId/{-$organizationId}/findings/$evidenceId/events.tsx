import { t } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { ScoreHistoryEvents } from '../../../../../../features/finding-score';

const FindingEventsTab = () => {
  const { evidenceId } = Route.useParams();
  return <ScoreHistoryEvents evidenceId={evidenceId} />;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/findings/$evidenceId/events')({
  loader: () => ({ crumb: t`Events` }),
  component: FindingEventsTab,
});
