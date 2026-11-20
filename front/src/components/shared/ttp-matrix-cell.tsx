import { Tooltip, TooltipContent, TooltipTrigger } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Link } from '@tanstack/react-router';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { CSSProperties, FunctionComponent, ReactNode } from 'react';
import { useState } from 'react';
import { cn } from '../../utils';

export type HighlightColor = 'red' | 'blue' | 'green' | 'orange';

export const HIGHLIGHT_CLASSES: Record<HighlightColor, { bg: string, border: string, indicator: string, chevronHover: string, text: string }> = {
  red: { bg: 'bg-red-500/15', border: 'border-red-500', indicator: 'bg-red-500', chevronHover: 'hover:bg-red-500/30', text: 'text-red-500' },
  blue: { bg: 'bg-blue-500/15', border: 'border-blue-500', indicator: 'bg-blue-500', chevronHover: 'hover:bg-blue-500/30', text: 'text-blue-500' },
  green: { bg: 'bg-green-500/15', border: 'border-green-500', indicator: 'bg-green-500', chevronHover: 'hover:bg-green-500/30', text: 'text-green-500' },
  orange: { bg: 'bg-orange-500/15', border: 'border-orange-500', indicator: 'bg-orange-500', chevronHover: 'hover:bg-orange-500/30', text: 'text-orange-500' },
};

/** Emphasis of a cell marker. Kept generic: the caller names its own meaning in the label. */
export type MarkerTone = 'default' | 'danger';

export type FillTone = 'default' | 'positive' | 'warning' | 'danger';

/** A proportion drawn under the cell label. The caller owns what the proportion means. */
export interface CellFill {
  ratio: number,
  tone: FillTone,
}

export interface CellBar {
  ratio: number,
  /** The figure's colour has to read as text, which a bar's fill does not. */
  fillColor: string,
  figureColor: string,
  figure: string,
  /** Read out in place of the bar and the figure, which assistive technology does not see. */
  label: string,
  icon?: ReactNode,
  /** Written beside the icon by `CellBars` given `named`, as in a tooltip; the cell has no room for it. */
  name?: string,
}

export interface HighlightedTechnique {
  id: string,
  color: HighlightColor,
  categoryLabel?: string,
  tooltipExtra?: Array<{ label: string, value: string }>,
  /**
   * Short mark rendered on the cell, for a state the hue cannot carry: the hue is already spoken
   * for by whatever the surface colours its techniques on.
   */
  marker?: string,
  markerTone?: MarkerTone,
  /**
   * Bar drawn under the label. Omitting it is the only way to keep a dense grid quiet, so a cell
   * with nothing to proportion must pass none rather than a zero-width one.
   */
  fill?: CellFill,
  /** A cell with bars and no accent keeps a neutral outline, unless `keepsHue`. */
  bars?: Array<CellBar>,
  /** Keeps the hue's border and tint on a cell with bars, for a surface whose hue says what the bars do not. */
  keepsHue?: boolean,
  /** A CSS colour for an owned cell's figure, a token: the surface owns what the colour says. */
  markerColor?: string,
  /** A last, muted line of the tooltip, for what a click on the cell does. */
  tooltipHint?: string,
  /** Replaces the category label and `tooltipExtra` lines under the tooltip's title. */
  tooltipContent?: ReactNode,
  /**
   * Dashed border and muted label, for a technique the surface counts but has no figure for.
   * Omitting the highlight instead would drop the cell and say the technique is not there at all.
   */
  outlined?: boolean,
  /**
   * A CSS colour taking over the cell's border, tint, identifier and bar, so one accent carries the
   * whole cell. Pass a token, never a literal: the surface owns what the accent encodes, and a
   * literal would hold one theme's value on both grounds.
   */
  accent?: string,
  /**
   * Wraps the technique label, for a surface that routes the technique somewhere of its own.
   * A slot rather than a route descriptor: the router narrows `to`, `params` and `search` against
   * the call site, and that narrowing is lost the moment the props cross a generic boundary.
   * Defaults to a link to the technique's ATT&CK page.
   */
  renderLink?: (props: { className: string, children: ReactNode }) => ReactNode,
}

interface SubTechnique {
  id: string,
  externalId: string,
  name: string,
}

export interface TtpMatrixCellProps {
  id: string,
  externalId: string,
  name: string,
  subTechniques: Array<SubTechnique>,
  highlightMap: Map<string, HighlightedTechnique>,
  defaultColor: HighlightColor,
  /** Opens the cells whose sub-techniques are highlighted, so the matched ids are readable at once. */
  expandHighlightedSubTechniques?: boolean,
  /** Drops the sub-techniques nothing highlighted, the same narrowing the matrix itself applies. */
  highlightedSubTechniquesOnly?: boolean,
}

