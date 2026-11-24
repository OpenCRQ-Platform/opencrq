import { Chip } from '@filigran/design-system';
import type { FunctionComponent } from 'react';
import { TooltipHint } from '../../../components/shared/tooltip-hint';

interface OneLineChipsProps {
  items: ReadonlyArray<{ key: string, label: string, className?: string }>,
}

/** The narrowest width the first chip keeps, so its label stays readable (a few letters at least). */
export const ONE_LINE_CHIPS_FIRST_CHIP_MIN_WIDTH = 56;

/**
 * The content width under which a list of several chips shows its count alone: the first chip at
 * its minimum, the gap and the `+n` chip. It is the container query breakpoint below.
 */
export const ONE_LINE_CHIPS_MIN_WIDTH = 96;

/**
 * Chips on one line, so every row of a table keeps one height (Design standards s.3). A single
 * chip takes the whole cell and is cut there (the design system Chip shows a cut label whole in its
 * own tooltip). Several chips show the first one, never narrower than a readable label, and a `+n`
 * chip whose tooltip lists the rest; in a cell narrower than `ONE_LINE_CHIPS_MIN_WIDTH` they show
 * their count alone, whose tooltip lists them all. The `+n` and count chips never shrink, so they are
 * never clipped. Under a `TooltipHintProvider`.
 */
export const OneLineChips: FunctionComponent<OneLineChipsProps> = ({ items }) => {
  const [first, ...hidden] = items;
  if (first === undefined) {
    return null;
  }
  if (hidden.length === 0) {
    return (
      <div className="flex min-w-0 items-center">
        <Chip label={first.label} className={`min-w-0 max-w-full ${first.className ?? ''}`} />
      </div>
    );
  }
  const rest = hidden.map((item) => item.label).join(', ');
  const all = items.map((item) => item.label).join(', ');
  return (
    <div className="@container w-full min-w-0">
      <div data-chips="first-and-rest" className="hidden min-w-0 flex-nowrap items-center gap-1 @min-[96px]:flex">
        <Chip
          label={first.label}
          className={`min-w-[56px] max-w-full shrink ${first.className ?? ''}`}
        />
        <TooltipHint hint={rest}>
          <span className="shrink-0" aria-label={rest}>
            <Chip label={`+${hidden.length}`} />
          </span>
        </TooltipHint>
      </div>
      <div data-chips="count" className="flex items-center @min-[96px]:hidden">
        <TooltipHint hint={all}>
          <span className="shrink-0" aria-label={all}>
            <Chip label={`${items.length}`} />
          </span>
        </TooltipHint>
      </div>
    </div>
  );
};
