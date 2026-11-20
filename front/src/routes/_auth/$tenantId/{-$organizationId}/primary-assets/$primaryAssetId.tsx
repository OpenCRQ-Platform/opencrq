import { Button } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { createFileRoute, linkOptions, Outlet, redirect } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PrimaryAssetUpdateSheet } from '../../../../../features';
import { riskScopeHref } from '../../../../../features/organizations/scope-path-utils';
import { DetailPageLayout, RouteTabs } from '../../../../../components/shared';
import { trpcClient, useTRPC } from '../../../../../lib';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/primary-assets/$primaryAssetId')({
  loader: async ({ params, location }) => {
    const primaryAsset = await trpcClient.primaryAssets.getPrimaryAsset.query({ id: params.primaryAssetId });
    if (!primaryAsset) {
      throw redirect({
        to: '/$tenantId/{-$organizationId}/primary-assets',
        params: { tenantId: params.tenantId, organizationId: params.organizationId },
      });
    }
    // A tenant address is left to the parent route, which sends it to the tenant home.
    if (params.organizationId !== undefined && primaryAsset.organizationId !== params.organizationId) {
      throw redirect({ href: riskScopeHref(location, params.tenantId, params.organizationId, primaryAsset.organizationId) });
    }
    return { primaryAsset, crumb: primaryAsset.name };
  },
  component: function PrimaryAssetLayout() {
    const trpc = useTRPC();
    const { primaryAsset: initialData } = Route.useLoaderData();
    const [showUpdateSheet, setShowUpdateSheet] = useState(false);

    const { data: primaryAsset } = useQuery(trpc.primaryAssets.getPrimaryAsset.queryOptions(
      { id: initialData.id },
      { initialData },
    ));

    if (!primaryAsset) {
      return null;
    }

    const tabs = [
      {
        key: 'overview',
        linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/primary-assets/$primaryAssetId', to: 'overview' }),
        label: t`Overview`,
      },
      {
        key: 'dependencies',
        linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/primary-assets/$primaryAssetId', to: 'dependencies' }),
        label: t`Business dependencies`,
      },
    ];

    return (
      <>
        <DetailPageLayout
          title={primaryAsset.name}
          titleLeading={primaryAsset.reference !== null && (
            <span className="txt-title shrink-0 text-muted-foreground">{primaryAsset.reference}</span>
          )}
          actions={<Button onClick={() => setShowUpdateSheet(true)}><Trans>Edit</Trans></Button>}
        >
          <RouteTabs tabs={tabs} />
          <Outlet />
        </DetailPageLayout>

        {showUpdateSheet && (
          <PrimaryAssetUpdateSheet
            primaryAssetId={primaryAsset.id}
            open={showUpdateSheet}
            onClose={() => setShowUpdateSheet(false)}
          />
        )}
      </>
    );
  },
});
