import { useQuery } from '@tanstack/react-query';
import type { RequirementReadiness } from '../drata-utils';
import { useTRPC } from '../../../lib';
import { computeRequirementReadiness } from '../drata-utils';

export const useFrameworkReadiness = (frameworkId: string): RequirementReadiness | null => {
  const trpc = useTRPC();
  const { data } = useQuery(trpc.drata.getRequirements.queryOptions({ frameworkId }));
  return data ? computeRequirementReadiness(data) : null;
};
