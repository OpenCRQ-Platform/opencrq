import type { MaturitySummary } from '@app/module/client';
import { ProgressBar } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import { completedCount, completionPercent } from '../compliance-assessments-utils';

export const AssessmentProgress: FunctionComponent<{ maturity: MaturitySummary }> = ({ maturity }) => (
  <span className="flex items-center gap-2.5">
    <ProgressBar value={completionPercent(maturity)} className="w-36" aria-label={t`Progress`} />
    <span className="txt-sub-content tabular-nums whitespace-nowrap text-default-secondary">
      {completedCount(maturity)} / {maturity.requirementCount}
    </span>
  </span>
);
