import { Icon } from '@filigran/design-system';
import type { IconName } from '@filigran/design-system';
import type { FunctionComponent, ReactNode } from 'react';
import type { TileTone } from './tile-tone';
import { tileTonePaint } from './tile-tone';

/**
 * Space between a tile and the separator trailing it. The strip mirrors it as its own column gap,
 * which is what leaves the separator centred between two tiles.
 */
export const KPI_TILE_GUTTER = 24;

/** Radius of the glow the icon slot carries inwards, which rounds the fill off its own edges. */
const TILE_GLOW_BLUR = 12;

interface KpiTileProps {
  /** Omitted only by a tile that draws its own `mark` in place of the icon slot. */
  icon?: IconName,
  /** A drawing of the tile's own, such as the score gauge, standing where the icon would. */
  mark?: ReactNode,
  /** The reading itself: a figure, a chip, a link, never prose. A `mark` that states it stands alone. */
  value?: ReactNode,
  caption: string,
  /** Caps the caption's width so a multi-word caption wraps onto two lines instead of stretching wide. */
  captionClassName?: string,
  /** Sits after the caption, for help on the reading. */
  captionAdornment?: ReactNode,
  /** The level the reading carries, which tints the icon slot. `brand` for a reading that has none. */
  tone?: TileTone,
  /** The last tile of the strip, which trails no separator. */
  isLast?: boolean,
}

/**
 * One header reading, its icon slot tinted in the chip severity vocabulary so the two never
 * disagree; a `mark` replaces the icon slot for a tile that draws its own reading.
 * The separator trails the tile (not leads it) so a wrapped line starts flush left, and both it
 * and the gutter are inline styles because the design system's unlayered Tailwind build would
 * otherwise outrank the app's own `last:pr-0`.
 */
export const KpiTile: FunctionComponent<KpiTileProps> = ({ icon, mark, value, caption, captionClassName, captionAdornment, tone, isLast }) => {
  const paint = tileTonePaint(tone ?? 'brand');
  return (
    <div
      className="flex items-center gap-2.5"
      style={{
        paddingRight: isLast === true ? 0 : KPI_TILE_GUTTER,
        borderRight: isLast === true ? undefined : '1px solid var(--fds-border-elevation-subtle-soft)',
      }}
    >
      {mark === undefined ? (
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--fds-radius-sm)]"
          style={{
            background: paint.fill,
            color: paint.glyph,
            boxShadow: `inset 0 0 ${TILE_GLOW_BLUR}px ${paint.fill}`,
          }}
        >
          {icon !== undefined && <Icon name={icon} size={16} />}
        </span>
      ) : (
        <span className="flex shrink-0 items-center justify-center">{mark}</span>
      )}
      <span className="flex min-w-0 flex-col justify-center">
        {value !== undefined && (
          <span className="flex items-center gap-2 font-content-code text-[var(--fds-text-5)] font-medium leading-[var(--fds-leading-tight)] tabular-nums">
            {value}
          </span>
        )}
        {/* Plain concatenation, not `cn()`: tailwind-merge groups `text-content-caption` (FDS font-size) and
            `text-default-secondary` (color) as conflicting and drops the font-size one, which is never intended here. */}
        <span className={`flex items-center gap-1 font-content-caption text-content-caption uppercase tracking-[var(--fds-tracking-relaxed)] text-default-secondary${captionClassName === undefined ? '' : ` ${captionClassName}`}`}>
          {caption}
          {captionAdornment}
        </span>
      </span>
    </div>
  );
};
