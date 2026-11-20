import type { CapabilityFunction } from '@app/module/client';
import type { FunctionComponent } from 'react';
import type { CapabilityDetail } from '../types/capability';
import { useFunctionPostures } from '../hooks/use-function-postures';
import { useLifelineGuide } from '../hooks/use-lifeline-guide';
import { isSimulationReachable } from '../utils/function-posture-utils';
import { CapabilityFunctionSection } from './capability-function-section';
import { CapabilityTechniquesMatrix } from './capability-techniques-matrix';

interface CapabilityFunctionTabProps {
  /** The route's loaded control: section and matrix must read one source, which a technique change refreshes. */
  capability: CapabilityDetail,
  capabilityFunction: CapabilityFunction,
}

export const CapabilityFunctionTab: FunctionComponent<CapabilityFunctionTabProps> = ({ capability, capabilityFunction }) => {
  const { postureOf, notDeployedOnScope } = useFunctionPostures(capability);
  const guideFor = useLifelineGuide<CapabilityFunction>();
  return (
    <div className="flex flex-col gap-4">
      <CapabilityFunctionSection
        capability={capability}
        capabilityFunction={capabilityFunction}
        posture={postureOf(capabilityFunction)}
        notDeployedOnScope={notDeployedOnScope}
        guide={guideFor(capabilityFunction)}
      />
      <CapabilityTechniquesMatrix
        capabilityId={capability.id}
        controlExternalId={capability.externalId}
        edges={capability.edges}
        capabilityFunction={capabilityFunction}
        isReachable={isSimulationReachable(capability)}
      />
    </div>
  );
};
