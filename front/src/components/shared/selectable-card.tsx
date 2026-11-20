import { Icon } from '@filigran/design-system';
import type { FunctionComponent, ReactNode } from 'react';
import { cn } from '../../utils';

interface SelectableCardProps {
  selected: boolean,
  onToggle: () => void,
  children: ReactNode,
  /** Drawn dashed, for an option that stands for the absence of a real choice. */
  placeholder?: boolean,
  /** Drawn dashed and inert, for an option another choice already holds. */
  disabled?: boolean,
  className?: string,
}

export const SelectableCard: FunctionComponent<SelectableCardProps> = ({ selected, onToggle, children, placeholder, disabled, className }) => (
  <button
    type="button"
    aria-pressed={selected}
    disabled={disabled}
    onClick={onToggle}
    className={cn(
      'flex min-h-12 items-center justify-between gap-2 rounded-[var(--fds-radius-sm)] px-3 text-left txt-body2 transition-colors focus-visible:outline-none focus-visible:ring-2 ring-focus',
      disabled ? 'cursor-not-allowed border border-dashed border-elevation-default text-default-secondary' : 'hover:bg-elevation-hover',
      !disabled && selected && 'border-2 border-[color:var(--fds-text-default-primary)] bg-elevation-highlight font-medium text-default-primary',
      !disabled && !selected && placeholder && 'border border-dashed border-elevation-default text-default-secondary',
      !disabled && !selected && !placeholder && 'border border-elevation-subtle',
      className,
    )}
  >
    <span className="min-w-0">{children}</span>
    {selected && !disabled && <Icon name="check" size={16} aria-hidden />}
  </button>
);
