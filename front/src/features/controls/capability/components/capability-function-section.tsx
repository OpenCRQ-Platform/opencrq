import { Paper } from '@filigran/design-system';
import type { CapabilityFunction } from '@app/module/client';
import { t } from '@lingui/core/macro';
import type { FunctionComponent, ReactNode } from 'react';
import type { LifelineGuide } from '../hooks/use-lifeline-guide';
import type { CapabilityDetail } from '../types/capability';
import type { ProvenPosture } from '../utils/validation-summary-utils';
import { DashboardGroup } from '../../../../components/shared';
import { measuredPosture } from '../utils/function-posture-utils';
import { FUNCTION_TILE_TONE } from '../utils/technique-matrix-utils';
import { FunctionFigures } from './function-figures';
import { MeasuredLifeline } from './measured-lifeline';

interface CapabilityFunctionSectionProps {
  capability: CapabilityDetail,
  capabilityFunction: CapabilityFunction,
  posture: ProvenPosture | undefined,
  notDeployedOnScope: boolean,
  action?: ReactNode,
  guide: LifelineGuide,
}

export const CapabilityFunctionSection: FunctionComponent<CapabilityFunctionSectionProps> = ({
  capability,
  capabilityFunction,
  posture,
  notDeployedOnScope,
  action,
  guide,
}) => {
  const isPrevention = capabilityFunction === 'prevent';
  const figures = (
    <FunctionFigures
      capabilityFunction={capabilityFunction}
      edges={capability.edges}
      posture={posture}
      notDeployedOnScope={notDeployedOnScope}
    />
  );
  return (
    <DashboardGroup
      icon={isPrevention ? 'shield' : 'eye'}
      tone={FUNCTION_TILE_TONE[capabilityFunction]}
      title={isPrevention ? t`Prevention` : t`Detection`}
      action={action}
    >
      {measuredPosture(posture, notDeployedOnScope) === null
        ? <Paper elevation={2} padding={16}>{figures}</Paper>
        : (
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-4">
            <Paper elevation={2} padding={16}>{figures}</Paper>
            <Paper elevation={2} padding={0} className="p-[12px_16px]">
              <MeasuredLifeline
                capabilityId={capability.id}
                capabilityFunction={capabilityFunction}
                guide={guide}
              />
            </Paper>
          </div>
        )}
    </DashboardGroup>
  );
};
