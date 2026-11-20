import { useQuery } from '@tanstack/react-query';
import type { FlowScenarioInput, TechniqueLabel } from './exposure-flow-utils';
import { useTRPC } from '../../lib';
import { computePert } from '../../utils';
import { actorNodeId } from './exposure-flow-utils';

/**
 * Everything the flow dashboard needs, from one endpoint.
 *
 * `dashboard.getExposureFlow` does the join server-side: latest run per scenario, its group and
 * technique scores, and the scenario's loss estimates, all batched by scope. What is left here is
 * the two things that genuinely belong on the client, because they are presentation rather than
 * data: the PERT expectation over each driver's three bounds, and the per-actor average of the
 * vulnerability the engine already persisted.
 *
 * This replaces a 2N+2 fan-out (`getRunWithScores` and `getScenarioLossEstimates` once per
 * scenario, plus the whole ATT&CK catalogue and the outcome catalogue to resolve labels and ids).
 * `httpBatchLink` collapsed each wave into one HTTP request, which hid the shape but not the
 * cost: the server still ran 2N queries and the client still held every technique row of every
 * run. Technique labels and the outcome id now travel with the rows that need them.
 */
export interface ExposureFlowData {
  isLoading: boolean,
  scenarios: Array<FlowScenarioInput>,
  techniqueLabels: Map<string, TechniqueLabel>,
  /**
   * Vulnerability conditional on each actor node, keyed by its node id, averaged over the
   * scenarios that admit it. Persisted per run in `crq_indicator_group_scores`.
   */
  actorVulnerability: Map<string, number>,
  scenarioCount: number,
  simulatedCount: number,
  /**
   * Scenarios with no run at all. They need a CRQ simulation before anything can be priced.
   */
  unsimulatedScenarios: Array<ScenarioRef>,
  /**
   * Scenarios that HAVE been simulated but whose run carries no annual loss figure, because
   * the scenario has no complete loss-driver estimate so SLE, and therefore ALE, is null.
   * They are excluded from the flow, and saying so is the difference between a dashboard
   * that looks broken and one that tells you what to fill in.
   */
  unpricedScenarios: Array<ScenarioRef>,
  /** Scenarios whose closed scope maps no asset: mapping assets is the remedy, not a run. */
  unmappedScenarios: Array<ScenarioRef>,
  /**
   * True when the aggregate itself failed. One query now stands behind the whole diagram, so a
   * failure is total rather than per scenario, and the widget has to say so instead of drawing an
   * empty Sankey that reads as "no exposure". TanStack clears `isLoading` on error, so without
   * this the error state is indistinguishable from an empty portfolio.
   */
  hasError: boolean,
  /**
   * The sum of the scenarios' means, with no band: summing per-scenario p10s and p90s assumes every
   * scenario has its extreme year at once, a stress bound presented as a portfolio figure.
   */
  totals: { aleMean: number | null },
}

export interface ScenarioRef {
  id: string,
  name: string,
  organizationId: string,
}

export const useExposureFlowData = (organizationId?: string): ExposureFlowData => {
  const trpc = useTRPC();
  const flowQuery = useQuery(trpc.dashboard.getExposureFlow.queryOptions({ organizationId }));
  const data = flowQuery.data;

  const techniqueLabels = new Map<string, TechniqueLabel>();
  const actorVulnerabilitySamples = new Map<string, Array<number>>();
  const scenarios: Array<FlowScenarioInput> = [];

  for (const scenario of data?.scenarios ?? []) {
    for (const technique of scenario.techniques) {
      techniqueLabels.set(technique.techniqueId, {
        externalId: technique.externalId,
        name: technique.name,
      });
    }
    for (const group of scenario.groups) {
      if (group.key === null) {
        continue;
      }
      const id = actorNodeId(group);
      const samples = actorVulnerabilitySamples.get(id) ?? [];
      samples.push(group.vulnerabilityMean);
      actorVulnerabilitySamples.set(id, samples);
    }
    scenarios.push({
      scenarioId: scenario.scenarioId,
      outcomeName: scenario.outcomeName,
      outcomeId: scenario.outcomeId,
      ale: scenario.ale,
      groups: scenario.groups.map((group) => ({
        key: group.key,
        name: group.name,
        share: group.share,
        actorClass: group.actorClass,
      })),
      techniques: scenario.techniques.map((technique) => ({
        techniqueId: technique.techniqueId,
        value: technique.value,
      })),
      // The three bounds arrive whole or not at all: the aggregate drops any partly-filled row,
      // because the engine treats a missing bound as no estimate and so must the split.
      driverExpectations: scenario.driverExpectations.map((driver) => ({
        driverId: driver.driverId,
        name: driver.name,
        expected: computePert(driver.minValue, driver.likelyValue, driver.maxValue),
      })),
    });
  }

  const unsimulatedScenarios = data?.unsimulatedScenarios ?? [];
  const unpricedScenarios = data?.unpricedScenarios ?? [];
  const unmappedScenarios = data?.unmappedScenarios ?? [];

  return {
    isLoading: flowQuery.isLoading,
    scenarios,
    techniqueLabels,
    actorVulnerability: new Map([...actorVulnerabilitySamples].map(([key, samples]) => [
      key,
      samples.reduce((sum, value) => sum + value, 0) / samples.length,
    ])),
    scenarioCount: scenarios.length + unsimulatedScenarios.length + unpricedScenarios.length + unmappedScenarios.length,
    simulatedCount: scenarios.length + unpricedScenarios.length,
    unsimulatedScenarios,
    unpricedScenarios,
    unmappedScenarios,
    hasError: flowQuery.isError,
    totals: data?.totals ?? { aleMean: null },
  };
};
