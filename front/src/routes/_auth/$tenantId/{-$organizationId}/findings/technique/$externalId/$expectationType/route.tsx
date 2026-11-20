import { t } from '@lingui/core/macro';
import { createFileRoute, linkOptions, notFound, Outlet, redirect } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { RouteTabs } from '../../../../../../../../components/shared';
import { parseVulnerabilityToken, vulnerabilityFilterLabel } from '../../../../../../../../features/findings-home/vulnerability-filter-utils';
import { canonicalExternalIdHref } from '../../../../../../../../features/mitre-attack/external-id-path-utils';
import { UniqueTechniqueFindingHeaderPanel } from '../../../../../../../../features/unique-technique-finding';
import { trpcClient, useTRPC } from '../../../../../../../../lib';

const UNIQUE_TECHNIQUE_FINDING_ROUTE = '/$tenantId/{-$organizationId}/findings/technique/$externalId/$expectationType';

const UniqueTechniqueFindingLayout = () => {
  const trpc = useTRPC();
  const { organizationId } = Route.useParams();
  const { finding: initialData } = Route.useLoaderData();
  const { data: finding } = useQuery(trpc.findingScore.getUniqueTechniqueFinding.queryOptions(
    { externalId: initialData.externalId, expectationType: initialData.expectationType, organizationId: organizationId ?? null },
    { initialData },
  ));

  if (!finding) {
    return null;
  }

  const tabs = [
    { key: 'overview', label: t`Overview`, linkOption: linkOptions({ from: UNIQUE_TECHNIQUE_FINDING_ROUTE, to: 'overview' }) },
    { key: 'assets', label: t`Assets`, linkOption: linkOptions({ from: UNIQUE_TECHNIQUE_FINDING_ROUTE, to: 'assets' }) },
  ];

  return (
    <div className="flex flex-col gap-6">
      <UniqueTechniqueFindingHeaderPanel
        externalId={finding.externalId}
        name={finding.name}
        expectationType={finding.expectationType}
        affectedAssetCount={finding.affectedAssetCount}
        platforms={finding.platforms}
        sources={finding.sources}
      />
      <RouteTabs tabs={tabs} />
      <Outlet />
    </div>
  );
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/findings/technique/$externalId/$expectationType')({
  beforeLoad: ({ params, location }) => {
    const href = canonicalExternalIdHref(location, params.externalId);
    if (href !== null) {
      throw redirect({ href, replace: true });
    }
  },
  loader: async ({ params }) => {
    const filter = parseVulnerabilityToken(`${params.externalId}:${params.expectationType}`);
    if (filter?.kind !== 'technique') {
      throw notFound();
    }
    const finding = await trpcClient.findingScore.getUniqueTechniqueFinding.query({
      externalId: filter.externalId,
      expectationType: filter.expectationType,
      organizationId: params.organizationId ?? null,
    });
    if (!finding) {
      throw notFound();
    }
    return { finding, crumb: vulnerabilityFilterLabel(filter) };
  },
  component: UniqueTechniqueFindingLayout,
});
