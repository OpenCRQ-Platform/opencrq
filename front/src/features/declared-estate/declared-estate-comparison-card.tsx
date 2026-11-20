import type { AssetCategory } from '@app/module/client';
import { Button, Text } from '@filigran/design-system';
import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';
import { useState } from 'react';
import type { DeclaredEstateComparisonCategory, DeclaredEstateComparisonChart } from './declared-estate-utils';
import { TooltipHint, TooltipHintProvider } from '../../components/shared';
import { useMediaQuery } from '../../hooks';
import { cn } from '../../utils/cn';
import { getAssetCategoryLabel } from '../../utils/asset-category-utils';
import { formatDate } from '../../utils/date-utils';
import { formatNumber } from '../../utils/format-number';
import { assetDomain, assetDomainColor } from '../asset-dependencies/dependency-graph-utils';
import { DashboardWidgetCard } from '../dashboard/components/dashboard-widget-card';
import { declaredEstateRangeLabel } from './declared-estate-labels';

/* eslint-disable lingui/no-unlocalized-strings -- CSS values, not copy */
const ROW_GRID = [
  'grid items-center gap-x-4 gap-y-1',
  "grid-cols-[minmax(0,1fr)_auto] [grid-template-areas:'label_count'_'bar_bar']",
  "@min-[34rem]:grid-cols-[13.5rem_minmax(0,1fr)_12rem] @min-[34rem]:[grid-template-areas:'label_bar_count']",
].join(' ');
const inkAt = (ink: string, percent: number): string => `color-mix(in srgb, ${ink} ${percent}%, transparent)`;
/* eslint-enable lingui/no-unlocalized-strings */

const DECLARED_INK_PERCENT = 20;

/**
 * A short viewport (a 720 px laptop): the card shows its first rows whole and leaves the rest to the table.
 * Read in render, not as a responsive class: FDS ships `.grid`, `.hidden` and `.flex` unlayered, so a
 * layered `[@media(...)]:` variant on the same element never applies.
 */
// eslint-disable-next-line lingui/no-unlocalized-strings -- a media query, not copy
const SHORT_VIEWPORT_QUERY = '(max-height: 800px)';

const categoryInk = (category: AssetCategory): string => assetDomainColor(assetDomain(category));

const widthOf = (count: number, largest: number): string => `${(count / largest) * 100}%`;

const CategoryRow: FunctionComponent<{ row: DeclaredEstateComparisonCategory, largest: number, declares: boolean, className?: string }> = ({ row, largest, declares, className }) => {
  const ink = categoryInk(row.category);
  const label = getAssetCategoryLabel(row.category);
  const measured = formatNumber(row.measured);
  const measuredHint = i18n._({ id: 'Measured assets of a category', message: '{label}: {measured} measured', values: { label, measured } });
  const declared = row.bounds === null ? null : declaredEstateRangeLabel(row.bounds.low, row.bounds.high);
  const declaredCaption = declared === null
    ? null
    : row.partial
      ? i18n._({ id: 'Partly declared {declared}', message: 'partly declared: {declared}', values: { declared } })
      : i18n._({ id: 'Declared {declared}', message: 'declared {declared}', values: { declared } });
  const declaredHint = declaredCaption === null
    ? null
    : i18n._({ id: 'Declared assets of a category', message: '{label}: {declaredCaption}', values: { label, declaredCaption } });
  return (
    <li className={cn(ROW_GRID, className)}>
      <Text as="span" variant="content-compact-medium" className="min-w-0 [grid-area:label]">{label}</Text>
      <span className="relative h-3.5 [grid-area:bar]">
        {declaredHint !== null && row.bounds !== null && row.bounds.high > 0 && (
          <TooltipHint hint={declaredHint}>
            <span
              role="img"
              aria-label={declaredHint}
              tabIndex={0}
              className="absolute inset-y-0 left-0 rounded-[2px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              style={{ width: widthOf(row.bounds.high, largest), background: inkAt(ink, DECLARED_INK_PERCENT) }}
            />
          </TooltipHint>
        )}
        {row.measured > 0 && (
          <TooltipHint hint={measuredHint}>
            <span
              role="img"
              aria-label={measuredHint}
              tabIndex={0}
              className="absolute inset-y-0 left-0 min-w-[3px] rounded-[2px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              style={{ width: widthOf(row.measured, largest), background: ink }}
            />
          </TooltipHint>
        )}
      </span>
      <span className="flex flex-col items-end gap-0.5 text-right [grid-area:count]">
        <Text as="span" variant="content-compact-medium" className="tabular-nums">
          {row.measured > 0 ? measured : t`None measured`}
        </Text>
        {declares && (
          <Text as="span" variant="content-caption" className="text-default-secondary tabular-nums">
            {declaredCaption ?? t`Not estimated`}
          </Text>
        )}
      </span>
    </li>
  );
};

