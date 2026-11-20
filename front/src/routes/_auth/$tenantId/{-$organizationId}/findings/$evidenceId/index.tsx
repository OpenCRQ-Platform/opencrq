import { createFileRoute, redirect } from '@tanstack/react-router';
import { trpcClient } from '../../../../../../lib';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/findings/$evidenceId/')({
  // Only the CVE dossier is tabbed. A technique-expectation finding renders whole at the bare URL,
  // so sending it to a tab would name a page it does not have.
  loader: async ({ params }) => {
    const finding = await trpcClient.supportingAssets.getEvidenceDetail.query({ evidenceId: params.evidenceId });
    if (finding?.cveId != null) {
      throw redirect({ from: '/$tenantId/{-$organizationId}/findings/$evidenceId', to: 'overview' });
    }
  },
});