const CellTooltip = ({ highlight, externalId, name, children }: {
  highlight: HighlightedTechnique | undefined,
  externalId: string,
  name: string,
  children: ReactNode,
}) => {
  if (!highlight) {
    return <>{children}</>;
  }

  if (highlight.tooltipContent !== undefined) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {children}
        </TooltipTrigger>
        <TooltipContent side="right" className="flex w-[17rem] flex-col gap-2 p-[10px_12px]">
          <span className="flex flex-col">
            <span className="font-mono txt-mini text-muted-foreground">{externalId}</span>
            <span className="font-medium">{name}</span>
          </span>
          {highlight.tooltipContent}
          {highlight.tooltipHint !== undefined && (
            <span className="border-t border-border pt-1.5 text-muted-foreground">{highlight.tooltipHint}</span>
          )}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {children}
      </TooltipTrigger>
      <TooltipContent side="right">
        <p className="font-medium">{externalId} — {name}</p>
        {highlight.categoryLabel && <p>{highlight.categoryLabel}</p>}
        {highlight.tooltipExtra?.map((entry, index) => (
          <p key={index}>
            {entry.label}: {entry.value}
          </p>
        ))}
        {highlight.tooltipHint !== undefined && <p className="mt-1 text-muted-foreground">{highlight.tooltipHint}</p>}
      </TooltipContent>
    </Tooltip>
  );
};

const MARKER_CLASSES: Record<MarkerTone, string> = {
  default: 'text-muted-foreground',
  danger: HIGHLIGHT_CLASSES.red.text,
};

const FILL_CLASSES: Record<FillTone, string> = {
  default: 'bg-muted-foreground',
  positive: 'bg-secondary',
  warning: 'bg-orange',
  danger: 'bg-destructive',
};

const BAR_TRACK_COLOR = 'var(--fds-color-feedback-neutral-secondary-transparency-30)';

/** The cell's bars, each with its icon and its figure, and its name when `named`. */
export const CellBars: FunctionComponent<{ bars: Array<CellBar>, named?: boolean, className?: string }> = ({ bars, named, className }) => (
  <span className={cn('flex flex-col gap-1', className)}>
    {bars.map((bar, index) => {
      const name = named === true ? bar.name : undefined;
      return (
        <span
          key={index}
          role="img"
          aria-label={bar.label}
          className={cn(
            'grid items-center gap-1.5',
            bar.icon === undefined && 'grid-cols-[minmax(0,1fr)_22px]',
            bar.icon !== undefined && name === undefined && 'grid-cols-[12px_minmax(0,1fr)_44px]',
            bar.icon !== undefined && name !== undefined && 'grid-cols-[12px_5rem_minmax(0,1fr)_44px]',
          )}
        >
          {bar.icon !== undefined && <span aria-hidden="true" className="flex text-muted-foreground">{bar.icon}</span>}
          {name !== undefined && <span aria-hidden="true" className="truncate txt-sub-content text-muted-foreground">{name}</span>}
          <span aria-hidden="true" className="block h-1 overflow-hidden rounded-full" style={{ backgroundColor: BAR_TRACK_COLOR }}>
            <span
              className="block h-full rounded-full"
              style={{ width: `${Math.min(100, Math.max(0, bar.ratio * 100))}%`, backgroundColor: bar.fillColor }}
            />
          </span>
          <span aria-hidden="true" className="text-right txt-sub-content font-medium leading-none tabular-nums" style={{ color: bar.figureColor }}>
            {bar.figure}
          </span>
        </span>
      );
    })}
  </span>
);

/**
 * The tint is mixed rather than an opacity token so the accent can be any colour the surface
 * hands over, and it composites the same on both grounds.
 */
/* eslint-disable lingui/no-unlocalized-strings -- CSS values, not copy */
const accentBorderStyle = (accent: string): CSSProperties => ({
  borderColor: `color-mix(in srgb, ${accent} 40%, transparent)`,
});

const accentStyle = (accent: string): CSSProperties => ({
  ...accentBorderStyle(accent),
  background: `linear-gradient(90deg, color-mix(in srgb, ${accent} 22%, transparent), color-mix(in srgb, ${accent} 4%, transparent))`,
  boxShadow: `inset 3px 0 0 0 ${accent}`,
});
/* eslint-enable lingui/no-unlocalized-strings */

const accentOf = (highlight: HighlightedTechnique | undefined): string | undefined =>
  (highlight?.outlined === true ? undefined : highlight?.accent);

/**
 * Owned cells, accented, outlined or carrying bars, put the figure on the name's baseline and drop
 * the sub-technique count; a surface that only highlights keeps the plain stack.
 */
