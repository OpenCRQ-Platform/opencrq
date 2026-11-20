import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';
import { TooltipHint, TooltipHintProvider } from '../../../../components/shared';
import { EmptyValue } from '../../../../components/ui/empty-value';

interface ScenarioTechniqueCoverageProps {
  techniqueCount: number,
  coveredTechniqueCount: number,
}

export const ScenarioTechniqueCoverage: FunctionComponent<ScenarioTechniqueCoverageProps> = ({
  techniqueCount,
  coveredTechniqueCount,
}) => {
  if (techniqueCount === 0) {
    return <EmptyValue />;
  }
  const pct = Math.round((coveredTechniqueCount / techniqueCount) * 100);
  return (
    <TooltipHintProvider>
      <TooltipHint hint={<Trans>Attack techniques covered by at least one deployed control</Trans>}>
        <span tabIndex={0} className="flex items-center gap-1.5 cursor-default focus-visible:outline-none focus-visible:ring-2 ring-focus">
          <span className="h-1 w-10 shrink-0 overflow-hidden rounded-full bg-muted">
            <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
          </span>
          <span className="tabular-nums whitespace-nowrap">
            {coveredTechniqueCount}/{techniqueCount}
          </span>
        </span>
      </TooltipHint>
    </TooltipHintProvider>
  );
};
