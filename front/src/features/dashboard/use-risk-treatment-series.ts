import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '../../lib';
import { AGGREGATE_RISK_WINDOW_DAYS } from './aggregate-risk-utils';

/** One scenario's day-by-day readings over the aggregate window, read only once `enabled`. */
export const useRiskTreatmentSeries = (riskScenarioId: string, enabled: boolean) => {
  const trpc = useTRPC();
  return useQuery(trpc.dashboard.getRiskTreatmentSeries.queryOptions(
    { riskScenarioId, windowDays: AGGREGATE_RISK_WINDOW_DAYS },
    { enabled },
  ));
};
