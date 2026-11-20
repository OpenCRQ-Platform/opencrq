import { Chip } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import type { JobHealth } from '@app/module/client';
import type { FunctionComponent } from 'react';
import { TooltipHint, TooltipHintProvider } from '../../../components/shared';
import { JOB_HEALTH_SEVERITY, jobHealthLabel } from '../job-vocabulary';

/** Read-only surface: the hint explains what the health means, never what to do about it. */
const jobHealthHint = (health: JobHealth): string => {
  switch (health) {
    case 'running': return t`A run is under way.`;
    case 'queued': return t`A run is booked and waiting for a worker to take it.`;
    case 'never_ran': return t`No run has ever been recorded for this kind on this tenant.`;
    case 'healthy': return t`The last run went through, or was cancelled deliberately.`;
    case 'failing': return t`The last run landed in the dead-letter queue.`;
  }
};

export const JobHealthChip: FunctionComponent<{ health: JobHealth }> = ({ health }) => (
  <TooltipHintProvider>
    <TooltipHint hint={jobHealthHint(health)}>
      <span className="inline-flex">
        <Chip severity={JOB_HEALTH_SEVERITY[health]} label={jobHealthLabel(health)} />
      </span>
    </TooltipHint>
  </TooltipHintProvider>
);
