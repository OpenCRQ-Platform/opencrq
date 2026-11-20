import { Chip, Paper, ProgressBar, Text } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import type { ConnectorState } from '@app/module/client';
import type { LucideIcon } from 'lucide-react';
import type { FunctionComponent, ReactNode } from 'react';
import { TooltipHintProvider } from '../../../components/shared';
import { formatPointsAsPercentAtMost } from '../../../utils';
import { ConnectorStateChip, getConnectors } from '../../integrations';

const importProgressLabel = (name: string): string => t`${name} import progress`;

/** The running import: a thin bar and its percentage, drawn only once the percentage is known. */
export const SourceProgressLine: FunctionComponent<{ percent: number, name: string }> = ({ percent, name }) => (
  <span className="flex w-full items-center gap-2">
    <ProgressBar value={percent} size="md" className="flex-1" aria-label={importProgressLabel(name)} />
    <Text as="span" variant="content-caption" className="tabular-nums text-default-secondary">{formatPointsAsPercentAtMost(percent, 0)}</Text>
  </span>
);

/** The tile's mark for a source that has no connector icon. */
export const SourceGlyph: FunctionComponent<{ icon: LucideIcon }> = ({ icon: Icon }) => (
  <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded bg-elevation-highlight">
    <Icon className="size-5" />
  </span>
);

type ConnectorTileSource = 'microsoft_graph' | 'opencti' | 'default_threats' | 'drata';

/** The icon a connector carries on the Integrations page. */
export const ConnectorSourceIcon: FunctionComponent<{ source: ConnectorTileSource }> = ({ source }) => (
  <img src={getConnectors()[source].icon} alt="" aria-hidden="true" className="size-10 shrink-0 rounded object-contain" />
);

/** The connector's own state, with the hint the Integrations page gives it. */
export const ConnectorTileChip: FunctionComponent<{ state: ConnectorState | undefined, enabled: boolean, hint?: string }> = ({ state, enabled, hint }) =>
  state === undefined ? null : <TooltipHintProvider><ConnectorStateChip state={state} enabled={enabled} hint={hint} /></TooltipHintProvider>;

/** A source that has no state of its own is active once it holds something. */
export const ActiveChip: FunctionComponent<{ count: number | undefined }> = ({ count }) =>
  count !== undefined && count > 0 ? <Chip severity="low" label={t`Active`} /> : null;

interface SourceTileProps {
  icon: ReactNode,
  /** At the top right of the tile. */
  chip?: ReactNode,
  name: string,
  /** One line under the name saying what the source is for. */
  description?: string,
  /** The source's own items, already worded with their unit; undefined while it loads. */
  count: string | undefined,
  /** Null when unknown: no bar is drawn. */
  percent: number | null,
  /** At the bottom of the tile. */
  action: ReactNode,
}

export const SourceTile: FunctionComponent<SourceTileProps> = ({ icon, chip, name, description, count, percent, action }) => (
  <Paper elevation={2} padding={16} className="flex flex-col gap-3">
    <div className="flex items-start justify-between gap-2">
      {icon}
      {chip}
    </div>
    <div className="flex flex-col gap-1">
      <Text as="h3" variant="content-base-medium">{name}</Text>
      {description !== undefined && <Text as="p" variant="content-caption" className="text-default-secondary">{description}</Text>}
    </div>
    <div className="flex flex-col gap-1">
      <Text as="p" variant="title-sm" className="min-h-[1lh] tabular-nums">{count}</Text>
      {percent !== null && <SourceProgressLine percent={percent} name={name} />}
    </div>
    <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">{action}</div>
  </Paper>
);

interface SourcesSectionProps {
  title: string,
  /** The tenant's real total, already worded; undefined while it loads. */
  total: string | undefined,
  columns: 2 | 3,
  /** Beside the total, e.g. a link to the app page that lists the items. */
  seeAll?: ReactNode,
  children: ReactNode,
}

export const SourcesSection: FunctionComponent<SourcesSectionProps> = ({ title, total, columns, seeAll, children }) => (
  <div className="flex flex-col gap-3">
    <div className="flex items-end justify-between gap-4">
      <span className="flex flex-col gap-1">
        <Text as="h3" variant="title-xs">{title}</Text>
        <Text as="p" variant="content-compact" className="text-default-secondary">{t`Use as many as you need, they add up.`}</Text>
      </span>
      <span className="flex items-baseline gap-4">
        <Text as="p" variant="content-base-medium" className="tabular-nums" role="status">{total}</Text>
        {seeAll}
      </span>
    </div>
    <div className={columns === 3 ? 'grid grid-cols-3 items-stretch gap-4' : 'grid grid-cols-2 items-stretch gap-4'}>{children}</div>
  </div>
);
