import { Skeleton } from '@filigran/ui';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import { useTRPC } from '../../../../lib';
import { useRiskTreatmentSeries } from '../../../dashboard/use-risk-treatment-series';
import { LossExceedanceCard } from '../../../dashboard/widgets/loss-exceedance-card';

export const ScenarioLossExceedanceCard: FunctionComponent<{ riskScenarioId: string }> = ({ riskScenarioId }) => {
  const trpc = useTRPC();
  const { data } = useQuery(trpc.dashboard.getRiskTreatment.queryOptions({ riskScenarioId }));
  const card = data?.at(0);
  const { data: series, isPending } = useRiskTreatmentSeries(riskScenarioId, card?.simulated === true);
  const today = new Date().toISOString().slice(0, 10);

  if (data === undefined) {
    return <Skeleton className="h-80 w-full" />;
  }
  if (card === undefined || !card.simulated) {
    return null;
  }
  return <LossExceedanceCard card={card} series={series} seriesPending={isPending} today={today} />;
};
