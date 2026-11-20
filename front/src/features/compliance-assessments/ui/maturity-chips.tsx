import type { ComplianceAssessmentStatus } from '@app/module/client';
import { Chip } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import { EmptyValue } from '../../../components/ui/empty-value';
import { maturitySeverity, toMaturityLevel } from '../compliance-assessments-utils';
import { assessmentStatusLabel, maturityLevelName, maturityOutOfScale } from './maturity-labels';

export const AssessmentStatusChip: FunctionComponent<{ status: ComplianceAssessmentStatus }> = ({ status }) => (
  <Chip severity={status === 'published' ? 'info' : 'neutral'} label={assessmentStatusLabel(status)} />
);

export const MeanMaturityChip: FunctionComponent<{ meanLevel: number | null }> = ({ meanLevel }) => (
  meanLevel === null
    ? <EmptyValue />
    : <Chip severity={maturitySeverity(meanLevel)} label={maturityOutOfScale(meanLevel)} />
);

export const AnswerChip: FunctionComponent<{ level: number | null, notApplicable: boolean }> = ({ level, notApplicable }) => {
  if (notApplicable) {
    return <Chip severity="neutral" label={t`Not applicable`} />;
  }
  const maturity = toMaturityLevel(level);
  if (maturity === null) {
    return <EmptyValue />;
  }
  return (
    <span title={`${maturity} ${maturityLevelName(maturity)}`}>
      <Chip severity={maturitySeverity(maturity)} label={maturityOutOfScale(maturity)} />
    </span>
  );
};