interface DeclaredEstateComparisonCardProps {
  chart: DeclaredEstateComparisonChart,
  /** Null when the scope declares nothing. */
  declaredAt: string | Date | null,
  /** Omitted with no scope, which has no estimate to make. */
  onEstimate?: () => void,
  /**
   * On a short viewport, the rows shown whole before "Show all categories"; the card never scrolls
   * inside itself. Omitted: every row, whatever the viewport.
   */
  shortViewportRows?: number,
}

/**
 * One scope's declaration, or none on the whole tenant: scopes can share assets, so the declarations
 * of several never add up.
 */
export const DeclaredEstateComparisonCard: FunctionComponent<DeclaredEstateComparisonCardProps> = ({ chart, declaredAt, onEstimate, shortViewportRows }) => {
  const [expanded, setExpanded] = useState(false);
  const shortViewport = useMediaQuery(SHORT_VIEWPORT_QUERY);
  const legendInk = categoryInk(chart.rows[0]?.category ?? 'host');
  const collapsible = shortViewport && shortViewportRows !== undefined && chart.rows.length > shortViewportRows;
  const rows = collapsible && !expanded ? chart.rows.slice(0, shortViewportRows) : chart.rows;
  return (
    <DashboardWidgetCard elevation={1}>
      <div className="@container flex flex-col gap-4">
        <TooltipHintProvider>
          <ul className="flex flex-col gap-3" aria-label={t`Assets per category, measured and declared`}>
            {rows.map((row) => (
              <CategoryRow key={row.category} row={row} largest={chart.largest} declares={chart.declares} />
            ))}
          </ul>
        </TooltipHintProvider>
        {collapsible && (
          <span className="flex justify-center">
            <Button type="button" priority="tertiary" size="sm" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
              {expanded ? t`Show fewer categories` : t`Show all categories`}
            </Button>
          </span>
        )}
        {(chart.declares || onEstimate !== undefined) && (
          <span className="flex flex-wrap items-center gap-x-6 gap-y-2 text-default-secondary">
            {chart.declares && (
              <>
                <span className="flex items-center gap-2">
                  <span aria-hidden="true" className="h-2.5 w-6 rounded-[2px]" style={{ background: legendInk }} />
                  <Text as="span" variant="content-caption"><Trans>Measured</Trans></Text>
                </span>
                <span className="flex items-center gap-2">
                  <span aria-hidden="true" className="h-2.5 w-6 rounded-[2px]" style={{ background: inkAt(legendInk, DECLARED_INK_PERCENT) }} />
                  <Text as="span" variant="content-caption"><Trans>Declared</Trans></Text>
                </span>
              </>
            )}
            {onEstimate !== undefined && (
              <span className="ml-auto flex items-center gap-3">
                <Text as="span" variant="content-caption">
                  {declaredAt === null
                    ? t`You have not estimated your estate`
                    : i18n._({ id: 'Estate declared on {date}', message: 'Estate declared on {date}', values: { date: formatDate(declaredAt) } })}
                </Text>
                <Button priority="tertiary" size="sm" onClick={onEstimate}>
                  {declaredAt === null ? t`Estimate my estate` : t`Review my estimate`}
                </Button>
              </span>
            )}
          </span>
        )}
      </div>
    </DashboardWidgetCard>
  );
};
