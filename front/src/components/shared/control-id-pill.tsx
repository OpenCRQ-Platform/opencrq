import type { FunctionComponent } from 'react';
import { cn } from '../../utils';
import { tileTonePaint } from './tile-tone';

/* eslint-disable lingui/no-unlocalized-strings -- CSS values, not copy */
const RAISED_SHADOW = 'inset 0 1px 0 rgb(255 255 255 / 0.08), 0 1px 2px rgb(0 0 0 / 0.4)';
const BRAND_EDGE = 'color-mix(in srgb, var(--fds-color-filigran-brand-primary) 35%, transparent)';
/* eslint-enable lingui/no-unlocalized-strings */

interface ControlIdPillProps {
  externalId: string,
  /** `compact` matches the height of an FDS `Chip`, for one-line rows the default would make taller. */
  size?: 'default' | 'compact',
}

export const ControlIdPill: FunctionComponent<ControlIdPillProps> = ({ externalId, size }) => {
  const paint = tileTonePaint('brand');
  return (
    <span
      className={cn(
        'inline-flex min-w-12 shrink-0 items-center justify-center rounded-[var(--fds-radius-sm)] border font-content-code text-content-caption font-semibold tracking-[var(--fds-tracking-relaxed)]',
        size === 'compact' ? 'h-6 px-1.5' : 'h-7 px-2',
      )}
      style={{ background: paint.fill, color: paint.text, borderColor: BRAND_EDGE, boxShadow: RAISED_SHADOW }}
    >
      {externalId}
    </span>
  );
};
