import { describe, expect, it } from 'vitest';
import type { ActivityGrade } from './activity-grades';
import { activeSince, ACTIVITY_ACTIVE_WINDOW_DAYS, ACTIVITY_GRADES, activityGradeFor, isActiveGrade } from './activity-grades';

// Off midnight on purpose: the grade counts fractional days from the instant, not from the UTC day.
const NOW = new Date('2026-01-01T13:37:00.000Z');
const MS_PER_DAY = 86_400_000;
const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * MS_PER_DAY);

describe('activityGradeFor', () => {
  it.each<[number, ActivityGrade, ActivityGrade]>([
    [14, 'hot', 'warm'],
    [90, 'warm', 'cold'],
  ])('should switch grade at the %s-day bound, exclusive', (bound, below, atOrAbove) => {
    expect(activityGradeFor(daysAgo(bound - 0.01), NOW)).toBe(below);
    expect(activityGradeFor(daysAgo(bound), NOW)).toBe(atOrAbove);
  });

  it('should be hot for an observation made now', () => {
    expect(activityGradeFor(NOW, NOW)).toBe('hot');
  });

  it('should stay cold however old the observation is', () => {
    expect(activityGradeFor(daysAgo(366), NOW)).toBe('cold');
    expect(activityGradeFor(daysAgo(1000), NOW)).toBe('cold');
  });

  it('should be unknown when the threat was never observed', () => {
    expect(activityGradeFor(null, NOW)).toBe('unknown');
  });

  it('should grade an ISO string like the equivalent Date', () => {
    for (const days of [0, 13.99, 14, 89.99, 90, 365, 1000]) {
      const date = daysAgo(days);
      expect(activityGradeFor(date.toISOString(), NOW)).toBe(activityGradeFor(date, NOW));
    }
  });

  it('should be unknown for an unparseable string', () => {
    expect(activityGradeFor('not a date', NOW)).toBe('unknown');
    expect(activityGradeFor('', NOW)).toBe('unknown');
  });

  it('should count a future observation as age zero', () => {
    expect(activityGradeFor(daysAgo(-10), NOW)).toBe('hot');
    expect(activityGradeFor(daysAgo(-1000), NOW)).toBe('hot');
  });
});

describe('isActiveGrade', () => {
  it.each<[ActivityGrade, boolean]>([
    ['hot', true],
    ['warm', true],
    ['cold', false],
    ['unknown', false],
  ])('should answer %s with %s', (grade, expected) => {
    expect(isActiveGrade(grade)).toBe(expected);
  });
});

describe('the active window', () => {
  it('should make a date one millisecond after activeSince active', () => {
    const since = activeSince(NOW);
    expect(isActiveGrade(activityGradeFor(new Date(since.getTime() + 1), NOW))).toBe(true);
  });

  it('should make a date exactly at activeSince no longer active', () => {
    expect(isActiveGrade(activityGradeFor(activeSince(NOW), NOW))).toBe(false);
  });

  it('should put activeSince exactly the window before now', () => {
    expect(activeSince(NOW)).toEqual(daysAgo(ACTIVITY_ACTIVE_WINDOW_DAYS));
  });
});

describe('ACTIVITY_GRADES', () => {
  it('should order the age bounds strictly increasing', () => {
    const bounds = ACTIVITY_GRADES.map((grade) => grade.maxAgeDays);
    bounds.slice(1).forEach((bound, index) => {
      expect(bound).toBeGreaterThan(bounds[index]);
    });
  });

  it('should leave only the last grade unbounded', () => {
    const unbounded = ACTIVITY_GRADES.filter((grade) => grade.maxAgeDays === Infinity);
    expect(unbounded.map((grade) => grade.value)).toEqual(['cold']);
    expect(ACTIVITY_GRADES.at(-1)!.maxAgeDays).toBe(Infinity);
  });
});
