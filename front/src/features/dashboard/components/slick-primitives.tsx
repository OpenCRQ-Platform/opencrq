import { Skeleton } from '@filigran/ui';
import type { CSSProperties, FunctionComponent, ReactNode } from 'react';
import { SectionCard } from '../../../components/shared';
import { cn } from '../../../utils';

/**
 * Visual primitives for the slick dashboard.
 *
 * Two rules run through all of them, and they are what most dashboards get wrong:
 *
 * 1. EVERY figure is `tabular-nums`. Proportional digits make a column of numbers wobble, which
 *    is the single loudest signal that a screen was not designed for reading numbers.
 * 2. Labels are uppercase micro-captions with letterspacing, values are large and quiet. The
 *    hierarchy comes from weight and size, never from colour: colour is reserved for verdicts.
 */

/** Micro caption above a figure. Letterspaced, because 12px uppercase without it reads as noise. */
export const Caption: FunctionComponent<{ children: ReactNode, className?: string }> = ({ children, className }) => (
  <p className={cn('txt-container-title text-muted-foreground', className)} style={{ letterSpacing: '0.08em' }}>
    {children}
  </p>
);

/** A quiet pill for a categorical value: dimension, mode, unit. */
export const MetaChip: FunctionComponent<{ children: ReactNode, className?: string }> = ({ children, className }) => (
  <span
    className={cn('txt-mini bg-muted/70 text-muted-foreground inline-flex shrink-0 items-center rounded px-1.5 py-0.5 font-medium uppercase', className)}
    style={{ letterSpacing: '0.06em' }}
  >
    {children}
  </span>
);

/** A number in its own right, tabular so a column of them lines up. */
export const Figure: FunctionComponent<{ children: ReactNode, className?: string, style?: CSSProperties }> = ({ children, className, style }) => (
  <span className={cn('font-semibold', className)} style={{ fontVariantNumeric: 'tabular-nums', ...style }}>
    {children}
  </span>
);

/** Proportional bar behind a list row's value, so relative magnitude is readable without arithmetic. */
export const MagnitudeBar: FunctionComponent<{ ratio: number, className?: string }> = ({ ratio, className }) => (
  <div className="bg-muted h-1 w-full overflow-hidden rounded-full">
    <div
      className={cn('h-full rounded-full', className ?? 'bg-primary')}
      style={{ width: `${Math.min(Math.max(ratio, 0), 1) * 100}%` }}
    />
  </div>
);

/** Rank chip for an ordered list. Zero-padded so 1 and 10 occupy the same width. */
export const RankChip: FunctionComponent<{ rank: number }> = ({ rank }) => (
  <span
    className="txt-mini bg-muted text-muted-foreground inline-flex h-5 w-5 shrink-0 items-center justify-center rounded font-semibold"
    style={{ fontVariantNumeric: 'tabular-nums' }}
  >
    {String(rank).padStart(2, '0')}
  </span>
);

/**
 * Widget shell, delegating to the shared `SectionCard` so these panels are indistinguishable from
 * every other card in the product: label above the surface, sentence case, no internal header rule.
 *
 * It exists to keep the `info` / `action` slots the widgets are written against (composing the
 * title with its "i" is otherwise repeated at every call site, and forgetting the wrapper span is
 * what put one widget's icon on its own line), and to hold the two rules that make a row of panels
 * line up.
 *
 * `min-h-9` on the header matches the design system's button group, the tallest thing a header can
 * hold. Pinned rather than left to the content, because `SectionCard` sits the
 * label ABOVE the card: a panel carrying a control is ~18px taller there than one carrying only
 * text, which offsets the two card surfaces beside each other in a grid row.
 *
 * `flex-1`, not `h-full`, on the card. `h-full` resolves against a parent that also holds the label
 * and its gap, so every card overshot its column by the height of its own header, and by a
 * different amount depending on whether that header held a control.
 */
