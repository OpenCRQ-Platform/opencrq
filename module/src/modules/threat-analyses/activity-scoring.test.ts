import { describe, expect, it } from 'vitest';
import type { ActivityAnchor } from './activity-scoring';
import {
  ACTIVITY_HALF_LIFE_DAYS,
  ACTIVITY_SIGNAL_BASE_WEIGHT,
  activityWeightFor,
  assessmentFromActivityColumns,
  compareActivityUnknownLast,
  computeActivityAssessment,
  resolveActivityAnchor,
} from './activity-scoring';

// Fixed at midnight UTC so `daysAgo(n)` lands exactly on a UTC-day boundary — the scoring anchors
// weights to `startOfUtcDay`, so this keeps `ageDays` an exact integer and the assertions stable.
const NOW = new Date('2026-01-01T00:00:00.000Z');
const MS_PER_DAY = 86_400_000;
const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * MS_PER_DAY);

const authored = (date: Date): ActivityAnchor => ({ date, provenance: 'authored' });
const observed = (date: Date): ActivityAnchor => ({ date, provenance: 'observed' });
const undated: ActivityAnchor = { date: null, provenance: 'none' };

describe('resolveActivityAnchor', () => {
  it('should grade a stop or start time as observed', () => {
    const stop = daysAgo(1);
    expect(resolveActivityAnchor({ relCreated: daysAgo(3), relStartTime: daysAgo(2), relStopTime: stop }))
      .toEqual({ date: stop, provenance: 'observed' });
    const start = daysAgo(2);
    expect(resolveActivityAnchor({ relCreated: daysAgo(3), relStartTime: start, relStopTime: null }))
      .toEqual({ date: start, provenance: 'observed' });
  });

  it('should grade the creation date fallback as authored', () => {
    const created = daysAgo(3);
    expect(resolveActivityAnchor({ relCreated: created, relStartTime: null, relStopTime: null }))
      .toEqual({ date: created, provenance: 'authored' });
  });

  it('should report no anchor when every date is null', () => {
    expect(resolveActivityAnchor({ relCreated: null, relStartTime: null, relStopTime: null }))
      .toEqual({ date: null, provenance: 'none' });
  });
});

