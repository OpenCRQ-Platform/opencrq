import { t } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { JobRunsPanel } from '../../../../../../../../features/jobs';

const RouteComponent = () => {
  const { jobKind } = Route.useParams();
  return <JobRunsPanel kind={jobKind} />;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/jobs/kinds/$jobKind/runs')({
  loader: () => ({ crumb: t`Runs` }),
  component: RouteComponent,
});
