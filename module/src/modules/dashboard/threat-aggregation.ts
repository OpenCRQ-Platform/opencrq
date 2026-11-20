import type { AdmittedThreat } from '../threat-analyses';
import { compareActivityUnknownLast } from '../threat-analyses/activity-scoring';

export interface ScenarioAdmission {
  scenarioId: string,
  threats: Array<AdmittedThreat>,
}

export interface ScopeThreat extends Omit<AdmittedThreat, 'combinedRelevance'> {
  scenarioCount: number,
}

export const rankScopeThreats = (admissions: Array<ScenarioAdmission>, limit: number): Array<ScopeThreat> => {
  const byId = new Map<string, { threat: AdmittedThreat, scenarioIds: Set<string>, relevance: number }>();
  for (const { scenarioId, threats } of admissions) {
    for (const threat of threats) {
      const entry = byId.get(threat.id) ?? { threat, scenarioIds: new Set<string>(), relevance: threat.combinedRelevance };
      entry.scenarioIds.add(scenarioId);
      entry.relevance = Math.max(entry.relevance, threat.combinedRelevance);
      byId.set(threat.id, entry);
    }
  }
  return [...byId.values()]
    .sort((a, b) => compareActivityUnknownLast(a.threat.activityScore, b.threat.activityScore)
      || (b.scenarioIds.size - a.scenarioIds.size)
      || (b.relevance - a.relevance)
      || a.threat.name.localeCompare(b.threat.name))
    .slice(0, limit)
    .map(({ threat, scenarioIds }) => ({
      id: threat.id,
      name: threat.name,
      entityType: threat.entityType,
      activityScore: threat.activityScore,
      lastObservedAt: threat.lastObservedAt,
      scenarioCount: scenarioIds.size,
    }));
};

export interface TechniqueValueRow {
  mitreTechniqueId: string,
  externalId: string,
  name: string,
  preventValue: number | null,
  detectValue: number | null,
}

export interface TechniqueGain {
  id: string,
  externalId: string,
  name: string,
  prevention: number,
  detection: number,
  total: number,
}

export interface TacticGains {
  id: string,
  externalId: string,
  name: string,
  techniques: Array<TechniqueGain>,
}

/** A row missing either lever was not priced by its run and adds nothing, as on a scenario's TTP tab. */
export const aggregateTechniqueGains = (
  rows: Array<TechniqueValueRow>,
  tacticLinks: Array<{ techniqueId: string, tacticId: string }>,
  tactics: Array<{ id: string, externalId: string, name: string }>,
): Array<TacticGains> => {
  const gainById = new Map<string, TechniqueGain>();
  for (const row of rows) {
    if (row.preventValue === null || row.detectValue === null) {
      continue;
    }
    const gain = gainById.get(row.mitreTechniqueId)
      ?? { id: row.mitreTechniqueId, externalId: row.externalId, name: row.name, prevention: 0, detection: 0, total: 0 };
    gain.prevention += row.preventValue;
    gain.detection += row.detectValue;
    gain.total = gain.prevention + gain.detection;
    gainById.set(row.mitreTechniqueId, gain);
  }

  const techniquesByTacticId = new Map<string, Array<TechniqueGain>>();
  for (const { techniqueId, tacticId } of tacticLinks) {
    const gain = gainById.get(techniqueId);
    if (gain === undefined) {
      continue;
    }
    const techniques = techniquesByTacticId.get(tacticId) ?? [];
    techniques.push(gain);
    techniquesByTacticId.set(tacticId, techniques);
  }

  return tactics.map((tactic) => ({
    ...tactic,
    techniques: [...techniquesByTacticId.get(tactic.id) ?? []]
      .sort((a, b) => (b.total - a.total) || a.externalId.localeCompare(b.externalId)),
  }));
};
