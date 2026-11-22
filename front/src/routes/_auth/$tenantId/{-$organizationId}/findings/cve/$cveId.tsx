import { t } from '@lingui/core/macro';
import { createFileRoute, linkOptions, notFound, Outlet } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { scopePath } from '../../../../../../components/layout/scope-path-utils';
import { RouteTabs } from '../../../../../../components/shared';
import { UniqueCveFindingHeader } from '../../../../../../features/unique-cve-finding';
import { trpcClient, useTRPC } from '../../../../../../lib';
import { XtmConnectActions, XtmCounterpartPivots } from '../../../../../../features/xtm/xtm-counterparts';

const UNIQUE_CVE_FINDING_ROUTE = '/$tenantId/{-$organizationId}/findings/cve/$cveId';

const UniqueCveFindingLayout = () => {
  const trpc = useTRPC();
  const { tenantId, organizationId, cveId } = Route.useParams();
  const { finding: initialData } = Route.useLoaderData();
  const { data: finding } = useQuery(trpc.findingScore.getUniqueCveFinding.queryOptions(
    { cveId, organizationId: organizationId ?? null },
    { initialData },
  ));

  if (!finding) {
    return null;
  }

  const tabs = [
    { key: 'overview', label: t`Overview`, linkOption: linkOptions({ from: UNIQUE_CVE_FINDING_ROUTE, to: 'overview' }) },
    { key: 'assets', label: t`Assets`, linkOption: linkOptions({ from: UNIQUE_CVE_FINDING_ROUTE, to: 'assets' }) },
    { key: 'attack', label: t`Attack`, linkOption: linkOptions({ from: UNIQUE_CVE_FINDING_ROUTE, to: 'attack' }) },
    { key: 'remediation', label: t`Remediation`, linkOption: linkOptions({ from: UNIQUE_CVE_FINDING_ROUTE, to: 'remediation' }) },
    { key: 'events', label: t`Events`, linkOption: linkOptions({ from: UNIQUE_CVE_FINDING_ROUTE, to: 'events' }) },
  ];

  return (
    <div className="flex flex-col gap-6">
      <UniqueCveFindingHeader
        tenantId={tenantId}
        cveId={finding.cveId}
        cveTitle={finding.cveTitle}
        score={finding.score}
        band={finding.band}
        worstScore={finding.worstScore}
        worstBand={finding.worstBand}
        pendingVector={finding.pendingVector}
        affectedAssetCount={finding.affectedAssetCount}
        knownExploited={finding.knownExploited}
        epss={finding.epss}
        sources={finding.sources}
        composition={finding.composition}
        actions={(
          <>
            {/* The same CVE in OpenCTI (vulnerability, its threats) and OpenAEV (findings, simulations). */}
            <XtmCounterpartPivots kind="VULNERABILITY" objectKey={finding.cveId} />
            <XtmConnectActions />
          </>
        )}
      />
      <RouteTabs tabs={tabs} />
      <Outlet />
    </div>
  );
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/findings/cve/$cveId')({
  loader: async ({ params }) => {
    const finding = await trpcClient.findingScore.getUniqueCveFinding.query({
      cveId: params.cveId,
      organizationId: params.organizationId ?? null,
    });
    if (!finding) {
      throw notFound();
    }
    // The Unique findings tab lists this page's row but sits on a sibling path, not a parent one.
    const ancestorCrumbs = [{ label: t`Unique findings`, to: scopePath(params.tenantId, params.organizationId, 'findings/unique') }];
    return { finding, ancestorCrumbs, crumb: finding.cveId };
  },
  component: UniqueCveFindingLayout,
});
