import { Chip } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import type { RankedRow } from '../components/slick-primitives';
import { MetricInfo } from '../../../components/shared';
import { AssetName } from '../../../components/shared/asset-name';
import { useTRPC } from '../../../lib';
import { getAssetCriticalityLabel } from '../../../utils';
import { Panel, RankedList } from '../components/slick-primitives';

interface SlickExposedAssetsWidgetProps {
  organizationId?: string,
}

/**
 * Where the findings are concentrated, per asset.
 *
 * The server ranks these by a weighted triage score. That score is deliberately NOT the figure on
 * the row: a bare "1 240" is unreadable and unauditable. The row shows the two counts the score is
 * built from, the bar carries the ordering, and the "i" states the formula in full so the ranking
 * can be checked rather than trusted.
 */
export const SlickExposedAssetsWidget: FunctionComponent<SlickExposedAssetsWidgetProps> = ({ organizationId }) => {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const { data } = useQuery(trpc.dashboard.getAssetsOverview.queryOptions({ organizationId }));

  const assets = data?.topAssets ?? [];
  const peak = Math.max(...assets.map((asset) => asset.score), 0);

  const rows: Array<RankedRow> = assets.map((asset) => {
    const total = asset.applicableCount;
    return {
      id: asset.id,
      label: <AssetName name={asset.name} derivedName={asset.derivedName} />,
      value: String(asset.criticalOrHighCount),
      valueMeta: t`of ${total} findings`,
      ratio: peak > 0 ? asset.score / peak : null,
      meta: (
        <span className="flex shrink-0 items-center gap-1">
          <Chip label={getAssetCriticalityLabel(asset.criticality)} />
          <span className="txt-mini text-muted-foreground">
            <Trans>critical / high</Trans>
          </span>
        </span>
      ),
      onClick: () => {
        void navigate({
          to: '/$tenantId/{-$organizationId}/assets/$supportingAssetId/findings',
          params: (prev) => ({ tenantId: prev.tenantId ?? '', supportingAssetId: asset.id }),
        });
      },
    };
  });

  return (
    <Panel
      title={<Trans>Where findings concentrate</Trans>}
      info={
        <MetricInfo
          title={t`Where findings concentrate`}
          what={<Trans>The assets carrying the most, and the most serious, open findings.</Trans>}
          how={
            <Trans>
              Ranked by a triage score, which the bar shows: each finding on the asset scores by
              severity (critical 10, high 5, medium 2, low 1, unscored 1), doubled if the CVE is
              known to be exploited, summed, then multiplied by the asset's criticality, 3 for
              high down to 1 for low or unknown. The figure on the row is the plain count of critical
              and high findings, out of the asset's total. Select a row to open its findings.
            </Trans>
          }
          caveat={
            <Trans>
              The score is a triage heuristic, not a loss estimate: its weights are conventions, so
              treat close scores as equivalent and only act on clear separations. Assets appear here
              through their risk scope's primary assets and up to five levels of provider
              dependency, so a shared platform can surface under several risk scopes.
            </Trans>
          }
        />
      }
    >
      <RankedList
        rows={rows}
        isLoading={data === undefined}
        empty={<Trans>No asset with active findings.</Trans>}
        barClassName="bg-primary/60"
      />
    </Panel>
  );
};
