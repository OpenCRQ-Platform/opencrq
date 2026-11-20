import { t } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { AttackOutcomeTtps } from '../../../../../../../../features';

const AttackOutcomeTtpTab = () => {
  const { attackOutcomeId } = Route.useParams();
  return <AttackOutcomeTtps attackOutcomeId={attackOutcomeId} />;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/taxonomies/attack-outcomes/$attackOutcomeId/ttp')({
  loader: () => ({ crumb: t`TTP` }),
  component: AttackOutcomeTtpTab,
});
