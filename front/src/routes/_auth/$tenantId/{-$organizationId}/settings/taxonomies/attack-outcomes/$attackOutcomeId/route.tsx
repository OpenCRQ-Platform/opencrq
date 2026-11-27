import { t } from '@lingui/core/macro';
import { createFileRoute, linkOptions, notFound, Outlet } from '@tanstack/react-router';
import { EntityUnavailable } from '../../../../../../../../components/layout';
import { trpcClient } from '../../../../../../../../lib';
import { DetailPageLayout, RouteTabs } from '../../../../../../../../components/shared';

const AttackOutcomeNotFound = () => (
  <EntityUnavailable
    title={t`Attack outcome unavailable`}
    description={t`This attack outcome has been deleted or is no longer accessible.`}
    listLabel={t`See all attack outcomes`}
    listLink={linkOptions({ from: '/$tenantId/{-$organizationId}/settings/taxonomies/attack-outcomes/$attackOutcomeId', to: '..' })}
  />
);

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/taxonomies/attack-outcomes/$attackOutcomeId')({
  loader: async ({ params }) => {
    const attackOutcome = await trpcClient.attackOutcomes.getAttackOutcome.query({ id: params.attackOutcomeId });
    if (!attackOutcome) {
      throw notFound();
    }
    return { attackOutcome, crumb: attackOutcome.name };
  },
  notFoundComponent: AttackOutcomeNotFound,
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
