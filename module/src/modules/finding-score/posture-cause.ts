import type { EvidenceState } from '../supporting-assets/schema';
import type { AssetPostureCause, AssetPostureChange, AssetPostureHistoryLine } from './asset-posture';
import type { SeverityBand } from './bands';

export interface JournaledPostureLine {
  at: Date,
  score: number | null,
  worstEvidenceId: string | null,
  worstName: string | null,
  worstExploitability: number | null,
  critical: number | null,
  high: number | null,
  medium: number | null,
  low: number | null,
}

export interface EvidenceStateChange {
  evidenceId: string,
  state: EvidenceState,
  at: Date,
}

const causeOf = (line: JournaledPostureLine): Omit<AssetPostureCause, 'change'> | null => {
  const { score, worstEvidenceId, worstName, worstExploitability, critical, high, medium, low } = line;
  if (score === null || worstExploitability === null || critical === null || high === null || medium === null || low === null) {
    return null;
  }
  return {
    worstFinding: worstEvidenceId === null || worstName === null ? null : { evidenceId: worstEvidenceId, name: worstName },
    worstExploitability,
    countsByBand: { critical, high, medium, low },
  };
};

const applicableCount = (counts: Record<SeverityBand, number>): number =>
  counts.critical + counts.high + counts.medium + counts.low;

/** `changes` oldest first. Null when the finding has no state recorded by `at`. */
const stateAt = (changes: ReadonlyArray<EvidenceStateChange> | undefined, at: Date): EvidenceState | null =>
  changes?.findLast((change) => change.at.getTime() <= at.getTime())?.state ?? null;

const changeBetween = (
  previous: JournaledPostureLine,
  previousCause: Omit<AssetPostureCause, 'change'> | null,
  line: JournaledPostureLine,
  cause: Omit<AssetPostureCause, 'change'>,
  now: { evidenceId: string, name: string },
  stateChanges: ReadonlyMap<string, ReadonlyArray<EvidenceStateChange>>,
): AssetPostureChange => {
  if (previous.score === null) {
    return { kind: 'regained' };
  }
  if (previousCause === null) {
    return { kind: 'worst' };
  }
  const before = previousCause.worstFinding;
  if (before === null) {
    return { kind: 'newWorst' };
  }
  if (before.evidenceId === now.evidenceId) {
    if (previousCause.worstExploitability !== cause.worstExploitability) {
      return { kind: 'exploitability', from: previousCause.worstExploitability };
    }
    const fromApplicable = applicableCount(previousCause.countsByBand);
    const toApplicable = applicableCount(cause.countsByBand);
    return fromApplicable === toApplicable ? { kind: 'worst' } : { kind: 'tail', fromApplicable, toApplicable };
  }
  const beforeState = stateAt(stateChanges.get(before.evidenceId), line.at);
  return beforeState !== null && beforeState !== 'applicable'
    ? { kind: 'resolved', resolvedName: before.name }
    : { kind: 'newWorst' };
};

/**
 * `lines` oldest first. `ledByLineInForce` says the first line precedes the read's window, so its
 * own predecessor was not read and it carries no change.
 */
export const explainPostureHistory = (
  lines: ReadonlyArray<JournaledPostureLine>,
  stateChanges: ReadonlyArray<EvidenceStateChange>,
  ledByLineInForce: boolean,
): Array<AssetPostureHistoryLine> => {
  const changesByEvidence = new Map<string, Array<EvidenceStateChange>>();
  for (const change of stateChanges.toSorted((a, b) => a.at.getTime() - b.at.getTime())) {
    const changes = changesByEvidence.get(change.evidenceId) ?? [];
    changes.push(change);
    changesByEvidence.set(change.evidenceId, changes);
  }

  const causes = lines.map(causeOf);
  return lines.map((line, index) => {
    const cause = causes[index];
    if (cause === null) {
      return { at: line.at, score: line.score, cause: null };
    }
    let change: AssetPostureChange | null = null;
    if (cause.worstFinding !== null) {
      if (index > 0) {
        change = changeBetween(lines[index - 1], causes[index - 1], line, cause, cause.worstFinding, changesByEvidence);
      } else if (!ledByLineInForce) {
        change = { kind: 'first' };
      }
    }
    return { at: line.at, score: line.score, cause: { ...cause, change } };
  });
};
