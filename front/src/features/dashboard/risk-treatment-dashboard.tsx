import { Paper, Text } from '@filigran/design-system';
import { Skeleton } from '@filigran/ui';
import { Trans } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import { useTRPC } from '../../lib';
import { RiskTreatmentScenarioCard } from './widgets/risk-treatment-scenario-card';

interface RiskTreatmentDashboardProps {
  organizationId?: string,
}

export const RiskTreatmentDashboard: FunctionComponent<RiskTreatmentDashboardProps> = ({ organizationId }) => {
  const trpc = useTRPC();
  const { data } = useQuery(trpc.dashboard.getRiskTreatment.queryOptions({ organizationId }));
  const today = new Date().toISOString().slice(0, 10);

  if (data === undefined) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-96 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <Paper elevation={1}>
        <Text as="p" variant="content-base" className="text-default-secondary">
          <Trans>No risk scenario in this scope yet.</Trans>
        </Text>
      </Paper>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {data.map((card) => <RiskTreatmentScenarioCard key={card.scenarioId} card={card} today={today} />)}
    </div>
  );
};
