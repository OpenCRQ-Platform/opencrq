import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent, PointerEvent } from 'react';
import { useId, useRef, useState, useSyncExternalStore } from 'react';
import { useDebouncedCallback } from 'use-debounce';
import type { MarkerStore } from './run-changes-marker-store';
import type { CurveDrag, CurveMarker, CurvePoint, CurveRange, RangeEnd } from './run-changes-utils';
import { buildLifelineGeometry, nearestMarkIndex, TooltipFrame } from '../../../../components/shared';
import { cn, formatDate, formatDateMinute } from '../../../../utils';
import { between, clickRange, curveView, curveXs, draggedRange, localDayBounds, moveRangeEnd, steppedIndex, timeAtX, timeX } from './run-changes-utils';

const KEY_COMMIT_DELAY_MS = 400;

const RANGE_ENDS: ReadonlyArray<RangeEnd> = ['before', 'after'];

const END_LABEL: Record<RangeEnd, () => string> = {
  before: () => t`Earlier run`,
  after: () => t`Later run`,
};

interface RunChangesCurveProps {
  points: ReadonlyArray<CurvePoint>,
  range: CurveRange,
  /** Settles once `range` has rendered the navigation it started, or a later navigation replaced it. */
  onRangeChange: (range: CurveRange) => Promise<void>,
  formatValue: (value: number) => string,
  formatChange: (before: number, after: number) => string,
  ariaLabel: string,
  markerStore: MarkerStore,
  /** 0 in the unfolded frame, 1 folded into the docked card, where the labels give way and the tooltip keeps one line. */
  collapse: number,
  /** 0 shows the whole history, 1 the compared range only. */
  zoom: number,
}

export type LabelledMarker = CurveMarker & { label: string };

interface MarkerOverlayProps {
  marker: LabelledMarker,
  points: ReadonlyArray<CurvePoint>,
  xs: ReadonlyArray<number>,
  ys: ReadonlyArray<number | null>,
  toView: (x: number) => number,
  labelTop: number,
  /** The label sits beside the line rather than centred above it, for a label drawn inside the plot. */
  beside: boolean,
}

const MarkerOverlay: FunctionComponent<MarkerOverlayProps> = ({ marker, points, xs, ys, toView, labelTop, beside }) => {
  const runIndex = marker.kind === 'run' ? points.findIndex((point) => point.runId === marker.runId) : -1;
  const x = runIndex >= 0 ? xs[runIndex] : toView(timeX(points, marker.at));
  const y = runIndex >= 0 ? ys[runIndex] : null;
  const [dayStart, dayEnd] = localDayBounds(marker.at);
  const bandLeft = toView(timeX(points, dayStart));
  const bandRight = toView(timeX(points, dayEnd));
  const centre = marker.kind === 'day' ? (bandLeft + bandRight) / 2 : x;
  return (
    <>
      {marker.kind === 'day'
        ? (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 bg-current text-default-primary opacity-10"
            style={{ left: `${bandLeft * 100}%`, width: `${(bandRight - bandLeft) * 100}%` }}
          />
        )
        : (
          <span
            aria-hidden
            className={cn('pointer-events-none absolute inset-y-0 border-l-[1.5px] border-current text-default-primary', marker.kind === 'moment' && 'border-dashed')}
            style={{ left: `${x * 100}%` }}
          />
        )}
      {y !== null && (
        <span
          aria-hidden
          className="pointer-events-none absolute z-10 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current text-default-primary ring-2 ring-background"
          style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
        />
      )}
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute whitespace-nowrap txt-mini font-medium text-default-primary',
          beside && (centre > 0.5 ? '-translate-x-full pr-2' : 'pl-2'),
          !beside && (centre < 0.15 ? 'translate-x-0' : centre > 0.85 ? '-translate-x-full' : '-translate-x-1/2'),
        )}
        style={{ left: `${centre * 100}%`, top: labelTop }}
      >
        {marker.label}
      </span>
    </>
  );
};

const inView = (x: number): number => Math.min(Math.max(x, 0), 1);

const rangeEndAt = (target: EventTarget): RangeEnd | null => {
  const end = target instanceof Element ? target.closest('[data-range-end]')?.getAttribute('data-range-end') : null;
  return RANGE_ENDS.find((candidate) => candidate === end) ?? null;
};

const sameRange = (left: CurveRange, right: CurveRange): boolean => left[0] === right[0] && left[1] === right[1];

/**
 * A drag reports its range once the pointer is released, and a key step once the keys pause or the
 * handle loses focus, so either navigates once. A drag is held in a ref: a fast drag sends its moves
 * and its release before a state update would have rendered. The view stays on the committed range
 * meanwhile, so a zoomed curve reaches runs past its edges through the pointer capture, and an end
 * dragged there waits on the edge. A committed range stays shown until the navigation it started
 * settles, so the handles never step back to the previous runs in between, and come back to `range`
 * when another navigation overtook it.
 */
