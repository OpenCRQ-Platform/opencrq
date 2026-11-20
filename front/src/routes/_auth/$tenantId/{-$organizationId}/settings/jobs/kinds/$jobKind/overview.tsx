import { t } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { JobOverviewPanel } from '../../../../../../../../features/jobs';

const RouteComponent = () => {
  const { jobKind } = Route.useParams();
  return <JobOverviewPanel kind={jobKind} />;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/jobs/kinds/$jobKind/overview')({
  loader: () => ({ crumb: t`Overview` }),
  component: RouteComponent,
});
