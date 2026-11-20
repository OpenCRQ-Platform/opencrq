import { t } from '@lingui/core/macro';
import { Popover, PopoverContent, PopoverTrigger } from '@filigran/ui';
import { Info } from 'lucide-react';
import type { FunctionComponent, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '../../utils';

interface MetricInfoProps {
  /** The metric's own name, repeated as the popover header. */
  title: string,
  /** What the number is, in one sentence. */
  what: ReactNode,
  /** Where it comes from and how it is derived. Name the columns, not the tables. */
  how: ReactNode,
  /**
   * The misreading this metric invites, stated plainly. Optional, but a figure that can be
   * added up when it must not be, or ranked when it must not be, should say so here rather
   * than rely on the reader knowing.
   */
  caveat?: ReactNode,
  className?: string,
}

/** Wider than a label tooltip because the content is prose: ~60 characters to the line. */
const POPOVER_WIDTH = 380;
/** Long enough to cross the gap from icon to popover without it closing under the cursor. */
const CLOSE_DELAY_MS = 120;

/**
 * The small "i" beside a metric title: hover, focus or tap to read what the number means and
 * how it was computed.
 *
 * Built on the shared `Popover` rather than a hand-rolled portal. Portalling, collision flipping,
 * escape handling and outside dismissal are all things Radix already does, and doing them here
 * cost the keyboard path: a hand-rolled panel that closes on `blur` and links nothing to its
 * trigger can be opened with the keyboard but never entered, so the prose it exists to show was
 * unreachable for anyone not using a mouse.
 *
 * Hover and keyboard open it differently on purpose. A pointer open must NOT move focus, or
 * skimming a row of panels would yank the caret around; a click or Enter must, so the content is
 * where the next Tab goes and Escape returns to the icon. `openedByPointer` is the only state
 * that distinction needs.
 *
 * Clicks are swallowed so the "i" never triggers an interactive `SectionCard`'s navigation.
 */
export const MetricInfo: FunctionComponent<MetricInfoProps> = ({ title, what, how, caveat, className }) => {
  const [open, setOpen] = useState(false);
  const openedByPointer = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = (): void => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const openOnPointer = (): void => {
    cancelClose();
    openedByPointer.current = true;
    setOpen(true);
  };
  const scheduleClose = (): void => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };
  useEffect(() => cancelClose, []);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        cancelClose();
        // Anything that is not the hover path (click, Enter, Escape, an outside dismissal) goes
        // through here, and all of them should place focus normally.
        openedByPointer.current = false;
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t`What it means and how it is computed`}
          onMouseEnter={openOnPointer}
          onMouseLeave={scheduleClose}
          onClick={(event) => event.stopPropagation()}
          className={cn(
            'text-muted-foreground/50 hover:text-primary inline-flex shrink-0 cursor-help items-center justify-center transition-colors',
            className,
          )}
        >
          <Info className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        role="dialog"
        aria-label={title}
        align="start"
        sideOffset={6}
        style={{ width: POPOVER_WIDTH }}
        className="bg-card z-50 flex flex-col gap-1.5 rounded-lg border p-3 shadow-xl"
        onOpenAutoFocus={(event) => {
          if (openedByPointer.current) {
            event.preventDefault();
          }
        }}
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
        onClick={(event) => event.stopPropagation()}
      >
        <p className="txt-sub-content font-semibold">{title}</p>
        <p className="txt-sub-content">{what}</p>
        <p className="txt-sub-content text-muted-foreground">{how}</p>
        {caveat !== undefined && (
          <p className="txt-sub-content border-t pt-1.5 font-medium">{caveat}</p>
        )}
      </PopoverContent>
    </Popover>
  );
};
