import { msg } from '@lingui/core/macro';
import type { CapabilityFunction } from '@app/module/client';
import { useMutation } from '@tanstack/react-query';
import { useTRPC } from '../../../../lib';

/** A control's link to a technique, on one function. */
export interface TechniqueLinkTarget {
  capabilityId: string,
  techniqueId: string,
  function: CapabilityFunction,
}

interface TechniqueLink {
  /** `isRemoved`: the technique was unlinked from the control, which the server restores but refuses to add again. */
  link: (target: TechniqueLinkTarget, isRemoved: boolean) => void,
  unlink: (target: TechniqueLinkTarget) => void,
  isPending: boolean,
}

export const useTechniqueLink = (onSuccess?: () => unknown): TechniqueLink => {
  const trpc = useTRPC();
  const linked = { meta: { successMessage: msg`Technique linked successfully.` }, onSuccess };
  const addTechnique = useMutation(trpc.controlCapabilities.addTechniqueOverride.mutationOptions(linked));
  const restoreTechnique = useMutation(trpc.controlCapabilities.restoreTechnique.mutationOptions(linked));
  const removeTechnique = useMutation(trpc.controlCapabilities.removeTechnique.mutationOptions({
    meta: { successMessage: msg`Technique unlinked successfully.` },
    onSuccess,
  }));
  return {
    link: (target, isRemoved) => {
      if (isRemoved) {
        restoreTechnique.mutate(target);
      } else {
        addTechnique.mutate(target);
      }
    },
    unlink: (target) => removeTechnique.mutate(target),
    isPending: addTechnique.isPending || restoreTechnique.isPending || removeTechnique.isPending,
  };
};
