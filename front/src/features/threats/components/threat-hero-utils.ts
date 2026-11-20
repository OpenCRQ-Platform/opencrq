import { activityGradeFor, isActiveGrade } from '@app/module/client';
import { t } from '@lingui/core/macro';

/**
 * The techniques the MITRE ATT&CK catalogue resolves: the only ones the TTP table lists and the
 * matrix can highlight, so the tab count and the table read the same number.
 */
export const matchedTechniques = <T extends { mitreTechniqueId: string | null }>(
  techniques: Array<T>,
): Array<T & { mitreTechniqueId: string }> => techniques.filter(
  (technique): technique is T & { mitreTechniqueId: string } => technique.mitreTechniqueId !== null,
);

/** The targeted countries and sectors that match one of the tenant's own organizations. */
export const countConcerningTargets = (
  locations: Array<{ matchesOrganization: boolean }>,
  sectors: Array<{ matchesOrganization: boolean }>,
): number => locations.filter((location) => location.matchesOrganization).length
  + sectors.filter((sector) => sector.matchesOrganization).length;

interface OutcomeScore {
  attackOutcomeId: string,
  outcomeName: string,
  score: number,
}

/** The highest scoring attack outcome, ties broken by name; null when no outcome matches at all. */
export const pickBestOutcomeMatch = <T extends OutcomeScore>(outcomes: Array<T>): T | null => {
  let best: T | null = null;
  for (const outcome of outcomes) {
    if (outcome.score <= 0) {
      continue;
    }
    if (best === null || outcome.score > best.score || (outcome.score === best.score && outcome.outcomeName.localeCompare(best.outcomeName) < 0)) {
      best = outcome;
    }
  }
  return best;
};

export type ThreatActivityStatus = 'active' | 'dormant' | 'not-dated';

export const threatActivityStatus = (lastObservedAt: Date | string | null, now: Date): ThreatActivityStatus => {
  const grade = activityGradeFor(lastObservedAt, now);
  if (grade === 'unknown') {
    return 'not-dated';
  }
  return isActiveGrade(grade) ? 'active' : 'dormant';
};

export const threatActivityStatusLabel = (status: ThreatActivityStatus): string => {
  switch (status) {
    case 'active':
      return t`Active`;
    case 'dormant':
      return t`Dormant`;
    case 'not-dated':
      return t`Not dated`;
  }
};
