import { t } from '@lingui/core/macro';
import { createFileRoute, stripSearchParams } from '@tanstack/react-router';
import {
  THREAT_LOCATIONS_SECTORS_LIST_SEARCH_DEFAULTS,
  threatLocationsSectorsListSearchSchema,
} from '../../../../../../../features/threats/threat-locations-sectors-list-search';
import { ThreatTargetsTab, useLiveThreatDetail } from '../../../../../../../features';
import { Route as ThreatDetailRoute } from '../$threatId';

const ThreatLocationsSectorsPage = () => {
  const detail = useLiveThreatDetail(ThreatDetailRoute.useLoaderData().detail);
  if (!detail) {
    return null;
  }
  return <ThreatTargetsTab detail={detail} />;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/threat-center/threats/$threatId/locations-sectors')({
  validateSearch: threatLocationsSectorsListSearchSchema,
  search: { middlewares: [stripSearchParams(THREAT_LOCATIONS_SECTORS_LIST_SEARCH_DEFAULTS)] },
  loader: () => ({ crumb: t`Locations & Sectors` }),
  component: ThreatLocationsSectorsPage,
});
