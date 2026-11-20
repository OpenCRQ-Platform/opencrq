import { Chip, Tooltip, TooltipContent, TooltipTrigger } from '@filigran/design-system';
import type { ScenarioReadiness, ScenarioReadinessStatus } from '@app/module/client';
import type { FunctionComponent } from 'react';
import { TooltipHintProvider } from '../../../../components/shared';
import {
  getScenarioInputLabel,
  getScenarioReadinessExplanation,
  getScenarioReadinessLabel,
} from './scenario-readiness-labels';

const SEVERITIES: Record<ScenarioReadinessStatus, 'info' | 'high' | 'medium' | 'neutral'> = {
  'no-mapped-asset': 'medium',
  ready: 'info',
  stale: 'high',
  incomplete: 'medium',
  'not-simulated': 'neutral',
};

interface ScenarioReadinessBadgeProps {
  readiness: ScenarioReadiness,
}

export const ScenarioReadinessBadge: FunctionComponent<ScenarioReadinessBadgeProps> = ({ readiness }) => {
  const { status, missing, outdated } = readiness;
  const details = status === 'incomplete' ? missing : status === 'stale' ? outdated : [];

  return (
    <TooltipHintProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Chip
            severity={SEVERITIES[status]}
            tabIndex={0}
            className="w-fit whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 ring-focus"
            label={getScenarioReadinessLabel(status)}
          />
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>{getScenarioReadinessExplanation(status)}</p>
          {details.length > 0 && (
            <ul className="mt-1 list-disc pl-4">
              {details.map((kind) => <li key={kind}>{getScenarioInputLabel(kind)}</li>)}
            </ul>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipHintProvider>
  );
};
