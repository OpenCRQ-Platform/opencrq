import type { IconName } from '@filigran/design-system';
import { Card, Text } from '@filigran/design-system';
import type { FunctionComponent, ReactNode } from 'react';
import type { KpiTileTone } from './kpi-icon-tile';
import { KpiIconTile } from './kpi-icon-tile';
import { KpiInfoTooltip } from './kpi-info-tooltip';

interface KpiCardProps {
  label: string,
  icon: IconName,
  tone: KpiTileTone,
  /** Formatted by the caller, a count or an amount. */
  figure: ReactNode,
  /** Beside the label. Left out wherever no previous value exists to compare the figure against. */
  trend?: ReactNode,
  /** What the figure is out of, under it: a scope's own estate is not something a tooltip may hide. */
  subtitle: ReactNode,
  tooltip: ReactNode,
  elevation?: 1 | 2 | 3,
}

/**
 * The face carries at most five things: label, icon tile, figure, the subtitle sizing it and, where
 * honesty allows, a trend. It states, the list below is where the reader acts, so nothing here is
 * clickable.
 */
export const KpiCard: FunctionComponent<KpiCardProps> = ({ label, icon, tone, figure, trend, subtitle, tooltip, elevation }) => (
  <Card elevation={elevation} gap={16} className="min-w-0">
    <div className="flex h-6 items-center gap-2">
      <Text as="span" variant="content-compact" className="truncate">{label}</Text>
      {trend}
      {tooltip === null ? null : (
        <span className="ml-auto flex shrink-0 items-center">
          <KpiInfoTooltip cardLabel={label}>{tooltip}</KpiInfoTooltip>
        </span>
      )}
    </div>
    <div className="flex items-center justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <Text as="p" variant="title-2xl" className="tabular-nums">{figure}</Text>
        {subtitle === null ? null : (
          <Text as="p" variant="content-compact" className="text-default-secondary">{subtitle}</Text>
        )}
      </div>
      <KpiIconTile icon={icon} tone={tone} />
    </div>
  </Card>
);
