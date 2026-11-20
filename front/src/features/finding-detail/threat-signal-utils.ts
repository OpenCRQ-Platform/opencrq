import { activityGradeFor, isActiveGrade } from '@app/module/client';

/** How many of the threats citing a CVE were last observed active under the 90-day window. */
export const countActiveThreats = (analyses: ReadonlyArray<{ lastObservedAt: Date | string | null }>, now: Date): number => (
  analyses.filter((analysis) => isActiveGrade(activityGradeFor(analysis.lastObservedAt, now))).length
);
