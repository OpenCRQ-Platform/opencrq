import { t } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { ThreatOverview, useLiveThreatDetail } from '../../../../../../../features';
import { Route as ThreatDetailRoute } from '../$threatId';

const ThreatOverviewPage = () => {
  const detail = useLiveThreatDetail(ThreatDetailRoute.useLoaderData().detail);
  return detail ? <ThreatOverview detail={detail} /> : null;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/threat-center/threats/$threatId/overview')({
  loader: () => ({ crumb: t`Overview` }),
  component: ThreatOverviewPage,
});
