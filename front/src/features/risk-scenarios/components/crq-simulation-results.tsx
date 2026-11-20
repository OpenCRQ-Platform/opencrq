import { Button, Paper } from '@filigran/design-system';
import { useNavigate } from '@tanstack/react-router';
import { Trans } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import { tabForAction } from '../../organizations/scope-drawer-tabs';
import { useTRPC } from '../../../lib';
import { CrqActorsCard, CrqFrequencyCard, CrqLossCard, CrqOutcomeCard, CrqProvenanceCard, CrqReachCard } from './crq-run-cards';
import { CrqTechniqueBreakdown } from './crq-technique-breakdown';

interface CrqSimulationResultsProps {
  riskScenarioId: string,
  organizationId: string,
}

export const CrqSimulationResults: FunctionComponent<CrqSimulationResultsProps> = ({ riskScenarioId, organizationId }) => {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const { data: latestRun } = useQuery(trpc.crqIndicators.getLatestRun.queryOptions({ riskScenarioId }));
  const { data: scope } = useQuery(trpc.organizations.getOrganization.queryOptions({ id: organizationId }));
  const { data: detail } = useQuery(trpc.crqIndicators.getRunWithScores.queryOptions(
    { runId: latestRun?.id ?? '' },
    { enabled: latestRun != null },
  ));

  // A closed scope holding nothing retires whatever figure is on file: the estate it was priced
  // over is gone, and the next run cannot start until assets are mapped back in.
  if (scope?.noMappedAsset === true) {
    return (
      <Paper className="flex flex-col items-center gap-3 p-[32px_24px] text-center">
        <p className="txt-sub-content text-muted-foreground">
          <Trans>Not priced: no mapped asset. This risk scope is measured over the assets mapped into it and holds none.</Trans>
        </p>
        <Button
          priority="secondary"
          onClick={() => void navigate({
            to: '/$tenantId/{-$organizationId}/details/overview',
            params: (prev) => ({ ...prev, tenantId: prev.tenantId!, organizationId }),
            search: { scopeDrawerTab: tabForAction('manage-assets') },
          })}
        >
          <Trans>Manage assets</Trans>
        </Button>
      </Paper>
    );
  }

  if (latestRun == null) {
    return (
      <Paper className="text-center p-[32px_24px]">
        <p className="txt-sub-content text-muted-foreground">
          <Trans>No simulation has been run yet. Click "Run Simulation" to compute CRQ indicators.</Trans>
        </p>
      </Paper>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <CrqOutcomeCard run={latestRun} />
        <CrqFrequencyCard run={latestRun} />
        <CrqLossCard run={latestRun} />
        <CrqProvenanceCard run={latestRun} />
      </div>
      {detail != null && (
        <>
          <CrqActorsCard detail={detail} />
          <CrqReachCard detail={detail} />
          <CrqTechniqueBreakdown riskScenarioId={riskScenarioId} techniques={detail.techniqueWhatIfResults} />
        </>
      )}
    </div>
  );
};
