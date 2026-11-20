import { Icon, Tooltip, TooltipContent, TooltipTrigger } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import type { FunctionComponent, ReactNode } from 'react';

/*
 * A bare TooltipTrigger styles no focus at all and falls back to the user agent's outline, so the
 * trigger has to be an explicit button behind `asChild` carrying the design system's focus ring.
 */
// eslint-disable-next-line lingui/no-unlocalized-strings -- Tailwind class list, not copy
const TRIGGER_CLASSES = 'inline-flex shrink-0 items-center justify-center rounded-md p-2 text-[color:var(--fds-color-feedback-info-primary)] hover:bg-[var(--fds-bg-elevation-highlight)] focus-visible:outline-none focus-visible:ring-2 ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-focus';

interface KpiInfoTooltipProps {
  cardLabel: string,
  children: ReactNode,
}

/**
 * A KPI card's entire interaction surface. It is a focusable control so keyboard and screen-reader
 * users get every figure a hover gives.
 */
export const KpiInfoTooltip: FunctionComponent<KpiInfoTooltipProps> = ({ cardLabel, children }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button type="button" aria-label={t`About ${cardLabel}`} className={TRIGGER_CLASSES}>
        <Icon name="circle-question-mark" size={16} className="opacity-85" aria-hidden />
      </button>
    </TooltipTrigger>
    <TooltipContent>{children}</TooltipContent>
  </Tooltip>
);
