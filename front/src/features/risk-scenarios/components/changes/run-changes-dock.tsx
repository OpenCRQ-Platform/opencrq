import { Paper } from '@filigran/design-system';
import type { FunctionComponent, ReactNode } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useScrollProgress } from '../../../../hooks';
import { between, easeInOut } from './run-changes-utils';
import { useTweened } from './use-tweened';

const DOCK_TOP = 14;
const COLLAPSE_DISTANCE = 260;
const DOCKED_HEIGHT = 88;
const SUMMARY_WIDTH = 280;
const FOCUS_DURATION = 320;

interface RunChangesDockProps {
  /** The figures and period buttons above the curve, faded out as the frame collapses. */
  header: ReactNode,
  /** The figures as the docked card reads them, faded in beside the curve. */
  summary: ReactNode,
  /** Zooms the unfolded curve onto the compared runs. The folded curve is zoomed whatever this says. */
  focused: boolean,
  curve: (collapse: number, zoom: number) => ReactNode,
}

/**
 * Must sit in a column holding the rest of the page below it, with no gap: the frame sticks within
 * that column, and the spacer after it gives back the height the frame loses, so the content below
 * never moves under the reader. A page too short to scroll the whole fold keeps the frame unfolded
 * and scrolling with it, rather than stuck halfway.
 */
export const RunChangesDock: FunctionComponent<RunChangesDockProps> = ({ header, summary, focused, curve }) => {
  const { ref: anchor, progress, reachable, inset } = useScrollProgress(DOCK_TOP, COLLAPSE_DISTANCE);
  const collapse = reachable ? easeInOut(progress) : 0;
  const focus = easeInOut(useTweened(focused ? 1 : 0, FOCUS_DURATION));
  const frame = useRef<HTMLDivElement>(null);
  const collapsed = useRef(false);
  const [fullHeight, setFullHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    collapsed.current = collapse > 0;
  }, [collapse]);

  useEffect(() => {
    const element = frame.current;
    if (element === null) {
      return undefined;
    }
    const observer = new ResizeObserver(() => {
      if (!collapsed.current) {
        setFullHeight(element.offsetHeight);
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const height = fullHeight === null || collapse === 0 ? null : between(fullHeight, DOCKED_HEIGHT, collapse);
  const fade = Math.max(1 - collapse * 2.2, 0);
  const show = Math.min(Math.max((collapse - 0.55) / 0.45, 0), 1);

  return (
    <>
      <div ref={anchor} aria-hidden />
      <div
        ref={frame}
        className={reachable ? 'sticky z-20' : 'relative z-20'}
        style={{ top: reachable ? DOCK_TOP - inset : undefined, height: height ?? undefined }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[8px] shadow-[0_14px_36px_rgb(0_0_0/0.55),0_2px_6px_rgb(0_0_0/0.35)]"
          style={{ opacity: collapse }}
        />
        <Paper
          className="relative flex h-full flex-col overflow-hidden"
          style={{
            paddingBlock: between(24, 12, collapse),
            paddingInline: between(24, 20, collapse),
            gap: between(20, 0, collapse),
            borderRadius: between(4, 8, collapse),
          }}
        >
          <div
            aria-hidden={fade === 0}
            className="shrink-0 overflow-hidden"
            style={{ opacity: fade, maxHeight: (1 - collapse) * 160, pointerEvents: fade > 0.5 ? undefined : 'none' }}
          >
            {header}
          </div>
          <div className="flex min-h-0 items-center" style={{ gap: between(0, 20, collapse) }}>
            <div aria-hidden={show === 0} className="shrink-0 overflow-hidden" style={{ width: SUMMARY_WIDTH * collapse, opacity: show }}>
              <div style={{ width: SUMMARY_WIDTH }}>{summary}</div>
            </div>
            <div className="min-w-0 flex-1">{curve(collapse, Math.max(collapse, focus))}</div>
          </div>
        </Paper>
      </div>
      <div aria-hidden style={{ height: height === null || fullHeight === null ? 0 : fullHeight - height }} />
    </>
  );
};
