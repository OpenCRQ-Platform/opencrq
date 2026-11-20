import { Button } from '@filigran/design-system';
import { createFileRoute, linkOptions, Outlet, redirect, useNavigate } from '@tanstack/react-router';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { z } from 'zod';
import type { ScopeDrawerTab } from '../../../../../features/organizations/scope-drawer-tabs';
import { DetailPageLayout, RouteTabs } from '../../../../../components/shared';
import { ScopeDrawer } from '../../../../../features';
import { SCOPE_DRAWER_TABS, tabForAction } from '../../../../../features/organizations/scope-drawer-tabs';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/details')({
  // A bookmark naming a tab this drawer no longer has opens on Details, where an unparsed search
  // param would strand the reader on the router's error page.
  validateSearch: z.object({ scopeDrawerTab: z.enum(SCOPE_DRAWER_TABS).optional().catch(undefined) }),
  loader: ({ params }) => {
    if (params.organizationId === undefined) {
      throw redirect({ to: '/$tenantId/{-$organizationId}', params: { tenantId: params.tenantId } });
    }
    return { crumb: t`Details` };
  },
  component: function OrganizationDetailsLayout() {
    const { organizationId } = Route.useParams();
    const { scopeDrawerTab } = Route.useSearch();
    const navigate = useNavigate();

    // The drawer's open state lives in the address bar so any surface of the scope can open it on
    // its own tab by navigating here.
    const setOpenTab = (tab: ScopeDrawerTab | undefined) => {
      void navigate({ to: '.', search: (prev) => ({ ...prev, scopeDrawerTab: tab }), replace: true });
    };

    const tabs = [
      {
        key: 'overview',
        linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/details', to: 'overview' }),
        label: t`Overview`,
      },
      {
        key: 'financial-profile',
        linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/details', to: 'financial-profile' }),
        label: t`Financial profile`,
      },
      {
        key: 'declared-estate',
        linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/details', to: 'declared-estate' }),
        label: t`Declared estate`,
      },
      {
        key: 'loss-driver',
        linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/details', to: 'loss-driver' }),
        label: t`Loss Driver`,
      },
      {
        key: 'events',
        linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/details', to: 'events' }),
        label: t`Events`,
      },
    ];

    return (
      <DetailPageLayout
        title={t`Risk scope details`}
        actions={organizationId && (
          <Button onClick={() => setOpenTab(tabForAction('edit'))}><Trans>Edit</Trans></Button>
        )}
      >
        <RouteTabs tabs={tabs} />
        <Outlet />
        {organizationId !== undefined && (
          <ScopeDrawer
            organizationId={organizationId}
            initialTab={scopeDrawerTab ?? tabForAction('edit')}
            open={scopeDrawerTab !== undefined}
            onClose={() => setOpenTab(undefined)}
          />
        )}
      </DetailPageLayout>
    );
  },
});