describe('computeActivityAssessment', () => {
  const datedScore = (anchors: Array<ActivityAnchor>): number => {
    const { activityScore } = computeActivityAssessment(anchors, NOW);
    if (activityScore === null) {
      throw new Error('Expected a dated activity score');
    }
    return activityScore;
  };

  it('should leave the score unknown with no anchor for an empty set', () => {
    expect(computeActivityAssessment([], NOW))
      .toEqual({ activityScore: null, lastActivityAt: null, anchorProvenance: 'none' });
  });

  it('should ignore undated anchors and leave the score unknown when all are undated', () => {
    expect(computeActivityAssessment([undated, undated], NOW))
      .toEqual({ activityScore: null, lastActivityAt: null, anchorProvenance: 'none' });
  });

  it('should carry the provenance of the anchor behind the last activity', () => {
    const latestObserved = computeActivityAssessment([authored(daysAgo(40)), observed(daysAgo(10))], NOW);
    expect(latestObserved.anchorProvenance).toBe('observed');
    expect(latestObserved.lastActivityAt).toEqual(daysAgo(10));

    const latestAuthored = computeActivityAssessment([authored(daysAgo(10)), observed(daysAgo(40))], NOW);
    expect(latestAuthored.anchorProvenance).toBe('authored');
  });

  it('should prefer the observed grade when two anchors tie on the same instant', () => {
    const assessment = computeActivityAssessment([authored(daysAgo(10)), observed(daysAgo(10))], NOW);
    expect(assessment.anchorProvenance).toBe('observed');
  });

  it('should score an observed anchor exactly like an authored one of the same date', () => {
    const authoredScore = computeActivityAssessment([authored(daysAgo(10)), authored(daysAgo(20))], NOW);
    const observedScore = computeActivityAssessment([observed(daysAgo(10)), observed(daysAgo(20))], NOW);
    expect(observedScore.activityScore).toBe(authoredScore.activityScore);
    expect(observedScore.lastActivityAt).toEqual(authoredScore.lastActivityAt);
  });

  it('should score a single event today at the base weight', () => {
    const assessment = computeActivityAssessment([authored(daysAgo(0))], NOW);
    expect(assessment.activityScore).toBeCloseTo(0.35, 5);
    expect(assessment.lastActivityAt).toEqual(daysAgo(0));
  });

  it('should halve the weight at one half-life (90 days)', () => {
    expect(computeActivityAssessment([authored(daysAgo(90))], NOW).activityScore).toBeCloseTo(0.175, 5);
  });

  it('should quarter the weight at two half-lives (180 days)', () => {
    expect(computeActivityAssessment([authored(daysAgo(180))], NOW).activityScore).toBeCloseTo(0.0875, 5);
  });

  it('should keep a ten-year-old single activity day known, with a small positive score', () => {
    const score = datedScore([observed(daysAgo(3650))]);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(0.001);
  });

  it('should keep a twenty-year-old single activity day above 0 and below a ten-year-old one', () => {
    const score = datedScore([observed(daysAgo(7300))]);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(datedScore([observed(daysAgo(3650))]));
  });

  it('should score an old activity below a recent one', () => {
    expect(datedScore([observed(daysAgo(3650))])).toBeLessThan(datedScore([observed(daysAgo(10))]));
  });

  it('should deduplicate multiple events on the same UTC day', () => {
    const single = datedScore([authored(new Date('2025-12-15T00:00:00.000Z'))]);
    const sameDay = datedScore([
      authored(new Date('2025-12-15T01:00:00.000Z')),
      authored(new Date('2025-12-15T09:30:00.000Z')),
      authored(new Date('2025-12-15T23:00:00.000Z')),
    ]);
    expect(sameDay).toBeCloseTo(single, 10);
  });

  it('should reward distinct activity days over a single day', () => {
    const oneDay = datedScore([authored(daysAgo(10))]);
    const twoDays = datedScore([authored(daysAgo(10)), authored(daysAgo(20))]);
    expect(twoDays).toBeGreaterThan(oneDay);
    expect(twoDays).toBeLessThan(1);
  });

  it('should clamp a future event to a zero age (full weight)', () => {
    const assessment = computeActivityAssessment([authored(daysAgo(-10))], NOW);
    expect(assessment.activityScore).toBeCloseTo(0.35, 5);
  });

  it('should be deterministic for a fixed now', () => {
    const anchors = [authored(daysAgo(5)), observed(daysAgo(40)), authored(daysAgo(200))];
    expect(computeActivityAssessment(anchors, NOW)).toEqual(computeActivityAssessment(anchors, NOW));
  });
});

describe('assessmentFromActivityColumns', () => {
  it('should read a row the job never folded as an empty assessment', () => {
    expect(assessmentFromActivityColumns({
      lastObservedAt: null,
      lastAuthoredAt: null,
      activityScore: null,
    })).toEqual({ activityScore: null, lastActivityAt: null, anchorProvenance: 'none' });
  });

  it('should still anchor an actor never observed on its authoring date, which is what the risk engine reads', () => {
    expect(assessmentFromActivityColumns({
      lastObservedAt: null,
      lastAuthoredAt: daysAgo(3),
      activityScore: 0,
    })).toEqual({ activityScore: null, lastActivityAt: daysAgo(3), anchorProvenance: 'authored' });
  });

  it.each([0, 0.4])('should read a row without an observation date as unknown even when its column stores %s', (stored) => {
    expect(assessmentFromActivityColumns({
      lastObservedAt: null,
      lastAuthoredAt: null,
      activityScore: stored,
    }).activityScore).toBeNull();
    expect(assessmentFromActivityColumns({
      lastObservedAt: null,
      lastAuthoredAt: daysAgo(3),
      activityScore: stored,
    }).activityScore).toBeNull();
  });

  it('should return the stored score of a dated row', () => {
    expect(assessmentFromActivityColumns({
      lastObservedAt: daysAgo(10),
      lastAuthoredAt: null,
      activityScore: 0.4,
    }).activityScore).toBe(0.4);
    expect(assessmentFromActivityColumns({
      lastObservedAt: daysAgo(10),
      lastAuthoredAt: null,
      activityScore: 0,
    }).activityScore).toBe(0);
  });

  it('should keep the later of the two columns, observed winning a tie', () => {
    expect(assessmentFromActivityColumns({
      lastObservedAt: daysAgo(10),
      lastAuthoredAt: daysAgo(10),
      activityScore: 0.3,
    })).toMatchObject({ lastActivityAt: daysAgo(10), anchorProvenance: 'observed' });
    expect(assessmentFromActivityColumns({
      lastObservedAt: daysAgo(40),
      lastAuthoredAt: daysAgo(10),
      activityScore: 0.2,
    })).toMatchObject({ lastActivityAt: daysAgo(10), anchorProvenance: 'authored' });
  });
});

