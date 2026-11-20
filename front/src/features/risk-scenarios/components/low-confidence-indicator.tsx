import { Tooltip, TooltipContent, TooltipTrigger } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { CircleAlert } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { TooltipHintProvider } from '../../../components/shared';

interface LowConfidenceIndicatorProps {
  lowConfidence: boolean,
}

/**
 * "This number rests on a weak assumption," independent of the provenance badge so the two can
 * co-occur without reading as one combined state — same tooltip-icon idiom as
 * `ScenarioReadinessFlag`, kept a separate icon so the two concepts stay visually distinct.
 */
export const LowConfidenceIndicator: FunctionComponent<LowConfidenceIndicatorProps> = ({ lowConfidence }) => {
  if (!lowConfidence) {
    return null;
  }
  const explanation = t`This estimate is derived through a proxy or a weak coefficient and should be treated as an approximation.`;

  return (
    <TooltipHintProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="img"
            tabIndex={0}
            aria-label={explanation}
            className="flex shrink-0 cursor-default text-feedback-warning-primary focus-visible:outline-none focus-visible:ring-2 ring-focus"
          >
            <CircleAlert className="h-3 w-3" aria-hidden="true" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>{explanation}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipHintProvider>
  );
};
