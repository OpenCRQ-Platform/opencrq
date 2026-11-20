import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@filigran/design-system';
import type { FunctionComponent, ReactNode } from 'react';

/** Long enough not to fire while the pointer crosses a row, short enough to feel immediate. */
export const TOOLTIP_OPEN_DELAY_MS = 200;

/** One provider per row of hinted elements, rather than one per element. */
export const TooltipHintProvider: FunctionComponent<{ children: ReactNode }> = ({ children }) => (
  <TooltipProvider delayDuration={TOOLTIP_OPEN_DELAY_MS}>{children}</TooltipProvider>
);

interface TooltipHintProps {
  hint: ReactNode,
  children: ReactNode,
}

/**
 * What a `title` attribute was doing, on the design system's anatomy: a jargon term said in words,
 * or a truncated value shown in full.
 *
 * The child is the trigger as-is, so an inline element stays inline and gains no button semantics.
 * A non-focusable trigger opens on hover only, which is the design system's own inline pattern; the
 * same information must therefore reach assistive technology another way, through the element's own
 * accessible name or its container's.
 */
export const TooltipHint: FunctionComponent<TooltipHintProps> = ({ hint, children }) => (
  <Tooltip>
    <TooltipTrigger asChild>{children}</TooltipTrigger>
    <TooltipContent>{hint}</TooltipContent>
  </Tooltip>
);
