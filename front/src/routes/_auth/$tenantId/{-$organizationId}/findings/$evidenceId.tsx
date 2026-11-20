import { createFileRoute, notFound } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { CveFindingDossier, TechniqueExpectationFindingPage } from '../../../../../features/finding-detail';
import { getFindingTitle } from '../../../../../features/supporting-assets/finding-title';
import { trpcClient, useTRPC } from '../../../../../lib';

const FindingDetailLayout = () => {
  const trpc = useTRPC();
  const { evidenceId, tenantId } = Route.useParams();
  const { finding: initialData } = Route.useLoaderData();
  const { data: finding } = useQuery(trpc.supportingAssets.getEvidenceDetail.queryOptions({ evidenceId }, { initialData }));

  if (!finding) {
    return null;
  }

  return finding.cveId === null
    ? <TechniqueExpectationFindingPage evidenceId={evidenceId} tenantId={tenantId} />
    : <CveFindingDossier evidenceId={evidenceId} tenantId={tenantId} cveId={finding.cveId} />;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/findings/$evidenceId')({
  loader: async ({ params }) => {
    const finding = await trpcClient.supportingAssets.getEvidenceDetail.query({ evidenceId: params.evidenceId });
    if (!finding) {
      throw notFound();
    }
    return { finding, crumb: getFindingTitle(finding) };
  },
  component: FindingDetailLayout,
});
