import { Button } from '@filigran/design-system';
import { useState } from 'react';
import { createFileRoute, linkOptions, notFound, Outlet } from '@tanstack/react-router';
import { t } from '@lingui/core/macro';
import { EntityUnavailable } from '../../../../../../components/layout';
import { ControlIdPill, DetailPageLayout, RouteTabs } from '../../../../../../components/shared';
import { trpcClient } from '../../../../../../lib';
import { CapabilityAssessmentEditDrawer } from '../../../../../../features/controls/capability/components/capability-assessment-edit-drawer';
import { useCapabilityValidation } from '../../../../../../features/controls/capability/hooks/use-capability-validation';
import { isSimulationReachable } from '../../../../../../features/controls/capability/utils/function-posture-utils';

const ControlNotFound = () => (
  <EntityUnavailable
    title={t`Control unavailable`}
    description={t`This control has been deleted or is no longer accessible.`}
    listLabel={t`See all controls`}
    listLink={linkOptions({ from: '/$tenantId/{-$organizationId}/controls/$controlId', to: '..' })}
  />
);

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/controls/$controlId')({
  loader: async ({ params }) => {
    const capability = await trpcClient.controlCapabilities.getControlCapability.query({ id: params.controlId });
    if (!capability) {
      throw notFound();
    }
    return { capability, crumb: `${capability.externalId} - ${capability.name}` };
  },
  notFoundComponent: ControlNotFound,
  component: function CapabilityLayout() {
    const { capability } = Route.useLoaderData();
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);
    // The tab exists as soon as the tenant has a connector: waiting on the derivation would make it
    // appear a second after the page it belongs to.
    const { isAvailable: isValidationVisible } =
      useCapabilityValidation(capability.id, isSimulationReachable(capability));

    const tabs = [
      {
        key: 'overview',
        linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/controls/$controlId', to: 'overview' }),
        label: t`Overview`,
      },
      {
        key: 'prevention',
        linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/controls/$controlId', to: 'prevention' }),
        label: t`Prevention`,
      },
      {
        key: 'detection',
        linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/controls/$controlId', to: 'detection' }),
        label: t`Detection`,
      },
      ...(isValidationVisible
        ? [{
          key: 'validation',
          linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/controls/$controlId', to: 'validation' }),
          label: t`Validation`,
        }]
        : []),
      {
        key: 'risk-scenarios',
        linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/controls/$controlId', to: 'risk-scenarios' }),
        label: t`Risk Scenarios`,
      },
      {
        key: 'events',
        linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/controls/$controlId', to: 'events' }),
        label: t`Events`,
      },
    ];

    return (
      <>
        <DetailPageLayout
          title={capability.name}
          titleLeading={<ControlIdPill externalId={capability.externalId} />}
          actions={<Button onClick={() => setIsDrawerOpen(true)} >{t`Edit`}</Button>}
        >
          <RouteTabs tabs={tabs} />
          <Outlet />
        </DetailPageLayout>

        {isDrawerOpen && (
          <CapabilityAssessmentEditDrawer
            capabilityId={capability.id}
            externalId={capability.externalId}
            name={capability.name}
            onClose={() => setIsDrawerOpen(false)}
          />
        )}
      </>
    );
  },
});
