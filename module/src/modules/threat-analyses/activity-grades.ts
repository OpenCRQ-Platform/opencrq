/** A threat is active while its last observation is younger than this: the one edge `isActiveGrade` and the SQL predicates share. */
export const ACTIVITY_ACTIVE_WINDOW_DAYS = 90;

/**
 * Recency grades of a threat, derived from the date it was last observed active. They only pick
 * a colour: the badge words the age itself.
 *
 * Pure and injected with `now`, so the browser and the server grade a threat the same way from the
 * one stored date. Ordered from the most recent grade to the oldest; each `maxAgeDays` is an
 * exclusive upper bound on the age.
 */
export const ACTIVITY_GRADES = [
  { value: 'hot', maxAgeDays: 14 },
  { value: 'warm', maxAgeDays: ACTIVITY_ACTIVE_WINDOW_DAYS },
  { value: 'cold', maxAgeDays: Infinity },
] as const;

/** `unknown` is an absence of observation, not a rung below `cold`. */
export type ActivityGrade = (typeof ACTIVITY_GRADES)[number]['value'] | 'unknown';

const MS_PER_DAY = 86_400_000;

/**
 * Age is counted in fractional days from the instant, not from the UTC day, and a date in the
 * future counts as age zero. A missing or unparseable date is `unknown`.
 */
export const activityGradeFor = (lastObservedAt: Date | string | null, now: Date): ActivityGrade => {
  if (lastObservedAt === null) {
    return 'unknown';
  }
  const observedMs = new Date(lastObservedAt).getTime();
  if (Number.isNaN(observedMs)) {
    return 'unknown';
  }
  const ageDays = Math.max(0, (now.getTime() - observedMs) / MS_PER_DAY);
  const grade = ACTIVITY_GRADES.find((candidate) => ageDays < candidate.maxAgeDays);
  return grade?.value ?? 'cold';
};

export const isActiveGrade = (grade: ActivityGrade): boolean => (
  grade !== 'unknown' && ACTIVITY_GRADES.find((candidate) => candidate.value === grade)!.maxAgeDays <= ACTIVITY_ACTIVE_WINDOW_DAYS
);

/** The oldest last-observation date that still counts as active, for SQL predicates. */
export const activeSince = (now: Date): Date => new Date(now.getTime() - ACTIVITY_ACTIVE_WINDOW_DAYS * MS_PER_DAY);
