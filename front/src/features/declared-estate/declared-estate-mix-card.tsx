import type { AssetCategory } from '@app/module/client';
import { Chip, Text } from '@filigran/design-system';
import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Globe } from 'lucide-react';
import type { FunctionComponent } from 'react';
import type { DeclaredEstateMix, DeclaredEstateMixCategory } from './declared-estate-utils';
import { TooltipHint, TooltipHintProvider } from '../../components/shared';
import { getAssetCategoryLabel } from '../../utils/asset-category-utils';
import { assetDomain, assetDomainColor } from '../asset-dependencies/dependency-graph-utils';
import { subcategoryShadePercent } from '../dashboard/asset-mix-utils';
import { DashboardWidgetCard } from '../dashboard/components/dashboard-widget-card';
import { declaredEstateKindLabel, declaredEstateKindNames, declaredEstateRangeLabel } from './declared-estate-labels';

/* eslint-disable lingui/no-unlocalized-strings -- CSS values, not copy */
const ROW_GRID = [
  'grid items-center gap-x-4 gap-y-1',
  "grid-cols-[minmax(0,1fr)_auto] [grid-template-areas:'label_count'_'bar_bar']",
  "@min-[34rem]:grid-cols-[13.5rem_minmax(0,1fr)_9rem] @min-[34rem]:[grid-template-areas:'label_bar_count']",
].join(' ');
const inkAt = (ink: string, percent: number): string => `color-mix(in srgb, ${ink} ${percent}%, transparent)`;
/* eslint-enable lingui/no-unlocalized-strings */

const categoryInk = (category: AssetCategory): string => assetDomainColor(assetDomain(category));

const CategoryRow: FunctionComponent<{ category: DeclaredEstateMixCategory, largest: number }> = ({ category, largest }) => {
  const ink = categoryInk(category.category);
  return (
    <li className={ROW_GRID}>
      <span className="flex min-w-0 flex-col [grid-area:label]">
        <Text as="span" variant="content-compact-medium">{getAssetCategoryLabel(category.category)}</Text>
        {category.internetFacing && (
          <Text as="span" variant="content-caption" className="flex items-center gap-1 text-default-secondary">
            <Globe aria-hidden="true" className="size-3" />
            {t`Reachable from the Internet`}
          </Text>
        )}
      </span>
      <span className="flex h-7 [grid-area:bar]">
        {category.size > 0 && (
          <span className="flex h-full gap-0.5 overflow-hidden rounded-[var(--fds-radius-sm)]" style={{ width: `${(category.size / largest) * 100}%` }}>
            {category.kinds.map((entry, index) => {
              const { subcategory } = declaredEstateKindNames(entry.kind);
              const answer = declaredEstateRangeLabel(entry.bounds.low, entry.bounds.high);
              const label = declaredEstateKindLabel(entry.kind);
              const hint = i18n._({ id: 'Declared kind and its answer', message: '{label}: {answer}', values: { label, answer } });
              return (
                <TooltipHint key={entry.kind} hint={hint}>
                  <span
                    role="img"
                    aria-label={hint}
                    tabIndex={0}
                    className="@container flex min-w-[3px] items-center overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
                    style={{ flex: `${entry.size} 1 0`, background: inkAt(ink, subcategoryShadePercent(index, category.kinds.length)) }}
                  >
                    {subcategory !== null && (
                      <Text as="span" variant="content-caption" className="truncate px-2 [visibility:hidden] @min-[8rem]:[visibility:visible]">
                        {subcategory} <span className="tabular-nums">{answer}</span>
                      </Text>
                    )}
                  </span>
                </TooltipHint>
              );
            })}
          </span>
        )}
      </span>
      <Text as="span" variant="content-compact-medium" className="text-right tabular-nums [grid-area:count]">
        {declaredEstateRangeLabel(category.low, category.high)}
      </Text>
    </li>
  );
};

export const DeclaredEstateMixCard: FunctionComponent<{ mix: DeclaredEstateMix }> = ({ mix }) => {
  const total = declaredEstateRangeLabel(mix.low, mix.high);
  const unansweredCount = mix.unanswered.length;
  const totalCount = mix.unanswered.length + mix.categories.reduce((count, category) => count + category.kinds.length, 0);
  const legendInk = categoryInk(mix.categories[0]?.category ?? 'host');
  return (
    <DashboardWidgetCard elevation={1}>
      <div className="@container flex flex-col gap-4">
        {mix.categories.length > 0 && (
          <TooltipHintProvider>
            <ul className="flex flex-col gap-2" aria-label={t`Declared assets per category`}>
              {mix.categories.map((category) => <CategoryRow key={category.category} category={category} largest={mix.largest} />)}
            </ul>
          </TooltipHintProvider>
        )}
        {unansweredCount > 0 && (
          <div className={`${ROW_GRID} items-start border-t border-elevation-subtle-soft pt-3`}>
            <span className="flex flex-col [grid-area:label]">
              <Text as="span" variant="content-compact-medium"><Trans>Not answered</Trans></Text>
              <Text as="span" variant="content-caption" className="text-default-secondary">
                {i18n._({ id: '{unansweredCount} of {totalCount} kinds', message: '{unansweredCount} of {totalCount} kinds', values: { unansweredCount, totalCount } })}
              </Text>
            </span>
            <span className="flex flex-wrap gap-2 [grid-area:bar]">
              {mix.unanswered.map((kind) => <Chip key={kind} label={declaredEstateKindLabel(kind)} />)}
            </span>
          </div>
        )}
        <span className="flex flex-wrap items-center gap-x-6 gap-y-2 text-default-secondary">
          <span className="flex items-center gap-2">
            <span aria-hidden="true" className="flex h-3 w-6 overflow-hidden rounded-[2px]">
              {[100, 40].map((percent) => <span key={percent} className="flex-1" style={{ background: inkAt(legendInk, percent) }} />)}
            </span>
            <Text as="span" variant="content-caption"><Trans>One shade per subcategory, the most frequent first</Trans></Text>
          </span>
          <Text as="span" variant="content-compact" className="ml-auto">
            <Trans>Total <span className="font-medium text-default-primary tabular-nums">{total}</span></Trans>
          </Text>
        </span>
      </div>
    </DashboardWidgetCard>
  );
};
