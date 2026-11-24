import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import { useState } from 'react';
import type { PeriodWindowId } from '../../../../components/shared';
import { DEFAULT_PERIOD_WINDOW, periodWindowDays } from '../../../../components/shared';
import { useTRPC } from '../../../../lib';
import { formatDateTime } from '../../../../utils';
import { useScenarioControlRows } from '../../use-scenario-control-rows';
import { ScenarioConfigurationAccordion } from '../scenario-configuration-accordion';
import { useMissingDataItems } from '../use-missing-data-items';
import { AleDecompositionCard } from './ale-decomposition-card';
import { DescriptionCard } from './description-card';
import { FindingsSummaryCard } from './findings-summary-card';
import { MostActiveThreatsCard } from './most-active-threats-card';
import { ScenarioLossExceedanceCard } from './scenario-loss-exceedance-card';
import { TechniqueCoverageCard } from './technique-coverage-card';
import { TopControlsCard } from './top-controls-card';

interface RiskScenarioOverviewProps {
  riskScenario: {
    id: string,
    organizationId: string,
    description: string | null,
    primaryAssets: Array<{ id: string, name: string }>,
    attackOutcome: { id: string, name: string } | null,
    owner: { id: string, name: string | null } | null,
  },
}

export const RiskScenarioOverview: FunctionComponent<RiskScenarioOverviewProps> = ({ riskScenario }) => {
  const trpc = useTRPC();
  const { topControlsToImprove, hasWhatIfData, isWhatIfStale, isMixturePending, isLoading: isLoadingControls, latestRun } = useScenarioControlRows({
    riskScenarioId: riskScenario.id,
    organizationId: riskScenario.organizationId,
    attackOutcomeId: riskScenario.attackOutcome?.id ?? '',
  });

  const { data: scope } = useQuery(trpc.organizations.getOrganization.queryOptions({ id: riskScenario.organizationId }));
  // Read from the scope as it stands, never from the run: a scope that maps nothing holds figures
  // priced over assets it no longer contains, and no new run can replace them while it is empty.
  const noMappedAsset = scope?.noMappedAsset ?? false;

  const missingDataItems = useMissingDataItems({
    riskScenarioId: riskScenario.id,
    whatIfStale: isWhatIfStale,
    noMappedAsset,
  });

  const [windowId, setWindowId] = useState<PeriodWindowId>(DEFAULT_PERIOD_WINDOW);
  const { data: timeline, isPlaceholderData } = useQuery(trpc.crqIndicators.getRunTimeline.queryOptions(
    { riskScenarioId: riskScenario.id, windowDays: periodWindowDays(windowId) },
    { placeholderData: keepPreviousData },
  ));

  const currentRun = noMappedAsset ? null : latestRun;
  const techniqueCount = currentRun?.techniqueCount ?? null;
  const coveredTechniqueCount = currentRun?.coveredTechniqueCount ?? null;

  return (
    <div className="flex flex-col gap-4">
      <ScenarioConfigurationAccordion items={missingDataItems} />
      <AleDecompositionCard
        timeline={timeline}
        unavailable={noMappedAsset || timeline?.latest.length === 0}
        pending={isPlaceholderData}
        windowId={windowId}
        onWindowChange={setWindowId}
      />
      {!noMappedAsset && <ScenarioLossExceedanceCard riskScenarioId={riskScenario.id} />}
      <DescriptionCard
        riskScenarioId={riskScenario.id}
        description={riskScenario.description}
        primaryAssets={riskScenario.primaryAssets}
        attackOutcome={riskScenario.attackOutcome}
        owner={riskScenario.owner}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[repeat(2,minmax(0,1fr))]">
        <MostActiveThreatsCard riskScenarioId={riskScenario.id} />
        <TechniqueCoverageCard
          techniqueCount={techniqueCount}
          coveredTechniqueCount={coveredTechniqueCount}
          runDate={currentRun ? formatDateTime(currentRun.createdAt) : null}
        />
      </div>

      <TopControlsCard
        topControlsToImprove={topControlsToImprove}
        isLoading={isLoadingControls}
        hasWhatIfData={hasWhatIfData && !noMappedAsset}
        isMixturePending={isMixturePending}
      />

      <FindingsSummaryCard riskScenarioId={riskScenario.id} />
    </div>
  );
};
