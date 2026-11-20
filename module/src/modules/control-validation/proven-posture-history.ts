import type { CapabilityFunction } from '../controls/capability/constants';
import type { EffectiveEdge } from '../controls/capability/effective-coverage';
import type { EvidenceState } from '../supporting-assets/schema';
import type { ControlValidation, ValidationEvidenceRow } from './engine';
import { CAPABILITY_FUNCTIONS } from '../controls/capability/constants';
import { isScoredEdge } from '../controls/capability/effective-coverage';
import { isExpectationMet, PROVEN_POSTURE_HISTORY_RETENTION_DAYS } from './constants';

const DAY_MS = 86_400_000;

interface ProvenPostureTriple {
  credited: number,
  tested: number,
  held: number,
}

export interface ProvenPostureCounts extends ProvenPostureTriple {
  capabilityId: string,
  function: CapabilityFunction,
}

export const provenPostureKey = (capabilityId: string, fn: CapabilityFunction): string => `${capabilityId}:${fn}`;

export const countCredited = (edges: ReadonlyArray<EffectiveEdge>): Map<string, number> => {
  const techniques = new Map<string, Set<string>>();
  for (const edge of edges.filter(isScoredEdge)) {
    const key = provenPostureKey(edge.capabilityId, edge.function);
    const covered = techniques.get(key) ?? new Set<string>();
    covered.add(edge.techniqueId);
    techniques.set(key, covered);
  }
  return new Map([...techniques].map(([key, covered]) => [key, covered.size]));
};

/** A control the derivation never reached counts tested 0: reachable and untested is a state the screen names. */
export const countProvenPosture = (
  controls: ReadonlyArray<ControlValidation>,
  credited: ReadonlyMap<string, number>,
  reachableIds: ReadonlySet<string>,
): Array<ProvenPostureCounts> => {
  const derived = new Map(controls.map((control) => [control.capabilityId, control]));
  return [...reachableIds].toSorted().flatMap((capabilityId) => CAPABILITY_FUNCTIONS.flatMap((fn) => {
    const creditedCount = credited.get(provenPostureKey(capabilityId, fn)) ?? 0;
    if (creditedCount === 0) {
      return [];
    }
    const cells = (derived.get(capabilityId)?.cells ?? []).filter((cell) => cell.function === fn);
    return [{
      capabilityId,
      function: fn,
      credited: creditedCount,
      tested: cells.length,
      held: cells.filter(isExpectationMet).length,
    }];
  }));
};

const sameTriple = (left: ProvenPostureTriple, right: ProvenPostureTriple): boolean =>
  left.credited === right.credited && left.tested === right.tested && left.held === right.held;

const NOTHING_CREDITED: ProvenPostureTriple = { credited: 0, tested: 0, held: 0 };

/** A key `counts` no longer carries is owed a zero line, or its last line stays in force for coverage that is gone. */
export const linesOwed = (
  counts: ReadonlyArray<ProvenPostureCounts>,
  lastLineByKey: ReadonlyMap<string, ProvenPostureCounts>,
): Array<ProvenPostureCounts> => {
  const presentKeys = new Set(counts.map((entry) => provenPostureKey(entry.capabilityId, entry.function)));
  const moved = counts.filter((entry) => {
    const last = lastLineByKey.get(provenPostureKey(entry.capabilityId, entry.function));
    return last === undefined || !sameTriple(last, entry);
  });
  const withdrawn = [...lastLineByKey]
    .filter(([key, last]) => !presentKeys.has(key) && !sameTriple(last, NOTHING_CREDITED))
    .map(([, last]) => ({ capabilityId: last.capabilityId, function: last.function, ...NOTHING_CREDITED }));
  return [...moved, ...withdrawn];
};

export interface TimelineVerdict {
  id: string,
  state: EvidenceState,
  /** When the test ran. */
  observedAt: Date,
  /** When a sync delivered it, which is what the replay reads the past by. */
  recordedAt: Date,
}

/** `verdicts` holds the test verdicts only, in the order they were delivered. */
export interface EvidenceTimelineRow extends Omit<ValidationEvidenceRow, 'runVerdict' | 'runAt'> {
  verdicts: ReadonlyArray<TimelineVerdict>,
}

/**
 * The evidence the live read would have returned at `at`, as far as the stored rows can tell.
 *
 * Only today's `evaluated_at` is stored, and replays move it forward without writing history. A
 * later value is therefore read as `at` itself: the scenario kept being replayed, and falling back
 * on the verdict's date would expire cells that were re-proven all along.
 */
export const evidenceAsOf = (
  timeline: ReadonlyArray<EvidenceTimelineRow>,
  at: Date,
): Array<ValidationEvidenceRow> => timeline.flatMap(({ verdicts, ...row }): Array<ValidationEvidenceRow> => {
  const verdict = verdicts.findLast((candidate) => candidate.recordedAt.getTime() <= at.getTime());
  if (verdict === undefined) {
    return [];
  }
  return [{
    ...row,
    evaluatedAt: row.evaluatedAt === null || row.evaluatedAt.getTime() <= at.getTime() ? row.evaluatedAt : at,
    runVerdict: verdict.state,
    runAt: verdict.observedAt,
  }];
});

const startOfUtcDay = (instant: Date): number => Math.floor(instant.getTime() / DAY_MS) * DAY_MS;

/**
 * UTC midnights strictly after the first verdict and strictly before `now`, none older than the
 * retention, which would trim a replayed line the moment it is written.
 */
export const replayDays = (firstVerdictAt: Date | null, now: Date): Array<Date> => {
  if (firstVerdictAt === null) {
    return [];
  }
  const oldest = now.getTime() - PROVEN_POSTURE_HISTORY_RETENTION_DAYS * DAY_MS;
  const days: Array<Date> = [];
  for (
    let day = Math.max(startOfUtcDay(firstVerdictAt) + DAY_MS, Math.ceil(oldest / DAY_MS) * DAY_MS);
    day < now.getTime();
    day += DAY_MS
  ) {
    days.push(new Date(day));
  }
  return days;
};
