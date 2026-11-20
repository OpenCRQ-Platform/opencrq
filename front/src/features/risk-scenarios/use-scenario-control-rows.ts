import { useQuery } from '@tanstack/react-query';
import type { CoverageBucket, PostureSource, StrengthRung } from '@app/module/client';
import type { MitreTechniqueSummary } from './risk-scenario-utils';
import type { TopControlToImprove, WhatIfEntry } from './scenario-control-rows-utils';
import { useTRPC } from '../../lib';
import { isControlDeployed } from './risk-scenario-utils';
import { bestAleReduction, groupWhatIfByControl, isControlAtMaximum, isWhatIfStale, selectTopControls } from './scenario-control-rows-utils';

export type { TopControlToImprove, WhatIfEntry } from './scenario-control-rows-utils';

export interface ControlRow {
  id: string,
  name: string,
  externalId: string,
  ttps: Array<MitreTechniqueSummary>,
  /** The posture of the scenario's own scope, the one its run is priced on. */
  strengthRung: StrengthRung,
  coverageBucket: CoverageBucket,
  strengthSource: PostureSource,
  coverageSource: PostureSource,
  /** Deployed = above the L0/L0 baseline. */
  isDeployed: boolean,
  isAssessed: boolean,
}

const TOP_CONTROLS_LIMIT = 3;

interface UseScenarioControlRowsParams {
  riskScenarioId: string,
  organizationId: string,
  attackOutcomeId: string,
}

export const useScenarioControlRows = ({ riskScenarioId, organizationId, attackOutcomeId }: UseScenarioControlRowsParams) => {
  const trpc = useTRPC();
  const { data: capabilities, isLoading: isLoadingCapabilities } = useQuery(trpc.riskScenarios.getControlCapabilitiesForRiskScenario.queryOptions({ riskScenarioId }));
  const { data: outcomeTechniquesData, isLoading: isLoadingTechniques } = useQuery(trpc.attackOutcomes.getMitreTechniquesForOutcome.queryOptions({ attackOutcomeId, organizationId }));
  const { data: latestRun } = useQuery(trpc.crqIndicators.getLatestRun.queryOptions({ riskScenarioId }));
  const { data: whatIfResults } = useQuery(trpc.crqIndicators.getWhatIfResults.queryOptions({ riskScenarioId }));

  if (!capabilities || !outcomeTechniquesData) {
    return {
      tableData: [] as Array<ControlRow>,
      whatIfByControl: new Map<string, Array<WhatIfEntry>>(),
      hasWhatIfData: false,
      isWhatIfStale: false,
      maxedControlIds: new Set<string>(),
      scenarioTtpIds: [] as Array<string>,
      topControlsToImprove: [] as Array<TopControlToImprove>,
      latestRun: undefined,
      isMixturePending: false,
      isLoading: isLoadingCapabilities || isLoadingTechniques,
    };
  }

  const scenarioMitreTechniques: Array<MitreTechniqueSummary> = outcomeTechniquesData.techniques
    .filter((tech) => tech.weight > 0)
    .map((tech) => ({ id: tech.mitreTechniqueId, externalId: tech.externalId, name: tech.name }));
  const scenarioTtpIds = scenarioMitreTechniques.map((tech) => tech.id);
  const scenarioTtpSet = new Set(scenarioTtpIds);
  const ttpMap = new Map(scenarioMitreTechniques.map((tech) => [tech.id, tech]));

  const { whatIfByControl, hasWhatIfData } = groupWhatIfByControl(
    whatIfResults ?? [],
    new Set(capabilities.map((c) => c.id)),
  );

  // The engine prices a control on the actors' whole repertoires, which is wider than the outcome's
  // curated techniques, so a control the run priced is listed even when it covers none of them.
  const rows: Array<ControlRow> = capabilities
    .filter((c) => whatIfByControl.has(c.id) || c.mitreTechniqueIds.some((id) => scenarioTtpSet.has(id)))
    .map((c) => ({
      id: c.id,
      name: c.name,
      externalId: c.externalId,
      ttps: c.mitreTechniqueIds
        .filter((id) => scenarioTtpSet.has(id))
        .map((id) => ttpMap.get(id))
        .filter((tech): tech is MitreTechniqueSummary => tech !== undefined),
      strengthRung: c.strengthRung,
      coverageBucket: c.coverageBucket,
      strengthSource: c.strengthSource,
      coverageSource: c.coverageSource,
      isDeployed: isControlDeployed(c.strengthRung, c.coverageBucket),
      isAssessed: c.isAssessed,
    }));

  const maxedControlIds = new Set(capabilities.filter(isControlAtMaximum).map((c) => c.id));

  const tableData: Array<ControlRow> = hasWhatIfData
    ? [...rows].sort((a, b) => bestAleReduction(whatIfByControl.get(b.id)) - bestAleReduction(whatIfByControl.get(a.id)))
    : rows;

  const controlById = new Map(rows.map((row) => [row.id, { externalId: row.externalId, name: row.name }]));

  return {
    tableData,
    whatIfByControl,
    hasWhatIfData,
    isWhatIfStale: hasWhatIfData && isWhatIfStale(capabilities, whatIfByControl),
    maxedControlIds,
    scenarioTtpIds,
    topControlsToImprove: hasWhatIfData ? selectTopControls(whatIfByControl, controlById, TOP_CONTROLS_LIMIT) : [],
    latestRun,
    isMixturePending: outcomeTechniquesData.evidenceMode === 'mixture-pending',
    isLoading: isLoadingCapabilities,
  };
};