export const Panel: FunctionComponent<{
  title: ReactNode,
  info?: ReactNode,
  action?: ReactNode,
  children: ReactNode,
  className?: string,
}> = ({ title, info, action, children, className }) => (
  <SectionCard
    title={<span className="flex min-h-9 items-center gap-1.5">{title}{info}</span>}
    headerAction={action}
    className={cn('flex h-full flex-col', className)}
    cardClassName="min-h-0 flex-1 p-4"
    contentClassName="h-full"
  >
    {children}
  </SectionCard>
);

/**
 * A proportional bar with named segments: a distribution read as shares, in one row of pixels.
 *
 * Segments carry their own colour class because the only distributions worth drawing this way have
 * an agreed severity order, and that order has to survive into the colour.
 *
 * Hidden from assistive technology: callers pair it with a legend that states every segment and its
 * count in text, so announcing the bar as well would read the same distribution twice.
 */
export const ShareBar: FunctionComponent<{
  segments: Array<{ key: string, share: number, className: string, title: string }>,
}> = ({ segments }) => (
  <div className="bg-muted flex h-2 w-full overflow-hidden rounded-full" aria-hidden="true">
    {segments.map((segment) => (
      <div
        key={segment.key}
        className={segment.className}
        style={{ width: `${segment.share * 100}%` }}
        title={segment.title}
      />
    ))}
  </div>
);

export interface RankedRow {
  id: string,
  /** The thing itself: a CVE, an asset, a technique. Truncates rather than wraps. */
  label: ReactNode,
  /** Chips and qualifiers under the label. */
  meta?: ReactNode,
  /** The figure this list is ordered by, right-aligned on the value column. */
  value: ReactNode,
  /** Optional caption under the value, on the same right edge. */
  valueMeta?: ReactNode,
  /**
   * Magnitude bar, 0–1, against the largest row on screen. Null draws no bar. Used when the
   * quantity genuinely is not known for that row, rather than substituting zero.
   */
  ratio: number | null,
  onClick?: () => void,
}

const SKELETON_ROWS = 5;

/**
 * The list shape shared by every "top N" panel on this dashboard: rank, label, chips, a
 * right-aligned figure, and a bar giving relative size without arithmetic.
 *
 * One component rather than four near-copies, because the alignment IS the design here. The
 * moment two of these panels sit side by side with differently sized rank chips or value columns,
 * the screen stops reading as one instrument.
 */
export const RankedList: FunctionComponent<{
  rows: Array<RankedRow>,
  isLoading: boolean,
  empty: ReactNode,
  /** Colour of the magnitude bars, so a panel can carry its own accent. */
  barClassName?: string,
}> = ({ rows, isLoading, empty, barClassName }) => {
  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: SKELETON_ROWS }).map((_, index) => <Skeleton key={index} className="h-10 w-full" />)}
      </div>
    );
  }
  if (rows.length === 0) {
    return <p className="txt-sub-content text-muted-foreground py-10 text-center">{empty}</p>;
  }
  return (
    <div className="flex flex-col gap-0.5">
      {rows.map((row, index) => {
        const content = (
          <>
            <span className="flex w-full items-center gap-2">
              <RankChip rank={index + 1} />
              <span className="txt-table min-w-0 flex-1 truncate font-medium group-hover:underline">{row.label}</span>
              <span className="flex shrink-0 flex-col items-end">
                <Figure className="txt-table">{row.value}</Figure>
                {row.valueMeta !== undefined && (
                  <span className="txt-mini text-muted-foreground">{row.valueMeta}</span>
                )}
              </span>
            </span>
            {/* The bar keeps a floor width so a long qualifier truncates instead of squeezing it out. */}
            <span className="flex w-full items-center gap-2 pl-7">
              {row.meta !== undefined && row.meta}
              <span className="min-w-[4rem] flex-1">
                {row.ratio !== null && <MagnitudeBar ratio={row.ratio} className={barClassName} />}
              </span>
            </span>
          </>
        );
        const className = 'group flex w-full flex-col gap-1 rounded-md px-2 py-1.5 text-left';
        return row.onClick === undefined ? (
          <div key={row.id} className={className}>{content}</div>
        ) : (
          <button
            key={row.id}
            type="button"
            onClick={row.onClick}
            className={cn(className, 'hover:bg-muted/50 transition-colors')}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
};