describe('activityWeightFor', () => {
  const floor = (ageDays: number): number => ACTIVITY_SIGNAL_BASE_WEIGHT * 2 ** (-ageDays / ACTIVITY_HALF_LIFE_DAYS);

  it('should weigh a dated and scored activity at its stored score', () => {
    expect(activityWeightFor({ lastObservedAt: daysAgo(10), activityScore: 0.62 }, 365)).toBe(0.62);
  });

  it('should weigh an undated activity at the floor of an activity as old as the setting', () => {
    expect(activityWeightFor({ lastObservedAt: null, activityScore: null }, 365)).toBe(floor(365));
    expect(activityWeightFor({ lastObservedAt: null, activityScore: null }, 30)).toBe(floor(30));
  });

  it('should weigh an undated activity at about 0.021 for the default age of 365 days', () => {
    expect(activityWeightFor({ lastObservedAt: null, activityScore: null }, 365)).toBeCloseTo(0.02105, 5);
  });

  it('should ignore a stored score on an undated row', () => {
    expect(activityWeightFor({ lastObservedAt: null, activityScore: 0 }, 365)).toBe(floor(365));
  });

  it('should fall back on the floor for a dated row whose stored score is null', () => {
    expect(activityWeightFor({ lastObservedAt: daysAgo(10), activityScore: null }, 365)).toBe(floor(365));
  });

  it('should weigh an older assumed age lower', () => {
    const undatedRow = { lastObservedAt: null, activityScore: null };
    expect(activityWeightFor(undatedRow, 7)).toBeGreaterThan(activityWeightFor(undatedRow, 365));
    expect(activityWeightFor(undatedRow, 365)).toBeGreaterThan(activityWeightFor(undatedRow, 3650));
  });

  it('should never weigh an undated activity at zero nor above the base weight', () => {
    const undatedRow = { lastObservedAt: null, activityScore: null };
    for (const ageDays of [0, 7, 365, 3650]) {
      const weight = activityWeightFor(undatedRow, ageDays);
      expect(weight).toBeGreaterThan(0);
      expect(weight).toBeLessThanOrEqual(ACTIVITY_SIGNAL_BASE_WEIGHT);
    }
  });
});

describe('compareActivityUnknownLast', () => {
  it('should place a known activity before an unknown one', () => {
    expect(compareActivityUnknownLast(0.1, null)).toBeLessThan(0);
    expect(compareActivityUnknownLast(null, 0.1)).toBeGreaterThan(0);
  });

  it('should place a known zero activity before an unknown one', () => {
    expect(compareActivityUnknownLast(0, null)).toBeLessThan(0);
    expect(compareActivityUnknownLast(null, 0)).toBeGreaterThan(0);
  });

  it('should place the more active of two known activities first', () => {
    expect(compareActivityUnknownLast(0.8, 0.2)).toBeLessThan(0);
    expect(compareActivityUnknownLast(0.2, 0.8)).toBeGreaterThan(0);
  });

  it('should tie two equal known activities', () => {
    expect(compareActivityUnknownLast(0.3, 0.3)).toBe(0);
  });

  it('should tie two unknown activities', () => {
    expect(compareActivityUnknownLast(null, null)).toBe(0);
  });

  it('should sort a mixed list as known activities from the most to the least active, then the unknown ones', () => {
    const scores = [null, 0.2, null, 0.9, 0, 0.5];

    expect(scores.toSorted(compareActivityUnknownLast)).toEqual([0.9, 0.5, 0.2, 0, null, null]);
  });
});
