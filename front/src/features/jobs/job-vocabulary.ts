import { t } from '@lingui/core/macro';
import type { ChipSeverity } from '@filigran/design-system';
import type { JobHealth, TriggeredBy } from '@app/module/client';

export const jobHealthLabel = (health: JobHealth): string => {
  switch (health) {
    case 'running': return t`Running`;
    case 'queued': return t`Queued`;
    case 'never_ran': return t`Never ran`;
    case 'healthy': return t`Healthy`;
    case 'failing': return t`Failing`;
  }
};

export const JOB_HEALTH_SEVERITY: Record<JobHealth, ChipSeverity> = {
  failing: 'critical',
  running: 'info',
  queued: 'neutral',
  healthy: 'low',
  never_ran: 'neutral',
};

export const triggeredByLabel = (triggeredBy: TriggeredBy): string => {
  switch (triggeredBy) {
    case 'user': return t`User`;
    case 'scheduler': return t`Scheduler`;
    case 'system': return t`System`;
    case 'event': return t`Data change`;
    case 'connector': return t`Service account`;
  }
};
