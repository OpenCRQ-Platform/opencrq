import { Text } from '@filigran/design-system';
import { Skeleton } from '@filigran/ui';
import type { AssetCategory } from '@app/module/client';
import { UNCLASSIFIED_ASSET_CATEGORY } from '@app/module/client';
import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import type { AssetMix, CategoryShare } from '../asset-mix-utils';
import { MetricInfo, TooltipHint, TooltipHintProvider } from '../../../components/shared';
import { useTRPC } from '../../../lib';
import { getAssetCategoryLabel, getAssetSubcategoryLabel } from '../../../utils';
import { assetDomain, assetDomainColor, formatWholePercent } from '../../asset-dependencies/dependency-graph-utils';
import { formatNumber } from '../../../utils/format-number';
import { groupAssetMix, subcategoryShadePercent } from '../asset-mix-utils';
import { DashboardWidgetCard } from '../components/dashboard-widget-card';

const categoryInk = (categoryId: AssetCategory): string => assetDomainColor(assetDomain(categoryId));

/* eslint-disable lingui/no-unlocalized-strings -- CSS values, not copy */
/** Below 34rem the two fixed tracks would leave the bar no width, so the bar drops under its label. */
const ROW_GRID = [
  'grid items-center gap-x-4 gap-y-1',
  "grid-cols-[minmax(0,1fr)_auto] [grid-template-areas:'label_count'_'bar_bar']",
  "@min-[34rem]:grid-cols-[13.5rem_minmax(0,1fr)_6.5rem] @min-[34rem]:[grid-template-areas:'label_bar_count']",
].join(' ');
const BAR_CELL = 'flex h-7 [grid-area:bar]';
const inkAt = (ink: string, percent: number): string => `color-mix(in srgb, ${ink} ${percent}%, transparent)`;
const hatched = (ink: string): string => `repeating-linear-gradient(135deg, ${inkAt(ink, 70)} 0 2px, ${inkAt(ink, 12)} 2px 6px)`;
/* eslint-enable lingui/no-unlocalized-strings */

const barWidth = (assetCount: number, largest: number): string => `${(assetCount / largest) * 100}%`;

const formatShare = (share: number, locale: string): string => (share < 0.01
  ? i18n._({ id: 'Under {percent}', message: '< {percent}', values: { percent: formatWholePercent(0.01, locale) } })
  : formatWholePercent(share, locale));

const CountCell: FunctionComponent<{ assetCount: number, total: number, locale: string }> = ({ assetCount, total, locale }) => (
  <span className="flex items-baseline justify-end gap-2 tabular-nums [grid-area:count]">
    <Text as="span" variant="content-compact-medium">{formatNumber(assetCount, locale)}</Text>
    <Text as="span" variant="content-caption" className="w-12 text-right text-default-secondary">{formatShare(assetCount / total, locale)}</Text>
  </span>
);

const CategoryRow: FunctionComponent<{ category: CategoryShare, mix: AssetMix, locale: string }> = ({ category, mix, locale }) => {
  const ink = categoryInk(category.categoryId);
  const namedCount = category.subcategories.filter((sub) => sub.subcategoryId !== null).length;
  const categoryLabel = getAssetCategoryLabel(category.categoryId);
  return (
    <li className={ROW_GRID}>
      <Text as="span" variant="content-compact-medium" className="[grid-area:label]">{categoryLabel}</Text>
      <span className={BAR_CELL}>
        <span className="flex h-full gap-0.5 overflow-hidden rounded-[var(--fds-radius-sm)]" style={{ width: barWidth(category.assetCount, mix.largest) }}>
          {category.subcategories.map(({ subcategoryId, assetCount }, index) => {
            const label = subcategoryId === null ? t`Not specified` : getAssetSubcategoryLabel(subcategoryId);
            const count = formatNumber(assetCount, locale);
            const hint = i18n._({ id: 'Assets of a subcategory', message: '{categoryLabel} > {label}: {assetCount, plural, one {# asset} other {# assets}}', values: { categoryLabel, label, assetCount } });
            return (
              <TooltipHint key={subcategoryId ?? 'unspecified'} hint={hint}>
                <span
                  role="img"
                  aria-label={hint}
                  tabIndex={0}
                  className="@container flex min-w-[3px] items-center overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
                  style={{
                    flex: `${assetCount} 1 0`,
                    background: subcategoryId === null ? hatched(ink) : inkAt(ink, subcategoryShadePercent(index, namedCount)),
                  }}
                >
                  <Text as="span" variant="content-caption" className="truncate px-2 [visibility:hidden] @min-[6rem]:[visibility:visible]">
                    {label} <span className="tabular-nums">{count}</span>
                  </Text>
                </span>
              </TooltipHint>
            );
          })}
        </span>
      </span>
      <CountCell assetCount={category.assetCount} total={mix.total} locale={locale} />
    </li>
  );
};

