import { activityGradeFor } from '@app/module/client';
import type { ActivityGrade } from '@app/module/client';
import { Chip } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import type { FunctionComponent, ReactElement } from 'react';
import { formatRelativeTime } from '../../../utils/date-utils';

interface ActivityGradeBadgeProps {
  lastObservedAt: Date | string | null,
}

/** Four tones that stay apart at a glance: red for hot, yellow for warm, blue for cold, grey when nobody dated the threat. */
export const ACTIVITY_GRADE_SEVERITY: Record<ActivityGrade, 'critical' | 'medium' | 'info' | 'neutral'> = {
  hot: 'critical',
  warm: 'medium',
  cold: 'info',
  unknown: 'neutral',
};

/**
 * The badge words the age itself rather than a grade, so two threats under the same colour still
 * read as the weeks apart they are. `unknown` has no age to word.
 */
export const ActivityGradeBadge: FunctionComponent<ActivityGradeBadgeProps> = ({ lastObservedAt }): ReactElement => {
  const grade = activityGradeFor(lastObservedAt, new Date());
  const label = lastObservedAt === null || grade === 'unknown' ? t`Not dated` : formatRelativeTime(lastObservedAt);
  return <Chip severity={ACTIVITY_GRADE_SEVERITY[grade]} label={label} />;
};
