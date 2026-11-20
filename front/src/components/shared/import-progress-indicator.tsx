import { Tooltip, TooltipContent, TooltipTrigger } from '@filigran/design-system';
import type { FunctionComponent, ReactNode } from 'react';
import { TooltipHintProvider } from './tooltip-hint';

interface ImportProgressIndicatorProps {
  /** What's being imported, e.g. "Initial import from the OpenCTI Live Stream". */
  label: ReactNode,
  /** Optional supporting detail, e.g. an item count, shown in the tooltip. */
  detail?: ReactNode,
  /**
   * 0-100, renders as a full-width bottom-edge bar filling from gray to blue. No percent/date text.
   * `null` still shows the empty gray track (progress not known yet); `undefined` hides the bar
   * entirely (this import has no progress concept at all).
   */
  progressPercent?: number | null,
}

/**
 * Generic "an import is running in the background" badge — a pulsing dot, an optional bottom-edge
 * progress bar, and a tooltip with details. Reusable for future import sources beyond OpenCTI.
 */
export const ImportProgressIndicator: FunctionComponent<ImportProgressIndicatorProps> = ({ label, detail, progressPercent }) => (
  <TooltipHintProvider>
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="relative flex shrink-0 cursor-default items-center gap-2 overflow-hidden whitespace-nowrap rounded-full border px-3 py-1.5 focus-visible:outline-none focus-visible:ring-2 ring-focus"
          role="status"
          tabIndex={detail ? 0 : undefined}
        >
          <span className="relative flex size-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex size-2.5 rounded-full bg-primary" />
          </span>
          <span className="txt-sub-content text-muted-foreground">{label}</span>
          {progressPercent !== undefined && (
            <span className="absolute inset-x-0 bottom-0 h-1 bg-muted">
              <span className="block h-full bg-primary transition-[width]" style={{ width: `${progressPercent ?? 0}%` }} />
            </span>
          )}
        </div>
      </TooltipTrigger>
      {detail && <TooltipContent>{detail}</TooltipContent>}
    </Tooltip>
  </TooltipHintProvider>
);
