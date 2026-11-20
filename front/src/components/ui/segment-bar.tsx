import type { FunctionComponent } from 'react';
import type { ChartSegment } from './chart-segment';

interface SegmentBarProps {
  segments: Array<ChartSegment>,
  /** Rendered as a hatched band after the colored segments (e.g. not assessed, out of scope). */
  hatchedCount?: number,
  total: number,
  height: string,
  /** Id of the element naming the bar. Without one the bar stays decoration, and whatever wraps it
   * — a tooltip trigger, a labelled container — owes the reader that name instead. */
  ariaLabelledBy?: string,
  ariaDescribedBy?: string,
  /** A gap in the card surface between neighbouring segments, so a boundary shows whatever the colours. */
  separated?: boolean,
}

export const SegmentBar: FunctionComponent<SegmentBarProps> = ({
  segments,
  hatchedCount,
  total,
  height,
  ariaLabelledBy,
  ariaDescribedBy,
  separated,
}) => {
  const labelling = ariaLabelledBy === undefined
    ? {}
    : { role: 'img' as const, 'aria-labelledby': ariaLabelledBy, 'aria-describedby': ariaDescribedBy };

  if (total === 0) {
    return <div {...labelling} className={`w-full rounded-full bg-muted ${height}`} />;
  }

  const hatchedPercent = ((hatchedCount ?? 0) / total) * 100;
  const drawn = segments.filter((seg) => seg.value > 0);

  return (
    <div
      {...labelling}
      className={`relative flex w-full overflow-hidden rounded-full bg-muted dark:bg-muted-foreground/30 ${height}`}
    >
      {drawn.map((seg, index) => {
        const pct = (seg.value / total) * 100;
        return (
          <div
            className={`h-full transition-all duration-500 ${separated ? 'min-w-2' : ''} ${separated && index > 0 ? 'border-l-2 border-[hsl(var(--card))]' : ''}`}
            key={seg.key}
            style={{ width: `${pct}%`, backgroundColor: seg.color }}
          />
        );
      })}
      {hatchedPercent > 0 && (
        <div
          className={`h-full border border-muted dark:border-muted-foreground/10 bg-background text-muted-foreground/20 dark:bg-muted dark:text-muted-foreground/30 ${separated ? 'min-w-2' : ''} ${separated && drawn.length > 0 ? 'border-l-2 border-l-[hsl(var(--card))] dark:border-l-[hsl(var(--card))]' : ''}`}
          style={{
            width: `${hatchedPercent}%`,
            backgroundImage: `linear-gradient(135deg,
              currentColor 10%,
              transparent 10%,
              transparent 50%,
              currentColor 50%,
              currentColor 60%,
              transparent 60%,
              transparent 100%
            )`,
            backgroundSize: '15px 15px',
          }}
        />
      )}
    </div>
  );
};
