import { t } from '@lingui/core/macro';
import { createFileRoute, linkOptions, notFound, Outlet } from '@tanstack/react-router';
import { trpcClient } from '../../../../../../../../lib';
import { DetailPageLayout, RouteTabs } from '../../../../../../../../components/shared';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/taxonomies/attack-outcomes/$attackOutcomeId')({
  loader: async ({ params }) => {
    const attackOutcome = await trpcClient.attackOutcomes.getAttackOutcome.query({ id: params.attackOutcomeId });
    if (!attackOutcome) {
      throw notFound();
    }
    return { attackOutcome, crumb: attackOutcome.name };
  },
  component: function AttackOutcomeLayout() {
    const { attackOutcome } = Route.useLoaderData();

    const tabs = [
      {
        key: 'overview',
        linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/settings/taxonomies/attack-outcomes/$attackOutcomeId', to: 'overview' }),
        label: t`Overview`,
      },
      {
        key: 'ttp',
        linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/settings/taxonomies/attack-outcomes/$attackOutcomeId', to: 'ttp' }),
        label: t`TTP`,
      },
    ];

    return (
      <DetailPageLayout title={attackOutcome.name}>
        <RouteTabs tabs={tabs} />
        <Outlet />
      </DetailPageLayout>
    );
  },
});
