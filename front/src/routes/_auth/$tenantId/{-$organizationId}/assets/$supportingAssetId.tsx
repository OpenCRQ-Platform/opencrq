import { Button } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { createFileRoute, linkOptions, notFound, Outlet } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { XtmCounterpart, XtmProduct } from '../../../../../features/xtm/xtm-counterparts';
import { RouteTabs } from '../../../../../components/shared';
import { AssetActionsMenu, AssetHeaderPanel, assetManualAttributeLabel, AssetResyncAction, manualPropertyFieldLabels } from '../../../../../features/supporting-assets';
import { SupportingAssetUpdateSheet } from '../../../../../features';
import { canResyncWithConnectors } from '../../../../../features/supporting-assets/connectors-utils';
import { sourceExternalUrl } from '../../../../../features/supporting-assets/source-external-url';
import { trpcClient, useTRPC } from '../../../../../lib';
import { assetNameText } from '../../../../../utils/asset-name-utils';
import { XTM_PRODUCTS, XtmPivotEmblems } from '../../../../../features/xtm/xtm-counterparts';

const assetHostname = (properties: unknown): string | null => {
  const hostname = typeof properties === 'object' && properties !== null && 'hostname' in properties ? properties.hostname : null;
  return typeof hostname === 'string' && hostname.length > 0 ? hostname : null;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/assets/$supportingAssetId')({
  loader: async ({ params }) => {
    const supportingAsset = await trpcClient.supportingAssets.getSupportingAsset.query({ id: params.supportingAssetId });
    if (!supportingAsset) {
      throw notFound();
    }
    return { supportingAsset, crumb: assetNameText(supportingAsset, t`Unnamed asset`) };
  },
  component: function SupportingAssetLayout() {
    const trpc = useTRPC();
    const { tenantId } = Route.useParams();
    const { supportingAsset: initialData } = Route.useLoaderData();
    const [showUpdateSheet, setShowUpdateSheet] = useState(false);

    const { data: supportingAsset } = useQuery(trpc.supportingAssets.getSupportingAsset.queryOptions(
      { id: initialData.id },
      { initialData },
    ));
    const { data: techniqueCounts } = useQuery(trpc.supportingAssets.getTechniqueCountPerCategory.queryOptions());
    const { data: crqPosture } = useQuery(trpc.findingScore.getAssetPosture.queryOptions({ supportingAssetId: initialData.id }));
    const { data: openaevPosture } = useQuery(trpc.supportingAssets.getOpenaevPosture.queryOptions(
      { supportingAssetId: initialData.id },
      { staleTime: 60_000 },
    ));
    const { data: connectors } = useQuery(trpc.connectors.listConnectors.queryOptions());

    if (!supportingAsset) {
      return null;
    }

    // Techniques are attached to the category, not to the asset: the tile is labelled accordingly.
    const ttpCount = (techniqueCounts ?? []).find((r) => r.categoryId === supportingAsset.categoryId)?.techniqueCount ?? 0;
    const sources = supportingAsset.sources.flatMap((s) => (s.source ? [s.source] : []));
    const hostname = assetHostname(supportingAsset.properties);
    // A product the asset came from is found from its source link first; the hostname lookup is the fallback.
    const sourced: Partial<Record<XtmProduct, XtmCounterpart>> = {};
    for (const product of XTM_PRODUCTS) {
      const row = supportingAsset.sources.find((s) => s.source === product);
      const connectorUrl = connectors?.find((c) => c.source === product)?.url ?? null;
      const objectUrl = row ? sourceExternalUrl(row.source, row.sourceAssetId, connectorUrl, row.reportedCategoryId) : null;
      if (row && objectUrl !== null) {
        sourced[product] = {
          key: hostname ?? row.sourceAssetId,
          product,
          objectId: row.sourceAssetId,
          objectType: t`Asset`,
          objectName: row.reportedName ?? hostname,
          objectUrl,
          facts: [],
        };
      }
    }
    const manualFields = [
      ...supportingAsset.manualValues.map((v) => assetManualAttributeLabel(v.attribute)),
      ...manualPropertyFieldLabels(supportingAsset.manualProperties),
    ];

    const tabs = [
      {
        key: 'overview',
        linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/assets/$supportingAssetId', to: 'overview' }),
        label: t`Overview`,
      },
      {
        key: 'ttp',
        linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/assets/$supportingAssetId', to: 'ttp' }),
        label: t`TTP`,
      },
      {
        key: 'protected-by',
        linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/assets/$supportingAssetId', to: 'protected-by' }),
        label: t`Protected by`,
      },
      {
        key: 'findings',
        linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/assets/$supportingAssetId', to: 'findings' }),
        label: t`Findings`,
      },
      {
        key: 'dependencies',
        linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/assets/$supportingAssetId', to: 'dependencies' }),
        label: t`Business dependencies`,
      },
      {
        key: 'access-relations',
        linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/assets/$supportingAssetId', to: 'access-relations' }),
        label: t`Access relations`,
      },
      {
        key: 'events',
        linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/assets/$supportingAssetId', to: 'events' }),
        label: t`Events`,
      },
    ];

    return (
      <>
        <div className="flex flex-col gap-6">
          <AssetHeaderPanel
            tenantId={tenantId}
            supportingAssetId={supportingAsset.id}
            assetName={supportingAsset}
            categoryId={supportingAsset.categoryId}
            subcategoryId={supportingAsset.subcategoryId}
            criticality={supportingAsset.criticality}
            exposure={supportingAsset.exposure}
            applicableEvidenceCount={supportingAsset.applicableEvidenceCount}
            ttpCount={ttpCount}
            sources={sources}
            postureCounts={openaevPosture ?? null}
            crqPosture={crqPosture}
            actions={
              <>
                {/* First in the row: the same machine in the XTM One inventory, OpenCTI (System, Hostname) and OpenAEV (asset): source link first, hostname second. */}
                <XtmPivotEmblems kind="ASSET" objectKey={hostname} sourced={sourced} />
                <AssetResyncAction
                  supportingAssetId={supportingAsset.id}
                  canResync={canResyncWithConnectors(manualFields.length, supportingAsset.sources)}
                  manualFields={manualFields}
                />
                <Button onClick={() => setShowUpdateSheet(true)}><Trans>Edit</Trans></Button>
                <AssetActionsMenu supportingAssetId={supportingAsset.id} />
              </>
            }
          />
          <RouteTabs tabs={tabs} />
          <Outlet />
        </div>

        {showUpdateSheet && (
          <SupportingAssetUpdateSheet
            supportingAssetId={supportingAsset.id}
            open={showUpdateSheet}
            onClose={() => setShowUpdateSheet(false)}
          />
        )}
      </>
    );
  },
});