export const RunChangesCurve: FunctionComponent<RunChangesCurveProps> = ({ points, range, onRangeChange, formatValue, formatChange, ariaLabel, markerStore, collapse, zoom }) => {
  const marker = useSyncExternalStore(markerStore.subscribe, markerStore.current);
  const [hover, setHover] = useState<number | null>(null);
  const drag = useRef<{ gesture: CurveDrag, moved: boolean, base: CurveRange } | null>(null);
  const [draft, setDraft] = useState<CurveRange | null>(null);
  const [sent, setSent] = useState<CurveRange | null>(null);
  const stretchClipId = useId();
  const committed = sent ?? range;
  const commit = (next: CurveRange) => {
    if (!sameRange(next, committed)) {
      setSent(next);
      const settle = () => setSent((current) => (current === next ? null : current));
      void onRangeChange(next).then(settle, settle);
    }
    setDraft(null);
  };
  const keyCommit = useDebouncedCallback(commit, KEY_COMMIT_DELAY_MS);

  const values = points.map((point) => point.value);
  const measured = values.filter((value) => value !== null);
  const compared = values.slice(committed[0], committed[1] + 1).filter((value) => value !== null);
  const fullDomain = { min: Math.min(...measured), max: Math.max(...measured) };
  const rangeDomain = compared.length === 0 ? fullDomain : { min: Math.min(...compared), max: Math.max(...compared) };
  const domain = { min: between(fullDomain.min, rangeDomain.min, zoom), max: between(fullDomain.max, rangeDomain.max, zoom) };
  const view = curveView(curveXs(points), committed, zoom);
  const toView = (x: number): number => (x - view.from) / (view.to - view.from);
  const xs = curveXs(points).map(toView);
  const fade = Math.max(1 - collapse * 2.2, 0);
  const whole = buildLifelineGeometry(values, { xs, curve: 'monotone', domain });
  if (whole === null) {
    return null;
  }
  const shown = draft ?? committed;
  // The compared stretch is the whole line clipped, not a line of its own: a monotone curve's
  // tangents at the range ends depend on the runs beyond them, so a separate one drifts off it.
  const stretchClip = { x: xs[shown[0]] * 100, width: (xs[shown[1]] - xs[shown[0]]) * 100 };
  const marks = xs.map((x) => ({ x }));
  const last = points.length - 1;

  const indexAt = (event: PointerEvent<HTMLDivElement>): number => {
    const box = event.currentTarget.getBoundingClientRect();
    return Math.max(nearestMarkIndex(marks, (event.clientX - box.left) / box.width), 0);
  };
  const endDrag = () => {
    drag.current = null;
    setDraft(null);
  };
  const runLabel = (index: number): string => {
    const { at, value: reading } = points[index];
    const date = formatDateMinute(at);
    if (reading === null) {
      return i18n._({ id: 'Run of {date}', message: 'Run of {date}', values: { date } });
    }
    const value = formatValue(reading);
    return i18n._({ id: 'Run of {date}, {value}', message: 'Run of {date}, {value}', values: { date, value } });
  };

  const hovered = hover === null ? null : points.at(hover);
  const hoveredPoint = hover === null ? null : whole.points[hover] ?? null;
  const previousValue = hover === null || hover === 0 ? null : points[hover - 1].value;
  const hoverDate = hovered === undefined || hovered === null ? '' : formatDateMinute(hovered.at);
  const hoverChange = hovered?.value === null || hovered?.value === undefined || previousValue === null
    ? null
    : formatChange(previousValue, hovered.value);

  return (
    <div className="flex flex-col gap-1" style={{ paddingTop: between(20, 0, collapse) }}>
      <div className="flex w-full gap-2" style={{ height: between(224, 64, collapse) }}>
        <div aria-hidden className="relative shrink-0 overflow-hidden txt-mini text-muted-foreground" style={{ opacity: fade, maxWidth: (1 - collapse) * 120 }}>
          <span className="invisible block whitespace-nowrap">{formatValue(domain.max)}</span>
          <span className="absolute right-0 -translate-y-1/2 whitespace-nowrap" style={{ top: `${whole.maxY * 100}%` }}>
            {formatValue(domain.max)}
          </span>
          {domain.min !== domain.max && (
            <span className="absolute right-0 -translate-y-1/2 whitespace-nowrap" style={{ top: `${whole.minY * 100}%` }}>
              {formatValue(domain.min)}
            </span>
          )}
        </div>
        <div
          className="relative h-full min-w-0 flex-1 cursor-crosshair touch-none select-none text-primary"
          onPointerDown={(event) => {
            // The gesture starts from the runs on screen: the router may not have handed back the
            // range just committed yet.
            const base = shown;
            keyCommit.flush();
            event.currentTarget.setPointerCapture(event.pointerId);
            const index = indexAt(event);
            const end = rangeEndAt(event.target);
            setHover(index);
            drag.current = { gesture: end === null ? { kind: 'span', start: index } : { kind: 'end', end }, moved: false, base };
          }}
          onPointerMove={(event) => {
            const index = indexAt(event);
            setHover(index);
            const current = drag.current;
            const next = current === null ? null : draggedRange(current.base, current.gesture, index);
            if (current !== null && next !== null) {
              current.moved = true;
              setDraft(next);
            }
          }}
          onPointerUp={(event) => {
            const current = drag.current;
            if (current !== null) {
              const index = indexAt(event);
              const next = draggedRange(current.base, current.gesture, index);
              commit(next ?? (current.moved ? current.base : clickRange(current.base, index)));
            }
            endDrag();
          }}
          onPointerCancel={endDrag}
          onPointerLeave={() => {
            if (drag.current === null) {
              setHover(null);
            }
          }}
        >
          <div className="absolute inset-0" style={zoom > 0 ? { clipPath: 'inset(-24px 0)' } : undefined}>
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 bg-primary/5"
              style={{ left: `${inView(xs[shown[0]]) * 100}%`, width: `${(inView(xs[shown[1]]) - inView(xs[shown[0]])) * 100}%` }}
            />
            <svg
              className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              role="img"
              aria-label={ariaLabel}
            >
              <defs>
                <clipPath id={stretchClipId}>
                  <rect x={stretchClip.x} y={-50} width={stretchClip.width} height={200} />
                </clipPath>
              </defs>
              {whole.areaPath !== null && (
                <path d={whole.areaPath} clipPath={`url(#${stretchClipId})`} fill="currentColor" fillOpacity={0.12} stroke="none" />
              )}
              <path
                d={whole.linePath}
                fill="none"
                stroke="currentColor"
                strokeOpacity={0.4}
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
              {whole.linePath !== '' && (
                <path
                  d={whole.linePath}
                  clipPath={`url(#${stretchClipId})`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </svg>
            {marker !== null && (
              <MarkerOverlay
                marker={marker}
                points={points}
                xs={xs}
                ys={whole.points.map((point) => point?.y ?? null)}
                toView={toView}
                labelTop={between(-20, 0, collapse)}
                beside={collapse > 0}
              />
            )}
            {hoveredPoint !== null && (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 border-l border-dashed border-muted-foreground/50"
                style={{ left: `${hoveredPoint.x * 100}%` }}
              />
            )}
            {RANGE_ENDS.map((end, position) => {
              const index = shown[position];
              const point = whole.points[index];
              return (
                <span key={end}>
                  <span
                    data-range-end={end}
                    role="slider"
                    tabIndex={0}
                    aria-label={END_LABEL[end]()}
                    aria-valuemin={0}
                    aria-valuemax={last}
                    aria-valuenow={index}
                    aria-valuetext={runLabel(index)}
                    onKeyDown={(event) => {
                      const stepped = steppedIndex(event.key, index, last);
                      if (stepped !== null) {
                        event.preventDefault();
                        const next = moveRangeEnd(shown, end, stepped);
                        setDraft(next);
                        keyCommit(next);
                      }
                    }}
                    onBlur={keyCommit.flush}
                    className="group absolute inset-y-0 z-10 flex w-3.5 -translate-x-1/2 cursor-ew-resize justify-center focus-visible:outline-none"
                    style={{ left: `${inView(xs[index]) * 100}%` }}
                  >
                    <span className="h-full w-[1.5px] bg-primary" />
                    <span className="absolute top-1/2 h-6 w-2 -translate-y-1/2 rounded-sm bg-primary ring-focus group-focus-visible:ring-2" />
                  </span>
                  {point !== null && point !== undefined && (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute z-10 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary ring-2 ring-background"
                      style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
                    />
                  )}
                </span>
              );
            })}
            {hoveredPoint !== null && hovered?.value !== null && hovered?.value !== undefined && (
              <span
                aria-hidden
                className="pointer-events-none absolute z-10 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current text-default-primary ring-2 ring-background"
                style={{ left: `${hoveredPoint.x * 100}%`, top: `${hoveredPoint.y * 100}%` }}
              />
            )}
          </div>
          {hoveredPoint !== null && hovered?.value !== null && hovered?.value !== undefined && (
            <TooltipFrame x={inView(hoveredPoint.x)} y={hoveredPoint.y}>
              {collapse > 0.5
                ? (
                  <span className="flex items-baseline gap-2 whitespace-nowrap">
                    <span className="txt-sub-content text-muted-foreground">{hoverDate}</span>
                    <span className="txt-default font-bold">{formatValue(hovered.value)}</span>
                  </span>
                )
                : (
                  <>
                    <span className="txt-sub-content text-muted-foreground"><Trans>Run of {hoverDate}</Trans></span>
                    <span className="txt-default font-bold">{formatValue(hovered.value)}</span>
                    {hoverChange !== null && (
                      <span className="txt-sub-content text-muted-foreground"><Trans>{hoverChange} since the previous run</Trans></span>
                    )}
                  </>
                )}
            </TooltipFrame>
          )}
        </div>
      </div>
      <div aria-hidden className="flex justify-between overflow-hidden txt-mini text-muted-foreground" style={{ opacity: fade, maxHeight: (1 - collapse) * 24 }}>
        <span>{formatDate(timeAtX(points, view.from))}</span>
        <span>{formatDate(timeAtX(points, view.to))}</span>
      </div>
    </div>
  );
};
