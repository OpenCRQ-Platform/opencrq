import { Chip, Tooltip, TooltipContent, TooltipTrigger } from '@filigran/design-system';
import { useLayoutEffect, useRef, useState } from 'react';
import { TooltipHintProvider } from '../shared/tooltip-hint';

export interface BadgeGroupItem {
  title: string,
}

interface BadgeGroupProps {
  items: Array<BadgeGroupItem>,
  className?: string,
  /** Width a single badge may take before its own label truncates. */
  chipClassName?: string,
}

export const BadgeGroup = ({ items, className, chipClassName }: BadgeGroupProps) => {
  const chipClasses = chipClassName ?? 'max-w-[120px]';
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const overflowBadgeRef = useRef<HTMLDivElement>(null);
  const gapRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const [visibleCount, setVisibleCount] = useState(items.length);

  useLayoutEffect(() => {
    gapRef.current = null;

    const container = containerRef.current;
    const measureContainer = measureRef.current;
    if (!container || !measureContainer) {
      return;
    }

    const applyVisibility = (count: number) => {
      const badgeEls = container.querySelectorAll<HTMLElement>('[data-badge-item]');
      badgeEls.forEach((el, i) => {
        el.style.display = i >= count ? 'none' : '';
      });
      const overflowEl = overflowBadgeRef.current;
      if (overflowEl) {
        overflowEl.style.display = items.length - count > 0 ? '' : 'none';
      }
      container.style.visibility = 'visible';
    };

    const computeVisible = () => {
      const containerWidth = container.clientWidth;
      if (containerWidth === 0) {
        return;
      }

      const measureEls = measureContainer.querySelectorAll<HTMLElement>('[data-measure-item]');
      if (measureEls.length === 0) {
        container.style.visibility = 'visible';
        return;
      }

      if (gapRef.current === null) {
        gapRef.current = parseFloat(getComputedStyle(container).columnGap) || 8;
      }
      const gap = gapRef.current;

      const widths = Array.from(measureEls).map((el) => el.getBoundingClientRect().width);

      let totalWidth = 0;
      for (let i = 0; i < widths.length; i++) {
        totalWidth += widths[i] + (i > 0 ? gap : 0);
      }
      if (totalWidth <= containerWidth) {
        applyVisibility(widths.length);
        setVisibleCount(widths.length);
        return;
      }

      const overflowMeasureEl = measureContainer.querySelector<HTMLElement>('[data-measure-overflow]');
      const overflowWidth = overflowMeasureEl?.getBoundingClientRect().width ?? 40;

      let usedWidth = 0;
      let count = 0;
      for (let i = 0; i < widths.length; i++) {
        const nextWidth = usedWidth + widths[i] + (i > 0 ? gap : 0);
        if (nextWidth + gap + overflowWidth > containerWidth) {
          break;
        }
        usedWidth = nextWidth;
        count++;
      }

      const newCount = Math.max(1, count);
      applyVisibility(newCount);
      setVisibleCount(newCount);
    };

    computeVisible();

    const observer = new ResizeObserver(() => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        computeVisible();
      });
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [items]);

  const hiddenItems = items.slice(visibleCount);
  const hiddenTitles = hiddenItems.map((item) => item.title).join(', ');

  return (
    <TooltipHintProvider>
      {/* Hidden measurement container — always renders all badges for measuring*/}
      <div
        ref={measureRef}
        className="pointer-events-none invisible absolute h-0 flex items-center gap-2 overflow-hidden"
        aria-hidden="true"
      >
        {items.map((item, index) => (
          <div key={`${index}-${item.title}`} data-measure-item="" className="shrink-0">
            <Chip className={chipClasses} label={item.title} />
          </div>
        ))}
        <div data-measure-overflow="" className="shrink-0">
          <Chip label={`+${items.length > 9 ? items.length : '00'}`} />
        </div>
      </div>

      {/* Visible container */}
      <div
        ref={containerRef}
        className={`relative flex w-full items-center gap-2 overflow-hidden ${className ?? ''}`}
        style={{ visibility: 'hidden' }}
      >
        {items.map((item, index) => (
          <div key={`${index}-${item.title}`} data-badge-item="" className="shrink-0">
            <Chip className={chipClasses} label={item.title} />
          </div>
        ))}
        {/* Overflow badge */}
        <div ref={overflowBadgeRef} className="shrink-0" style={{ display: 'none' }}>
          {/*
            A button, so the only place the collapsed titles are readable is reachable without a
            pointer. The chip names it `+n`, which says nothing alone, so the titles join that name
            rather than relying on the tooltip a browsing screen reader never opens.
          */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ring-focus ring-offset-focus"
              >
                <Chip label={`+${hiddenItems.length}`} />
                <span className="sr-only">{hiddenTitles}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <span>{hiddenTitles}</span>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipHintProvider>
  );
};
