import { createFileRoute, notFound } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ComplianceAssessmentPage } from '../../../../../../features/compliance-assessments';
import { trpcClient, useTRPC } from '../../../../../../lib';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/compliance/assessments/$assessmentId')({
  loader: async ({ params }) => {
    const assessment = await trpcClient.complianceAssessments.getAssessment.query({ id: params.assessmentId });
    if (!assessment) {
      throw notFound();
    }
    return { assessment, crumb: assessment.name };
  },
  component: function ComplianceAssessmentRoute() {
    const trpc = useTRPC();
    const { assessment: initialData } = Route.useLoaderData();
    // The loader only seeds the first paint: an answer saved on this page reaches it through the query.
    const { data: assessment } = useQuery(trpc.complianceAssessments.getAssessment.queryOptions(
      { id: initialData.id },
      { initialData },
    ));
    if (!assessment) {
      throw notFound();
    }
    return <ComplianceAssessmentPage assessment={assessment} />;
  },
});