interface AssetMixCardProps {
  organizationId?: string,
}

export const AssetMixCard: FunctionComponent<AssetMixCardProps> = ({ organizationId }) => {
  const trpc = useTRPC();
  const { data } = useQuery(trpc.supportingAssets.getAssetCountBySubcategory.queryOptions({ organizationId: organizationId ?? null }));
  const locale = i18n.locale || 'en';
  const mix = data === undefined ? null : groupAssetMix(data);
  const unclassifiedInk = categoryInk(UNCLASSIFIED_ASSET_CATEGORY);
  const legendInk = categoryInk(mix?.categories[0]?.categoryId ?? UNCLASSIFIED_ASSET_CATEGORY);
  const total = mix === null ? null : formatNumber(mix.total, locale);
  const totalLabel = total === null ? null : (
    <Text as="span" variant="content-compact" className="text-default-secondary">
      <Trans>Total <span className="font-medium text-default-primary tabular-nums">{total}</span></Trans>
    </Text>
  );

  return (
    <DashboardWidgetCard
      title={t`Assets`}
      info={(
        <MetricInfo
          title={t`Assets`}
          what={<Trans>The assets of the scope per category, largest first, each bar cut into its subcategories.</Trans>}
          how={(
            <Trans>
              The assets the assets list shows on the same scope, under the category and subcategory it shows them in. The
              assets still to classify are counted apart.
            </Trans>
          )}
        />
      )}
      action={totalLabel}
    >
      {mix === null && <Skeleton className="h-[200px] w-full" />}
      {mix !== null && mix.total === 0 && (
        <Text as="p" variant="content-compact" className="text-default-secondary"><Trans>No asset in this scope.</Trans></Text>
      )}
      {mix !== null && mix.total > 0 && (
        <div className="@container flex flex-col gap-4">
          <TooltipHintProvider>
            <ul className="flex flex-col gap-2" aria-label={t`Assets per category`}>
              {mix.categories.map((category) => <CategoryRow key={category.categoryId} category={category} mix={mix} locale={locale} />)}
            </ul>
          </TooltipHintProvider>
          {mix.unclassified > 0 && (
            <div className={`${ROW_GRID} border-t border-elevation-subtle-soft pt-3`}>
              <span className="flex flex-col [grid-area:label]">
                <Text as="span" variant="content-compact-medium"><Trans>To classify</Trans></Text>
                <Text as="span" variant="content-caption" className="text-default-secondary"><Trans>No known category</Trans></Text>
              </span>
              <span className={BAR_CELL}>
                <span
                  className="h-full min-w-[3px] rounded-[var(--fds-radius-sm)]"
                  style={{ width: barWidth(mix.unclassified, mix.largest), background: hatched(unclassifiedInk) }}
                />
              </span>
              <CountCell assetCount={mix.unclassified} total={mix.total} locale={locale} />
            </div>
          )}
          <span className="flex flex-wrap items-center gap-x-6 gap-y-2 text-default-secondary">
            <span className="flex items-center gap-2">
              <span aria-hidden="true" className="flex h-3 w-6 overflow-hidden rounded-[2px]">
                {[100, 70, 40].map((percent) => <span key={percent} className="flex-1" style={{ background: inkAt(legendInk, percent) }} />)}
              </span>
              <Text as="span" variant="content-caption"><Trans>One shade per subcategory, the most frequent first</Trans></Text>
            </span>
            <span className="flex items-center gap-2">
              <span aria-hidden="true" className="h-3 w-6 rounded-[2px]" style={{ background: hatched(legendInk) }} />
              <Text as="span" variant="content-caption"><Trans>Subcategory not specified</Trans></Text>
            </span>
          </span>
        </div>
      )}
    </DashboardWidgetCard>
  );
};
