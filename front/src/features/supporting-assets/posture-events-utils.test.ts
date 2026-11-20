import { describe, expect, it } from 'vitest';
import type { PostureCause, PostureChange, PostureHistoryLine } from './posture-lifeline-utils';
import { buildPostureEvents, findingsInCause, postureEventPoints } from './posture-events-utils';

const DAY_MS = 86_400_000;
const NOW = new Date(Date.UTC(2026, 9, 1, 12));

const daysAgo = (days: number): string => new Date(NOW.getTime() - days * DAY_MS).toISOString();

const cause = (evidenceId: string, exploitability: number, change: PostureChange | null): PostureCause => ({
  worstFinding: { evidenceId, name: `CVE-${evidenceId}` },
  worstExploitability: exploitability,
  countsByBand: { critical: 0, high: 0, medium: 1, low: 3 },
  change,
});

const line = (at: string, score: number | null, lineCause: PostureCause | null = null): PostureHistoryLine => ({ at, score, cause: lineCause });

describe('buildPostureEvents', () => {
  it('should list every line newest first, each with its kind and the line before it', () => {
    const events = buildPostureEvents([
      line(daysAgo(50), 48),
      line(daysAgo(40), null),
      line(daysAgo(30), 55),
      line(daysAgo(20), 54),
      line(daysAgo(10), 58),
    ], NOW);

    expect(events.map((event) => [event.kind, event.score, event.previous?.score])).toEqual([
      ['rise', 58, 54],
      ['fall', 54, 55],
      ['regained', 55, null],
      ['lost', null, 48],
      ['first', 48, undefined],
    ]);
    expect(events.at(-1)?.previous).toBeNull();
  });

  it('should keep the line in force before the last twelve months out of the list, as the previous of the first event', () => {
    const events = buildPostureEvents([line(daysAgo(400), 40), line(daysAgo(100), 45)], NOW);

    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('rise');
    expect(events[0].previous?.score).toBe(40);
  });

  it('should give each event an id of its own', () => {
    const events = buildPostureEvents([line(daysAgo(20), 50), line(daysAgo(10), 52)], NOW);

    expect(new Set(events.map((event) => event.id)).size).toBe(2);
  });
});

describe('postureEventPoints', () => {
  it('should be the move between two scores, and nothing on a first, a lost or a regained posture', () => {
    const events = buildPostureEvents([
      line(daysAgo(40), 48),
      line(daysAgo(30), 45),
      line(daysAgo(20), null),
      line(daysAgo(10), 50),
    ], NOW);

    expect(events.map(postureEventPoints)).toEqual([null, null, -3, null]);
  });
});

describe('findingsInCause', () => {
  it('should name the finding that left as resolved and the new worst one', () => {
    const [event] = buildPostureEvents([
      line(daysAgo(20), 61, cause('a', 38, null)),
      line(daysAgo(10), 64, cause('b', 35, { kind: 'resolved', resolvedName: 'CVE-a' })),
    ], NOW);

    expect(findingsInCause(event)).toEqual([
      { role: 'resolved', evidenceId: 'a', name: 'CVE-a', exploitability: 38, from: null },
      { role: 'newWorst', evidenceId: 'b', name: 'CVE-b', exploitability: 35, from: null },
    ]);
  });

  it('should name the worst finding with the exploitability it moved from', () => {
    const [event] = buildPostureEvents([
      line(daysAgo(20), 62, cause('a', 37, null)),
      line(daysAgo(10), 61, cause('a', 38, { kind: 'exploitability', from: 37 })),
    ], NOW);

    expect(findingsInCause(event)).toEqual([{ role: 'worst', evidenceId: 'a', name: 'CVE-a', exploitability: 38, from: 37 }]);
  });

  it('should name the new worst finding alone when the previous one is still applicable', () => {
    const [event] = buildPostureEvents([
      line(daysAgo(20), 56, cause('a', 44, null)),
      line(daysAgo(10), 54, cause('b', 46, { kind: 'newWorst' })),
    ], NOW);

    expect(findingsInCause(event).map((finding) => [finding.role, finding.evidenceId])).toEqual([['newWorst', 'b']]);
  });

  it('should name the previous worst finding as resolved on a lost posture', () => {
    const [event] = buildPostureEvents([line(daysAgo(20), 52, cause('a', 48, null)), line(daysAgo(10), null)], NOW);

    expect(findingsInCause(event).map((finding) => [finding.role, finding.evidenceId])).toEqual([['resolved', 'a']]);
  });

  it('should name nothing for a line journaled before its cause was, or whose worst finding is gone', () => {
    const gone = { ...cause('a', 40, null), worstFinding: null };
    const events = buildPostureEvents([line(daysAgo(20), 50), line(daysAgo(10), 52, gone)], NOW);

    expect(events.map(findingsInCause)).toEqual([[], []]);
  });
});