const isOwnedCell = (highlight: HighlightedTechnique | undefined): boolean =>
  highlight !== undefined && (highlight.accent !== undefined || highlight.outlined === true || highlight.bars !== undefined);

const isNeutralCell = (highlight: HighlightedTechnique | undefined): boolean =>
  highlight?.bars !== undefined && highlight.keepsHue !== true && accentOf(highlight) === undefined;

const TechniqueLabel = ({ externalId, name, highlight }: {
  externalId: string,
  name: string,
  highlight: HighlightedTechnique | undefined,
}) => (
  <>
    {/* Tops flush, not baselines: the figure outsizes the identifier, so a shared baseline would
        push its cap well above it. The two-line clamp keeps every cell in a column the same
        height; the tooltip and drawer still carry the whole name. */}
    {isOwnedCell(highlight)
      ? (
        <span className="flex items-start justify-between gap-2">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="font-mono txt-mini text-muted-foreground">{externalId}</span>
            <span
              className={cn('txt-sub-content', highlight!.outlined === true && 'text-muted-foreground')}
              style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: '2rem' }}
            >
              {name}
            </span>
          </span>
          {highlight!.marker !== undefined && (
            // Text colour ignores the accent: a magnitude-dimmed accent is too faint to read text
            // in. A cell with no figure carries a reason instead, so it stays at the small size.
            <span
              aria-hidden="true"
              className={cn(
                'shrink-0 font-medium',
                highlight!.outlined === true
                  ? 'max-w-[52%] txt-mini text-right text-muted-foreground'
                  : 'whitespace-nowrap txt-subtitle2 leading-none',
              )}
              style={highlight!.markerColor === undefined ? undefined : { color: highlight!.markerColor }}
            >
              {highlight!.marker}
            </span>
          )}
        </span>
      )
      : (
        <>
          <span className="font-mono txt-mini text-muted-foreground">{externalId}</span>
          <br />
          <span className="txt-sub-content">{name}</span>
          {/* The category label below already speaks the marker's figure, so the visible mark stays
              silent to assistive technology. */}
          {highlight?.marker !== undefined && (
            <span aria-hidden="true" className={cn('block txt-mini font-medium', MARKER_CLASSES[highlight.markerTone ?? 'default'])}>
              {highlight.marker}
            </span>
          )}
        </>
      )}
    {highlight?.fill !== undefined && (
      <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-muted">
        <span
          className={cn('block h-full rounded-full', highlight.accent === undefined && FILL_CLASSES[highlight.fill.tone])}
          style={{
            width: `${Math.min(100, Math.max(0, highlight.fill.ratio * 100))}%`,
            ...(highlight.accent === undefined ? {} : { backgroundColor: highlight.accent }),
          }}
        />
      </span>
    )}
    {highlight?.bars !== undefined && <CellBars bars={highlight.bars} className="mt-1.5" />}
    {/* The fill and border are the only visual mark of a highlighted technique, and the tooltip
        that would explain them is never reached by keyboard. Each surface names its own highlight,
        so the marker follows the caller rather than assuming coverage. */}
    {highlight != null && <span className="sr-only">{highlight.categoryLabel ?? t`Covered`}</span>}
  </>
);

/** The technique's own ATT&CK page unless the surface fills the slot with a link of its own. */
const TechniqueLink = ({ techniqueExternalId, highlight, className, children }: {
  techniqueExternalId: string,
  highlight: HighlightedTechnique | undefined,
  className: string,
  children: ReactNode,
}) => {
  if (highlight?.renderLink !== undefined) {
    return <>{highlight.renderLink({ className, children })}</>;
  }
  return (
    <Link
      from="/$tenantId/{-$organizationId}"
      to="settings/taxonomies/mitre-attack/techniques/$techniqueExternalId"
      params={{ techniqueExternalId }}
      className={className}
    >
      {children}
    </Link>
  );
};

