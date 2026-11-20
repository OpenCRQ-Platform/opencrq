import { Icon, Tooltip, TooltipContent, TooltipTrigger } from '@filigran/design-system';
import type { FunctionComponent, ReactNode } from 'react';
import { TooltipHintProvider } from './tooltip-hint';

interface InfoTooltipProps {
  /** Accessible name of the trigger, since the glyph carries none. */
  label: string,
  children: ReactNode,
  side?: 'top' | 'right' | 'bottom' | 'left',
}

/**
 * The question mark beside a label, the design system's own anatomy.
 *
 * Content stays informational: the design system reserves interactive content for a Popover, and
 * its tooltip caps at 300px, so what goes in here is a definition, never a panel.
 */
export const InfoTooltip: FunctionComponent<InfoTooltipProps> = ({ label, children, side }) => (
  <TooltipHintProvider>
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="inline-flex shrink-0 cursor-help items-center justify-center rounded-[var(--fds-radius-sm)] text-default-secondary hover:text-default-primary"
        >
          <Icon name="circle-question-mark" size={16} />
        </button>
      </TooltipTrigger>
      <TooltipContent side={side ?? 'right'}>
        <span className="flex flex-col gap-2">{children}</span>
      </TooltipContent>
    </Tooltip>
  </TooltipHintProvider>
);
