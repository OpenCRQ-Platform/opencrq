import type { FunctionComponent, KeyboardEvent, PointerEvent, ReactNode } from 'react';
import type { LifelineRise } from './lifeline-utils';
import { cn } from '../../utils';
import { Lifeline } from './lifeline';
import { buildLifelineGeometry, LIFELINE_TONE_CLASS, nearestMarkIndex } from './lifeline-utils';

export type ActiveUpdate = number | null | ((current: number | null) => number | null);

interface LifelinePlotProps {
  values: ReadonlyArray<number | null>,
  xs: ReadonlyArray<number>,
  /** The points a reader can reach, left to right, each naming its point in `values`. */
  marks: ReadonlyArray<{ x: number, pointIndex: number }>,
  /** The index of the active mark in `marks`. */
  active: number | null,
  onActiveChange: (next: ActiveUpdate) => void,
  /** Names the curve itself. */
  ariaLabel: string,
  /** Names the focusable group, and says how to walk it. */
  groupLabel: string,
  renderTooltip: (index: number) => ReactNode,
  /** What the live region reads for a mark, since focus stays on the plot while the arrows move. */
  announce: (index: number) => string,
  rise: LifelineRise,
  /** The lowest and highest values, printed at their heights in a gutter left of the plot. */
  axisLabels?: { min: string, max: string },
  /** A second series at the same `xs`, drawn as a line behind the first. */
  backValues?: ReadonlyArray<number | null>,
  /** The scale both series share; each series takes its own when omitted. */
  domain?: { min: number, max: number },
  /** A date another plot points at, as a fraction across this one: drawn while this plot has no active mark. */
  guideAt?: number | null,
  /** Sets the height. */
  className?: string,
}

interface TooltipFrameProps {
  x: number,
  y: number,
  children: ReactNode,
}

/** Anchored on its mark's side, so it never overflows the plot. */
export const TooltipFrame: FunctionComponent<TooltipFrameProps> = ({ x, y, children }) => {
  let shift = '-translate-x-1/2';
  if (x < 0.25) {
    shift = 'translate-x-0';
  } else if (x > 0.75) {
    shift = '-translate-x-full';
  }
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute z-10 flex w-62 flex-col gap-1 rounded-sm text-default-primary border border-[var(--fds-border-elevation-subtle)] bg-[var(--fds-bg-elevation-default-layer-2)] px-3 py-2.5 shadow-lg',
        shift,
      )}
      style={{
        left: `${x * 100}%`,
        ...(y < 0.5 ? { top: `calc(${y * 100}% + 14px)` } : { bottom: `calc(${(1 - y) * 100}% + 14px)` }),
      }}
    >
      {children}
    </div>
  );
};

/**
 * A lifeline a reader can walk: hovering snaps to the nearest mark, a tap does the same, and the
 * arrows walk the marks once the plot has focus.
 */
export const LifelinePlot: FunctionComponent<LifelinePlotProps> = ({
  values,
  xs,
  marks,
  active,
  onActiveChange,
  ariaLabel,
  groupLabel,
  renderTooltip,
  announce,
  rise,
  axisLabels,
  backValues,
  domain,
  guideAt,
  className,
}) => {
  const geometry = buildLifelineGeometry(values, { xs, curve: 'monotone', domain });
  const activeMark = active === null ? undefined : marks.at(active);
  const activePoint = activeMark === undefined ? null : geometry?.points[activeMark.pointIndex] ?? null;

  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const index = nearestMarkIndex(marks, (event.clientX - box.left) / box.width);
    onActiveChange(index === -1 ? null : index);
  };

  const step = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = marks.length - 1;
    const moves: Record<string, (current: number | null) => number | null> = {
      ArrowLeft: (current) => Math.max((current ?? last + 1) - 1, 0),
      ArrowRight: (current) => Math.min((current ?? -1) + 1, last),
      Home: () => 0,
      End: () => last,
      Escape: () => null,
    };
    const move = moves[event.key];
    if (move === undefined || last < 0) {
      return;
    }
    event.preventDefault();
    onActiveChange(move);
  };

  return (
    <div className={cn('flex w-full gap-2', className ?? 'h-24')}>
      {axisLabels !== undefined && geometry !== null && (
        <div aria-hidden className="relative shrink-0 txt-mini text-muted-foreground">
          <span className="invisible block whitespace-nowrap">{axisLabels.max.length >= axisLabels.min.length ? axisLabels.max : axisLabels.min}</span>
          <span className="absolute right-0 -translate-y-1/2 whitespace-nowrap" style={{ top: `${geometry.maxY * 100}%` }}>
            {axisLabels.max}
          </span>
          {geometry.min !== geometry.max && (
            <span className="absolute right-0 -translate-y-1/2 whitespace-nowrap" style={{ top: `${geometry.minY * 100}%` }}>
              {axisLabels.min}
            </span>
          )}
        </div>
      )}
      <div
        className={cn(
          'relative h-full min-w-0 flex-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 ring-focus',
          geometry !== null && LIFELINE_TONE_CLASS[rise][geometry.direction],
        )}
        role="group"
        aria-label={groupLabel}
        tabIndex={marks.length > 0 ? 0 : undefined}
        onPointerMove={pick}
        onPointerDown={pick}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') {
            onActiveChange(null);
          }
        }}
        onFocus={() => onActiveChange((current) => current ?? (marks.length > 0 ? marks.length - 1 : null))}
        onBlur={() => onActiveChange(null)}
        onKeyDown={step}
      >
        {backValues !== undefined && (
          <div aria-hidden className="absolute inset-0">
            <Lifeline
              values={backValues}
              xs={xs}
              curve="monotone"
              domain={domain}
              endMarker={false}
              filled={false}
              toneClassName="text-primary"
              rise={rise}
              ariaLabel=""
              className="h-full"
            />
          </div>
        )}
        <Lifeline
          values={values}
          xs={xs}
          curve="monotone"
          domain={domain}
          endMarker={false}
          rise={rise}
          ariaLabel={ariaLabel}
          className="h-full"
        />
        {active === null && guideAt !== undefined && guideAt !== null && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 border-l border-dashed border-muted-foreground/50"
            style={{ left: `${guideAt * 100}%` }}
          />
        )}
        {active !== null && activePoint !== null && (
          <>
            <span
              className="pointer-events-none absolute inset-y-0 border-l border-dashed border-muted-foreground/50"
              style={{ left: `${activePoint.x * 100}%` }}
            />
            <span
              className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current ring-2 ring-background"
              style={{ left: `${activePoint.x * 100}%`, top: `${activePoint.y * 100}%` }}
            />
            <TooltipFrame x={activePoint.x} y={activePoint.y}>{renderTooltip(active)}</TooltipFrame>
          </>
        )}
        <p role="status" aria-live="polite" aria-atomic className="sr-only">
          {active === null || activeMark === undefined ? '' : announce(active)}
        </p>
      </div>
    </div>
  );
};
