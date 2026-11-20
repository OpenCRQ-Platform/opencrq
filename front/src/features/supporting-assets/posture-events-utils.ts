import type { PostureCause, PostureHistoryLine } from './posture-lifeline-utils';
import { periodWindowDays } from '../../components/shared/period-window';

export type PostureEventKind = 'first' | 'regained' | 'rise' | 'fall' | 'lost';

export interface PostureEvent {
  source: 'posture',
  id: string,
  at: Date,
  kind: PostureEventKind,
  /** Null on a lost posture. */
  score: number | null,
  cause: PostureCause | null,
  /** The journal line before this one, null on the first. */
  previous: { score: number | null, cause: PostureCause | null } | null,
}

export type AssetEvent = PostureEvent;

export type FindingInCauseRole = 'resolved' | 'newWorst' | 'worst';

export interface FindingInCause {
  role: FindingInCauseRole,
  evidenceId: string,
  name: string,
  exploitability: number,
  /** The exploitability it moved from, when that move is the change. */
  from: number | null,
}

const DAY_MS = 86_400_000;

const kindOf = (score: number | null, previous: PostureEvent['previous']): PostureEventKind => {
  if (score === null) {
    return 'lost';
  }
  if (previous === null) {
    return 'first';
  }
  if (previous.score === null) {
    return 'regained';
  }
  return score < previous.score ? 'fall' : 'rise';
};

/**
 * One event per journal line of the last twelve months, newest first. The line in force when that
 * span opens is no event of its own, only the `previous` of the first one.
 */
export const buildPostureEvents = (lines: ReadonlyArray<PostureHistoryLine>, now: Date): Array<PostureEvent> => {
  const ordered = lines
    .map((line) => ({ at: new Date(line.at), score: line.score, cause: line.cause }))
    .filter((line) => !Number.isNaN(line.at.getTime()))
    .toSorted((a, b) => a.at.getTime() - b.at.getTime());
  const since = now.getTime() - periodWindowDays('12m') * DAY_MS;

  return ordered
    .flatMap((line, index): Array<PostureEvent> => {
      if (line.at.getTime() < since) {
        return [];
      }
      const before = ordered.at(index - 1);
      const previous = index === 0 || before === undefined ? null : { score: before.score, cause: before.cause };
      return [{
        source: 'posture',
        id: `posture-${line.at.toISOString()}`,
        at: line.at,
        kind: kindOf(line.score, previous),
        score: line.score,
        cause: line.cause,
        previous,
      }];
    })
    .toReversed();
};

/** Null unless the posture moved from one score to another. */
export const postureEventPoints = (event: PostureEvent): number | null => {
  const previousScore = event.previous?.score ?? null;
  return event.score === null || previousScore === null ? null : event.score - previousScore;
};

const leftFinding = (event: PostureEvent): FindingInCause | null => {
  const before = event.previous?.cause;
  if (before === null || before === undefined || before.worstFinding === null) {
    return null;
  }
  return { role: 'resolved', ...before.worstFinding, exploitability: before.worstExploitability, from: null };
};

/**
 * The findings the change turns on: the one that left and the new worst one, or the worst one
 * whose exploitability moved, or else the worst one alone. Empty when no line names them.
 */
export const findingsInCause = (event: PostureEvent): Array<FindingInCause> => {
  if (event.kind === 'lost') {
    const left = leftFinding(event);
    return left === null ? [] : [left];
  }
  const { cause } = event;
  if (cause === null || cause.worstFinding === null) {
    return [];
  }
  const worst = { ...cause.worstFinding, exploitability: cause.worstExploitability };
  const { change } = cause;
  if (change?.kind === 'resolved') {
    const left = leftFinding(event);
    return [...(left === null ? [] : [left]), { role: 'newWorst', ...worst, from: null }];
  }
  if (change?.kind === 'newWorst') {
    return [{ role: 'newWorst', ...worst, from: null }];
  }
  return [{ role: 'worst', ...worst, from: change?.kind === 'exploitability' ? change.from : null }];
};
