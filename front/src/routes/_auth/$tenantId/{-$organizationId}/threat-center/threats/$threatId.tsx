import { t } from '@lingui/core/macro';
import { createFileRoute, linkOptions, notFound, Outlet } from '@tanstack/react-router';
import { RouteTabs } from '../../../../../../components/shared';
import {
  matchedTechniques,
  ThreatHero,
  useLiveThreatDetail,
} from '../../../../../../features';
import { trpcClient } from '../../../../../../lib';

const ThreatDetailLayout = () => {
  const detail = useLiveThreatDetail(Route.useLoaderData().detail);
  if (!detail) {
    return null;
  }

  const tabs = [
    {
      key: 'overview',
      linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/threat-center/threats/$threatId', to: 'overview' }),
      label: t`Overview`,
    },
    {
      key: 'locations-sectors',
      linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/threat-center/threats/$threatId', to: 'locations-sectors' }),
      label: t`Locations & Sectors`,
      count: detail.locations.length + detail.sectors.length,
    },
    {
      key: 'cve',
      linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/threat-center/threats/$threatId', to: 'cve' }),
      label: t`CVE`,
      count: detail.cves.length,
    },
    {
      key: 'ttp',
      linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/threat-center/threats/$threatId', to: 'ttp' }),
      label: t`TTP`,
      count: matchedTechniques(detail.techniques).length,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <ThreatHero detail={detail} />
      <RouteTabs tabs={tabs} />
      <Outlet />
    </div>
  );
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/threat-center/threats/$threatId')({
  loader: async ({ params }) => {
    const detail = await trpcClient.threats.getDetail.query({ id: params.threatId });
    if (!detail) {
      throw notFound();
    }
    return { detail, crumb: detail.analysis.name };
  },
  component: ThreatDetailLayout,
});
