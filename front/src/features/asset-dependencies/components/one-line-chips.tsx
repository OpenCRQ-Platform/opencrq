import { Chip } from '@filigran/design-system';
import type { FunctionComponent } from 'react';
import { TooltipHint } from '../../../components/shared/tooltip-hint';

interface OneLineChipsProps {
  items: ReadonlyArray<{ key: string, label: string, className?: string }>,
}

/** How many chips show before the `+n` chip. */
const SHOWN = 1;

/**
 * Chips on one line, so every row of a table keeps one height (Design standards s.3): the first
 * chips shrink and are cut (the design system Chip shows a cut label whole in its own tooltip), and
 * the rest collapse into a `+n` chip whose tooltip lists them. Under a `TooltipHintProvider`.
 */
export const OneLineChips: FunctionComponent<OneLineChipsProps> = ({ items }) => {
  const shown = items.slice(0, SHOWN);
  const hidden = items.slice(SHOWN);
  const rest = hidden.map((item) => item.label).join(', ');
  return (
    <div className="flex min-w-0 flex-nowrap items-center gap-1 overflow-hidden">
      {shown.map((item) => (
        <Chip key={item.key} label={item.label} className={`min-w-0 max-w-full shrink ${item.className ?? ''}`} />
      ))}
      {hidden.length > 0 && (
        <TooltipHint hint={rest}>
          <span className="shrink-0" aria-label={rest}>
            <Chip label={`+${hidden.length}`} />
          </span>
        </TooltipHint>
      )}
    </div>
  );
};
