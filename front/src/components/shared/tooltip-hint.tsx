import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@filigran/design-system';
import { useRef } from 'react';
import type { FunctionComponent, ReactNode, SyntheticEvent } from 'react';

/** Long enough not to fire while the pointer crosses a row, short enough to feel immediate. */
export const TOOLTIP_OPEN_DELAY_MS = 200;

/** One provider per row of hinted elements, rather than one per element. */
export const TooltipHintProvider: FunctionComponent<{ children: ReactNode }> = ({ children }) => (
  <TooltipProvider delayDuration={TOOLTIP_OPEN_DELAY_MS}>{children}</TooltipProvider>
);

interface TooltipHintProps {
  hint: ReactNode,
  children: ReactNode,
  /**
   * Keep the hint open when the trigger is pressed (and open it on a press when it was closed).
   * For a trigger that does nothing on press, such as an `aria-disabled` control, whose hint is the
   * only answer the press can get; never for a trigger with an action of its own.
   */
  keepOpenOnPress?: boolean,
}

/** Marks the press as handled, so the tooltip's own close-on-press and skip-focus-open steps do not run. */
const keepOpen = (event: SyntheticEvent) => event.preventDefault();

/**
 * What a `title` attribute was doing, on the design system's anatomy: a jargon term said in words,
 * or a truncated value shown in full.
 *
 * The child is the trigger as-is, so an inline element stays inline and gains no button semantics.
 * A non-focusable trigger opens on hover only, which is the design system's own inline pattern; the
 * same information must therefore reach assistive technology another way, through the element's own
 * accessible name or its container's.
 */
export const TooltipHint: FunctionComponent<TooltipHintProps> = ({ hint, children, keepOpenOnPress }) => {
  const triggerRef = useRef<HTMLButtonElement>(null);
  /** The open hint treats a press on its own trigger as a press outside it: keep it open for that one. */
  const keepOpenOnTriggerPress = (event: Event) => {
    if (event.target instanceof Node && triggerRef.current?.contains(event.target)) {
      event.preventDefault();
    }
  };
  return (
    <Tooltip>
      <TooltipTrigger
        asChild
        ref={triggerRef}
        onPointerDown={keepOpenOnPress ? keepOpen : undefined}
        onClick={keepOpenOnPress ? keepOpen : undefined}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent onPointerDownOutside={keepOpenOnPress ? keepOpenOnTriggerPress : undefined}>{hint}</TooltipContent>
    </Tooltip>
  );
};
