import type { ComplianceAssessmentStatus, MaturityLevel } from '@app/module/client';
import { t } from '@lingui/core/macro';
import { formatFixed } from '../../../utils/format-number';
import { MATURITY_SCALE_MAX } from '../compliance-assessments-utils';

/** A level or a mean on the scale it is read against, "2.3/5.0", so a bare figure never reads as a count. */
export const maturityOutOfScale = (value: number): string => {
  const score = formatFixed(value, 1);
  const max = formatFixed(MATURITY_SCALE_MAX, 1);
  return t`${score}/${max}`;
};

export const averageMaturityLabel = (meanLevel: number | null): string => {
  if (meanLevel === null) {
    return t`Average maturity: no requirement answered yet`;
  }
  const score = formatFixed(meanLevel, 1);
  return t`Average maturity ${score} out of 5`;
};

export const maturityLevelName = (level: MaturityLevel): string => {
  switch (level) {
    case 0: return t`Nonexistent`;
    case 1: return t`Initial`;
    case 2: return t`Repeatable`;
    case 3: return t`Defined`;
    case 4: return t`Managed`;
    case 5: return t`Optimized`;
  }
};

export const maturityLevelDefinition = (level: MaturityLevel): string => {
  switch (level) {
    case 0: return t`The practice is not performed.`;
    case 1: return t`The practice is performed ad hoc and depends on individuals.`;
    case 2: return t`The practice is repeated in places and partly documented.`;
    case 3: return t`The practice is documented, standardised and applied across the organization.`;
    case 4: return t`The practice is measured and steered with indicators.`;
    case 5: return t`The practice is continuously improved from what its indicators show.`;
  }
};

export const assessmentStatusLabel = (status: ComplianceAssessmentStatus): string => {
  switch (status) {
    case 'draft': return t`Draft`;
    case 'published': return t`Published`;
  }
};

export const listRowStatusLabel = (row: { source: 'opencrq', assessment: { status: ComplianceAssessmentStatus } } | { source: 'drata' }): string =>
  (row.source === 'opencrq' ? assessmentStatusLabel(row.assessment.status) : t`Synced`);