export const TtpMatrixCell: FunctionComponent<TtpMatrixCellProps> = ({
  id,
  externalId,
  name,
  subTechniques,
  highlightMap,
  defaultColor,
  expandHighlightedSubTechniques,
  highlightedSubTechniquesOnly,
}) => {
  const highlight = highlightMap.get(id);
  const isHighlighted = highlight != null;

  const highlightedSubs = subTechniques.filter((sub) => highlightMap.has(sub.id));
  const highlightedSubCount = highlightedSubs.length;
  const hasHighlightedSubs = highlightedSubCount > 0;

  const shownSubTechniques = highlightedSubTechniquesOnly === true ? highlightedSubs : subTechniques;

  const [expanded, setExpanded] = useState(expandHighlightedSubTechniques === true && hasHighlightedSubs);

  const totalHighlighted = highlightedSubCount + (isHighlighted ? 1 : 0);

  const hasBorder = isHighlighted || hasHighlightedSubs;

  // Single, stable colour for the whole cell so the border, fill and count badge always
  // match. Prefer the technique's own highlight; otherwise the first highlighted
  // sub-technique's colour (deterministic — never the jarring red mixed-fallback).
  const cellColor: HighlightColor = highlight?.color
    ?? (hasHighlightedSubs ? (highlightMap.get(highlightedSubs[0].id)?.color ?? defaultColor) : defaultColor);
  const styles = HIGHLIGHT_CLASSES[cellColor];

  const ownAccent = accentOf(highlight);
  const isAccented = ownAccent !== undefined;
  // A folded cell carrying only accented sub-techniques frames itself in theirs, as their own
  // rows do once it opens.
  const subAccent = isHighlighted ? undefined : highlightedSubs.map((sub) => accentOf(highlightMap.get(sub.id))).find((accent) => accent !== undefined);

  return (
    <div
      className={cn(
        'border',
        hasBorder && !isAccented && subAccent === undefined && !isNeutralCell(highlight) ? styles.border : 'border-border',
        highlight?.outlined === true && 'border-dashed',
      )}
      style={ownAccent !== undefined ? accentStyle(ownAccent) : subAccent !== undefined ? accentBorderStyle(subAccent) : undefined}
    >
      <CellTooltip highlight={highlight} externalId={externalId} name={name}>
        <div
          className={cn(
            'relative flex items-start gap-1 p-1.5',
            isAccented && 'pl-2.5',
            isHighlighted && highlight.outlined !== true && !isAccented && !isNeutralCell(highlight) && styles.bg,
          )}
        >
          {shownSubTechniques.length > 0 && (
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setExpanded(!expanded);
              }}
              className={cn('mt-0.5 flex-shrink-0 rounded p-0.5', isHighlighted ? styles.chevronHover : 'hover:bg-muted')}
            >
              {expanded
                ? <ChevronDown className="h-5 w-5" />
                : <ChevronRight className="h-5 w-5" />}
            </button>
          )}
          <TechniqueLink
            techniqueExternalId={externalId}
            highlight={highlight}
            className="min-w-0 flex-1 leading-tight hover:underline"
          >
            <TechniqueLabel externalId={externalId} name={name} highlight={highlight} />
          </TechniqueLink>
          {/* An accented cell already puts its figure in that corner. The count matters only where
              sub-techniques are highlighted one by one, not once the set is folded to parent
              techniques. */}
          {!isOwnedCell(highlight) && (isHighlighted || hasHighlightedSubs) && subTechniques.length > 0 && (
            <div
              className={cn(
                'absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full px-1 py-0.5 txt-mini text-white',
                styles.indicator,
              )}
            >
              {totalHighlighted}/{subTechniques.length + 1}
            </div>
          )}
        </div>
      </CellTooltip>
      {expanded && shownSubTechniques.length > 0 && (
        <div className={cn('border-t pl-5', hasBorder && !isAccented ? styles.border : 'border-border')}>
          {shownSubTechniques.map((sub) => (
            <SubTechniqueRow
              key={sub.id}
              sub={sub}
              highlight={highlightMap.get(sub.id)}
              defaultColor={defaultColor}
              hasHighlights={highlightMap.size > 0}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const SubTechniqueRow: FunctionComponent<{
  sub: SubTechnique,
  highlight: HighlightedTechnique | undefined,
  defaultColor: HighlightColor,
  hasHighlights: boolean,
}> = ({ sub, highlight, defaultColor, hasHighlights }) => {
  const isHighlighted = highlight != null;
  const colorKey = highlight?.color ?? defaultColor;
  const styles = HIGHLIGHT_CLASSES[colorKey];
  const accent = accentOf(highlight);

  return (
    <CellTooltip highlight={highlight} externalId={sub.externalId} name={sub.name}>
      <div
        className={cn(
          'border',
          isHighlighted && accent === undefined && !isNeutralCell(highlight) ? styles.border : 'border-border',
          highlight?.outlined === true && 'border-dashed',
          isHighlighted && highlight.outlined !== true && accent === undefined && !isNeutralCell(highlight) && styles.bg,
          !isHighlighted && hasHighlights && 'text-muted-foreground',
        )}
        style={accent === undefined ? undefined : accentStyle(accent)}
      >
        <TechniqueLink
          techniqueExternalId={sub.externalId}
          highlight={highlight}
          className={cn('block p-1.5 leading-tight hover:underline', accent !== undefined && 'pl-2.5')}
        >
          <TechniqueLabel externalId={sub.externalId} name={sub.name} highlight={highlight} />
        </TechniqueLink>
      </div>
    </CellTooltip>
  );
};
