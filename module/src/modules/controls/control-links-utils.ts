interface Technique {
  id: string,
  externalId: string,
  name: string,
}

interface ScenarioRef {
  id: string,
  name: string,
  organizationId: string,
  organizationName: string,
  attackOutcomeId: string,
}

interface ControlLinksDeps {
  attackOutcomes: {
    getAllAttackOutcomeIds: () => Promise<Array<string>>,
    getActiveTechniqueIdsByOrganization: (
      outcomeIdsByOrganizationId: ReadonlyMap<string, Array<string>>,
    ) => Promise<Map<string, Map<string, Set<string> | null>>>,
  },
  riskScenarios: {
    findRiskScenariosByAttackOutcomeIds: (outcomeIds: Array<string>, organizationId?: string) => Promise<Array<ScenarioRef>>,
  },
}

interface ControlLinksResult {
  techniques: Array<{ id: string, externalId: string, name: string, sharedTtpCount: number }>,
  riskScenarios: Array<{ id: string, name: string, organizationId: string, organizationName: string, sharedTtpCount: number, mixturePending: boolean }>,
}

/**
 * Computes linked MITRE techniques and risk scenarios for a control, enriched with `sharedTtpCount`.
 *
 * Uses the enriched technique lists (direct + inferred via threat intelligence) so that a control
 * sharing an inferred technique with an attack outcome is still linked to the risk scenario.
 *
 * The active technique set is resolved per (organization, outcome), not per outcome: the weight is
 * an attacker-mixture share computed against the organization's own country and sector, so two
 * scenarios of two organizations sharing an outcome legitimately carry different active sets. The
 * scenarios are therefore read FIRST, and only the outcomes they use are resolved.
 *
 * A scenario whose attacker mixture the job has not computed yet is listed with `mixturePending`,
 * since whether it shares a technique with the control is not known yet.
 *
 * An `organizationId` narrows the result to that organization's scenarios.
 *
 * Shared logic between framework controls and custom controls.
 */
export const computeControlLinks = async (
  techniques: Array<Technique>,
  deps: ControlLinksDeps,
  organizationId?: string,
): Promise<ControlLinksResult> => {
  if (techniques.length === 0) {
    return { techniques: techniques.map((t) => ({ ...t, sharedTtpCount: 0 })), riskScenarios: [] };
  }

  const techniqueIds = techniques.map((t) => t.id);
  const techniqueIdSet = new Set(techniqueIds);

  // Get all attack outcomes visible to the user and their enriched technique lists (direct + inferred)
  const allOutcomeIds = await deps.attackOutcomes.getAllAttackOutcomeIds();
  if (allOutcomeIds.length === 0) {
    return { techniques: techniques.map((t) => ({ ...t, sharedTtpCount: 0 })), riskScenarios: [] };
  }

  const scenarios = await deps.riskScenarios.findRiskScenariosByAttackOutcomeIds(allOutcomeIds, organizationId);
  if (scenarios.length === 0) {
    return { techniques: techniques.map((t) => ({ ...t, sharedTtpCount: 0 })), riskScenarios: [] };
  }

  const outcomeIdsByOrganizationId = new Map<string, Array<string>>();
  for (const scenario of scenarios) {
    const outcomeIds = outcomeIdsByOrganizationId.get(scenario.organizationId) ?? [];
    if (!outcomeIds.includes(scenario.attackOutcomeId)) {
      outcomeIds.push(scenario.attackOutcomeId);
    }
    outcomeIdsByOrganizationId.set(scenario.organizationId, outcomeIds);
  }

  const activeTechniquesByOrganizationId = await deps.attackOutcomes.getActiveTechniqueIdsByOrganization(outcomeIdsByOrganizationId);

  const countByTechnique = new Map<string, Set<string>>();
  const countByScenario = new Map<string, number>();
  const pendingScenarioIds = new Set<string>();

  for (const scenario of scenarios) {
    const outcomeTechIds = activeTechniquesByOrganizationId.get(scenario.organizationId)?.get(scenario.attackOutcomeId);
    if (outcomeTechIds === null) {
      pendingScenarioIds.add(scenario.id);
      continue;
    }
    if (!outcomeTechIds) {
      continue;
    }
    let sharedCount = 0;
    for (const techId of outcomeTechIds) {
      if (!techniqueIdSet.has(techId)) {
        continue;
      }
      sharedCount++;
      let s = countByTechnique.get(techId);
      if (!s) {
        s = new Set();
        countByTechnique.set(techId, s);
      }
      s.add(scenario.id);
    }
    if (sharedCount > 0) {
      countByScenario.set(scenario.id, sharedCount);
    }
  }

  return {
    techniques: techniques.map((t) => ({ ...t, sharedTtpCount: countByTechnique.get(t.id)?.size ?? 0 })),
    riskScenarios: scenarios
      .filter((s) => countByScenario.has(s.id) || pendingScenarioIds.has(s.id))
      .map((s) => ({
        id: s.id,
        name: s.name,
        organizationId: s.organizationId,
        organizationName: s.organizationName,
        sharedTtpCount: countByScenario.get(s.id) ?? 0,
        mixturePending: pendingScenarioIds.has(s.id),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
};
