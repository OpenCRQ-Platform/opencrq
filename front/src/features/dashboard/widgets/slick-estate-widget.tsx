import { Skeleton } from '@filigran/ui';
import { Globe, Layers } from 'lucide-react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { SupportingAssetExposure } from '@app/module/client';
import type { FunctionComponent } from 'react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { IconButtonGroupItem } from '../../../components/ui/icon-button-group';
import { MetricInfo } from '../../../components/shared';
import { IconButtonGroup } from '../../../components/ui/icon-button-group';
import { EmptyValue } from '../../../components/ui/empty-value';
import { useTRPC } from '../../../lib';
import { formatFractionAsPercent, getAssetCategoryLabel } from '../../../utils';
import { Caption, Figure, MagnitudeBar, Panel } from '../components/slick-primitives';
import { impactedShare } from '../findings-dashboard-utils';

type EstateAxis = 'exposure' | 'category';

const SKELETON_ROWS = 4;

const getExposureLabel = (exposure: SupportingAssetExposure): string => {
  switch (exposure) {
    case 'internet_facing':
      return t`Internet facing`;
    case 'internal':
      return t`Internal`;
    case 'unknown':
      return t`Unknown`;
  }
};

interface EstateRow {
  id: string,
  label: string,
  assetCount: number,
  impactedAssetCount: number,
  share: number | null,
  /** Internet-facing assets carry the estate's real attack surface, so their row is accented. */
  accent: boolean,
}

/** A group with no assets sorts last rather than first, which `null` would do on its own. */
const shareRank = (row: EstateRow): number => row.share ?? -1;

/*
 * Spelled out as statements, and kept OUTSIDE the component on purpose. The compact
 * `(b.share ?? -1) - (a.share ?? -1) || …` form makes the React Compiler bail with
 * "Unexpected terminal kind `logical` for logical test block": it cannot lower a `??` sitting
 * inside a `||` test. Module scope is not compiled, but the explicit form is clearer regardless.
 */
const compareByShare = (a: EstateRow, b: EstateRow): number => {
  const shareDelta = shareRank(b) - shareRank(a);
  return shareDelta === 0 ? b.assetCount - a.assetCount : shareDelta;
};

interface SlickEstateWidgetProps {
  organizationId?: string,
}

/**
 * How much of the estate is actually affected, sliced by the two attributes that change what a
 * finding means: whether the asset is reachable from the internet, and what kind of asset it is.
 *
 * Rows are ordered by the SHARE impacted rather than by population, which is the whole difference
 * between this and the two count-lists it replaces. "42 servers" answers nothing; "18 of 42
 * internet-facing hosts carry findings" is a decision.
 */
export const SlickEstateWidget: FunctionComponent<SlickEstateWidgetProps> = ({ organizationId }) => {
  const trpc = useTRPC();
  const [axis, setAxis] = useState<EstateAxis>('exposure');
  const { data } = useQuery(trpc.dashboard.getAssetsOverview.queryOptions({ organizationId }));

  const byExposure: Array<EstateRow> = (data?.byExposure ?? []).map((entry) => ({
    id: entry.exposure,
    label: getExposureLabel(entry.exposure),
    assetCount: entry.assetCount,
    impactedAssetCount: entry.impactedAssetCount,
    share: impactedShare(entry.impactedAssetCount, entry.assetCount),
    accent: entry.exposure === 'internet_facing',
  }));
  const byCategory: Array<EstateRow> = (data?.byCategory ?? []).map((entry) => ({
    id: entry.categoryId,
    label: getAssetCategoryLabel(entry.categoryId),
    assetCount: entry.assetCount,
    impactedAssetCount: entry.impactedAssetCount,
    share: impactedShare(entry.impactedAssetCount, entry.assetCount),
    accent: false,
  }));
  // Sorted on a copy: the query cache hands back the same array on every render, and sorting in
  // place would mutate it.
  const rows = [...(axis === 'exposure' ? byExposure : byCategory)].sort(compareByShare);

  const totalAssets = rows.reduce((sum, row) => sum + row.assetCount, 0);
  const totalImpacted = rows.reduce((sum, row) => sum + row.impactedAssetCount, 0);
  const overall = impactedShare(totalImpacted, totalAssets);

  const axisItems: Array<IconButtonGroupItem<EstateAxis>> = [
    { value: 'exposure', icon: <Globe className="h-4 w-4" />, tooltip: t`Split by network reachability` },
    { value: 'category', icon: <Layers className="h-4 w-4" />, tooltip: t`Split by asset category` },
  ];

  return (
    <Panel
      title={<Trans>Estate coverage</Trans>}
      info={
        <MetricInfo
          title={t`Estate coverage`}
          what={<Trans>What share of each slice of the estate carries at least one open finding.</Trans>}
          how={
            <Trans>
              Every supporting asset in scope, grouped by network exposure or by category. The bar
              and the figure are the impacted assets over the total in that group. One asset with
              twelve findings counts the same as one asset with one, because this measures reach, not
              volume. Rows are ordered by share, so the most affected group is first regardless of
              how large it is.
            </Trans>
          }
          caveat={
            <Trans>
              Coverage is not severity: a group at 100% may hold nothing but low findings. Unknown
              exposure is missing data, not a safe default: assets land there when no connector has
              told us whether they are reachable, and they are the group most likely to be
              mis-triaged.
            </Trans>
          }
        />
      }
      action={<IconButtonGroup items={axisItems} value={axis} onChange={setAxis} />}
    >
      {data === undefined ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: SKELETON_ROWS }).map((_, index) => <Skeleton key={index} className="h-9 w-full" />)}
        </div>
      ) : rows.length === 0 ? (
        <p className="txt-sub-content text-muted-foreground py-10 text-center">
          <Trans>No supporting asset in scope.</Trans>
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {rows.map((row) => {
              // Hoisted: an expression inside `<Trans>` has to be a plain identifier for the
              // extractor to produce a stable message id.
              const impacted = row.impactedAssetCount;
              const total = row.assetCount;
              return (
                <div key={row.id} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className={`txt-table min-w-0 truncate ${row.accent ? 'font-semibold' : 'font-medium'}`}>
                      {row.label}
                    </span>
                    <span className="txt-sub-content text-muted-foreground shrink-0">
                      <Figure className={row.accent ? 'text-red-600 dark:text-red-400' : 'text-foreground'}>
                        {row.share === null ? <EmptyValue /> : formatFractionAsPercent(row.share, 1)}
                      </Figure>
                      {' · '}
                      <Trans>{impacted} of {total}</Trans>
                    </span>
                  </div>
                  <MagnitudeBar
                    ratio={row.share ?? 0}
                    className={row.accent ? 'bg-red-600/70 dark:bg-red-400/70' : 'bg-primary/60'}
                  />
                </div>
              );
            })}
          </div>

          <div className="txt-sub-content text-muted-foreground flex items-baseline gap-2 border-t pt-2.5">
            <Caption><Trans>Estate</Trans></Caption>
            <span>
              <Trans>{totalImpacted} of {totalAssets} assets carry findings</Trans>
              {overall !== null && (
                <>
                  {' · '}
                  <Figure>{formatFractionAsPercent(overall, 1)}</Figure>
                </>
              )}
            </span>
          </div>
        </>
      )}
    </Panel>
  );
};
