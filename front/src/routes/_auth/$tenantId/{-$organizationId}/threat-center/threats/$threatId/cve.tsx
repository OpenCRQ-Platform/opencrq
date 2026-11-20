import { t } from '@lingui/core/macro';
import { createFileRoute, stripSearchParams } from '@tanstack/react-router';
import { ThreatCveFindingsTab, useLiveThreatDetail } from '../../../../../../../features';
import {
  THREAT_CVE_FINDINGS_LIST_SEARCH_DEFAULTS,
  threatCveFindingsListSearchSchema,
} from '../../../../../../../features/threats/threat-cve-findings-list-search';
import { Route as ThreatDetailRoute } from '../$threatId';

const ThreatCvesPage = () => {
  const detail = useLiveThreatDetail(ThreatDetailRoute.useLoaderData().detail);
  if (!detail) {
    return null;
  }
  return <ThreatCveFindingsTab threatId={detail.analysis.id} sourceKind={detail.origin.kind} />;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/threat-center/threats/$threatId/cve')({
  validateSearch: threatCveFindingsListSearchSchema,
  search: { middlewares: [stripSearchParams(THREAT_CVE_FINDINGS_LIST_SEARCH_DEFAULTS)] },
  loader: () => ({ crumb: t`CVE` }),
  component: ThreatCvesPage,
});
