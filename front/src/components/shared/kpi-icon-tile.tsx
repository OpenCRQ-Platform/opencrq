import type { IconName } from '@filigran/design-system';
import { Icon } from '@filigran/design-system';
import type { FunctionComponent } from 'react';
import { cn } from '../../utils';

/** The only per-card hue on the panel, and it never leaks past the tile. */
export type KpiTileTone = 'info' | 'success' | 'error' | 'warning' | 'neutral';

/* eslint-disable lingui/no-unlocalized-strings -- Tailwind class lists, not copy */
const TILE_TONE_CLASSES: Record<KpiTileTone, string> = {
  info: 'bg-[var(--fds-color-feedback-info-secondary-transparency-30)] text-[color:var(--fds-color-feedback-info-primary)]',
  success: 'bg-[var(--fds-color-feedback-success-secondary-transparency-30)] text-[color:var(--fds-color-feedback-success-primary)]',
  error: 'bg-[var(--fds-color-feedback-error-secondary-transparency-30)] text-[color:var(--fds-color-feedback-error-primary)]',
  warning: 'bg-[var(--fds-color-feedback-warning-secondary-transparency-30)] text-[color:var(--fds-color-feedback-warning-primary)]',
  neutral: 'bg-[var(--fds-bg-elevation-highlight-layer-0)] text-[color:var(--fds-text-default-primary)]',
};
/* eslint-enable lingui/no-unlocalized-strings */

interface KpiIconTileProps {
  icon: IconName,
  tone: KpiTileTone,
}

export const KpiIconTile: FunctionComponent<KpiIconTileProps> = ({ icon, tone }) => (
  <span className={cn('grid size-[42px] shrink-0 place-items-center rounded-sm', TILE_TONE_CLASSES[tone])}>
    <Icon name={icon} size={24} aria-hidden />
  </span>
);
