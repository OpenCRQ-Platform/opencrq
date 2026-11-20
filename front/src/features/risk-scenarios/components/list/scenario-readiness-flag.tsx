import { Tooltip, TooltipContent, TooltipTrigger } from '@filigran/design-system';
import type { ScenarioReadiness } from '@app/module/client';
import { TriangleAlert } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { TooltipHintProvider } from '../../../../components/shared';
import { getScenarioInputLabel, getScenarioReadinessExplanation } from './scenario-readiness-labels';

interface ScenarioReadinessFlagProps {
  readiness: ScenarioReadiness,
}

/**
 * The mark a stored figure carries when its inputs no longer back it: edited since the run, or never
 * filled in at all. A figure its inputs still back carries nothing, which is what leaves the mark a
 * meaning worth reading.
 *
 * It rides inside the value it qualifies rather than on a line of its own, so a flagged card stays
 * exactly as tall as a healthy one and a grid row keeps its baselines.
 */
export const ScenarioReadinessFlag: FunctionComponent<ScenarioReadinessFlagProps> = ({ readiness }) => {
  const { status, missing, outdated } = readiness;
  const details = status === 'stale' ? outdated : status === 'incomplete' ? missing : [];
  if (details.length === 0) {
    return null;
  }
  const explanation = getScenarioReadinessExplanation(status);
  const inputs = details.map(getScenarioInputLabel);

  return (
    <TooltipHintProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="img"
            tabIndex={0}
            aria-label={`${explanation} ${inputs.join(', ')}`}
            className="flex shrink-0 cursor-default text-feedback-warning-primary focus-visible:outline-none focus-visible:ring-2 ring-focus"
          >
            <TriangleAlert className="h-3 w-3" aria-hidden="true" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>{explanation}</p>
          <ul className="mt-1 list-disc pl-4">
            {details.map((kind, index) => <li key={kind}>{inputs[index]}</li>)}
          </ul>
        </TooltipContent>
      </Tooltip>
    </TooltipHintProvider>
  );
};
