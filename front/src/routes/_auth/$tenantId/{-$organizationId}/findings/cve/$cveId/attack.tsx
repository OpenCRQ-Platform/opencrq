import { t } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { AttackSection } from '../../../../../../../features/finding-detail';
import { uniqueAttackClaimRows, uniqueAttackCoverage } from '../../../../../../../features/unique-cve-finding';
import { useTRPC } from '../../../../../../../lib';

const UniqueCveFindingAttackTab = () => {
  const trpc = useTRPC();
  const { tenantId, organizationId, cveId } = Route.useParams();
  const { data: attack } = useQuery(trpc.findingScore.getUniqueCveFindingAttack.queryOptions({ cveId, organizationId: organizationId ?? null }));

  if (!attack) {
    return null;
  }

  return (
    <AttackSection
      cveId={cveId}
      tenantId={tenantId}
      techniques={{ state: 'resolved', rows: uniqueAttackClaimRows(attack) }}
      coverage={uniqueAttackCoverage(cveId, attack)}
    />
  );
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/findings/cve/$cveId/attack')({
  loader: () => ({ crumb: t`Attack` }),
  component: UniqueCveFindingAttackTab,
});
