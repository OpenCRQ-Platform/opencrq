import { t } from '@lingui/core/macro';
import type { ChipSeverity, ProgressBarTone } from '@filigran/design-system';
import type { JobLogLevel, JobStatus, RunClaimability, RunUnit } from '@app/module/client';

export const runUnitLabels = (unit: RunUnit | null): { processed: string, expected: string } => {
  switch (unit) {
    case 'cves': return { processed: t`CVEs processed`, expected: t`CVEs to sync` };
    case 'assets': return { processed: t`Assets processed`, expected: t`Assets to sync` };
    case 'observations': return { processed: t`Observations processed`, expected: t`Observations to sync` };
    case 'frameworks': return { processed: t`Frameworks processed`, expected: t`Frameworks to sync` };
    case 'threats': return { processed: t`Threats processed`, expected: t`Threats to load` };
    case null: return { processed: t`Operations completed`, expected: t`Total number of operations` };
  }
};

export const runStatusLabel = (status: JobStatus): string => {
  switch (status) {
    case 'queued': return t`Queued`;
    case 'running': return t`Running`;
    case 'succeeded': return t`Succeeded`;
    case 'partial': return t`Partial`;
    case 'cancelled': return t`Cancelled`;
    case 'dlq': return t`Dead-letter queue`;
  }
};

/**
 * A cancelled run did none of its work, so it is neither the green of a succeeded run beside it nor
 * the red of a failed one. The health chip reads a cancellation as healthy, which is a statement
 * about what to do next rather than about the run. An absorbed ask reads the same way: it is not a
 * failure either. A partial run did its share and handed the rest to a continuation: neither the
 * green of a finished pass nor a failure.
 */
export const RUN_STATUS_SEVERITY: Record<JobStatus, ChipSeverity> = {
  queued: 'neutral',
  running: 'info',
  succeeded: 'low',
  partial: 'medium',
  cancelled: 'neutral',
  dlq: 'critical',
};

/** The status word in the log console, where a chip would sit on the line as a foreign object. */
export const RUN_STATUS_TEXT_CLASS: Record<JobStatus, string> = {
  queued: 'text-default-secondary',
  running: 'text-feedback-info-primary',
  succeeded: 'text-feedback-success-primary',
  partial: 'text-feedback-warning-primary',
  cancelled: 'text-default-secondary',
  dlq: 'text-feedback-error-primary',
};

export const logLevelLabel = (level: JobLogLevel): string => {
  switch (level) {
    case 'trace': return t`trace`;
    case 'error': return t`error`;
  }
};

/** Colour repeats what the status chip beside the bar already says, never carries it alone. */
export const RUN_PROGRESS_TONE: Record<JobStatus, ProgressBarTone> = {
  queued: 'default',
  running: 'default',
  succeeded: 'success',
  partial: 'default',
  cancelled: 'default',
  dlq: 'error',
};

export const claimabilityLabel = (claimability: RunClaimability): string => {
  switch (claimability) {
    case 'next': return t`Next`;
    case 'waiting-for-schedule': return t`Waiting for schedule`;
    case 'blocked-by-sibling': return t`Blocked by sibling`;
  }
};

export const claimabilityHint = (claimability: RunClaimability): string => {
  switch (claimability) {
    case 'next': return t`Next to be picked up among this tenant's jobs.`;
    case 'waiting-for-schedule': return t`Waiting for its scheduled time.`;
    case 'blocked-by-sibling': return t`A run of the same kind is already occupying this tenant.`;
  }
};

export const CLAIMABILITY_SEVERITY: Record<RunClaimability, ChipSeverity> = {
  next: 'info',
  'waiting-for-schedule': 'neutral',
  'blocked-by-sibling': 'medium',
};
