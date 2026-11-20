import { t } from '@lingui/core/macro';
import { createFileRoute, stripSearchParams } from '@tanstack/react-router';
import {
  THREAT_TECHNIQUES_LIST_SEARCH_DEFAULTS,
  threatTechniquesListSearchSchema,
} from '../../../../../../../features/threats/threat-techniques-list-search';
import { ThreatTtpsTab, useLiveThreatDetail } from '../../../../../../../features';
import { Route as ThreatDetailRoute } from '../$threatId';

const ThreatTtpsPage = () => {
  const detail = useLiveThreatDetail(ThreatDetailRoute.useLoaderData().detail);
  return detail ? <ThreatTtpsTab detail={detail} /> : null;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/threat-center/threats/$threatId/ttp')({
  validateSearch: threatTechniquesListSearchSchema,
  search: { middlewares: [stripSearchParams(THREAT_TECHNIQUES_LIST_SEARCH_DEFAULTS)] },
  loader: () => ({ crumb: t`TTP` }),
  component: ThreatTtpsPage,
});
