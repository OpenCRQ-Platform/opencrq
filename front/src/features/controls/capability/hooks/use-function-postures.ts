import type { CapabilityFunction } from '@app/module/client';
import type { CapabilityDetail } from '../types/capability';
import type { ProvenPosture } from '../utils/validation-summary-utils';
import { isSimulationReachable, posturePerFunction } from '../utils/function-posture-utils';
import { isNotDeployedOnScope } from '../utils/scope-posture-utils';
import { useCapabilityValidation } from './use-capability-validation';
import { useCapabilityScopePosture } from './use-scope-posture';

interface FunctionPostures {
  /** Undefined while the scope is awaited, or when no simulation result can be shown. */
  postureOf: (capabilityFunction: CapabilityFunction) => ProvenPosture | undefined,
  notDeployedOnScope: boolean,
}

export const useFunctionPostures = (capability: CapabilityDetail): FunctionPostures => {
  const validation = useCapabilityValidation(capability.id, isSimulationReachable(capability));
  const cells = [...validation.cellByTechnique.values()];
  const { posture: scopePosture, isAwaitingScope } = useCapabilityScopePosture(capability.id);
  return {
    postureOf: (capabilityFunction) =>
      (validation.isVisible && !isAwaitingScope ? posturePerFunction(cells, capability.edges, capabilityFunction) : undefined),
    notDeployedOnScope: scopePosture !== undefined && isNotDeployedOnScope(scopePosture),
  };
};
