import { Chip, ProgressBar, Spinner } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import type { RunUnit } from '@app/module/client';
import type { FunctionComponent } from 'react';
import type { JobRunListItem } from '../run-types';
import type { ResolvedReference } from '../run-references-utils';
import { CardField, TooltipHint, TooltipHintProvider } from '../../../components/shared';
import { EmptyValue } from '../../../components/ui/empty-value';
import { useNow } from '../../../hooks';
import { cn, formatDateTime, formatDurationMs } from '../../../utils';
import { RUN_PROGRESS_TONE, RUN_STATUS_SEVERITY, runStatusLabel, runUnitLabels } from '../run-vocabulary';
import { runDisplayName, runProgressPercent, runPulse, runRetryWait } from '../run-utils';
import { runTimings } from '../run-timings';
import { RunErrorsDrawer } from './run-errors-drawer';
import { RunReferenceList } from './run-reference-list';

const PULSE_TICK_MS = 1_000;

const Figure: FunctionComponent<{ title: string, value: number | null }> = ({ title, value }) => (
  <CardField title={title}>
    {value === null ? <EmptyValue /> : <span className="txt-title font-bold tabular-nums">{value}</span>}
  </CardField>
);

const Duration: FunctionComponent<{ title: string, ms: number | null, className?: string }> = ({ title, ms, className }) => (
  <CardField title={title} className={className}>
    {formatDurationMs(ms) ?? <EmptyValue />}
  </CardField>
);

const StatusNote: FunctionComponent<{ run: JobRunListItem, now: number, skewMs: number }> = ({ run, now, skewMs }) => {
  const pulse = runPulse(run, now - skewMs);
  if (pulse !== null) {
    const seconds = pulse.secondsSinceHeartbeat;
    const stale = pulse.state === 'stale';
    return (
      <span className={cn('flex items-center gap-1.5 txt-sub-content', stale ? 'text-feedback-alert-primary' : 'text-default-secondary')}>
        <span aria-hidden="true" className={cn('size-2 rounded-full', stale ? 'bg-feedback-alert-primary' : 'bg-feedback-success-primary')} />
        {stale ? t`No sign of life for ${seconds} s` : t`Alive ${seconds} s ago`}
      </span>
    );
  }
  const wait = runRetryWait(run);
  if (wait !== null) {
    const { attempt, maxAttempts } = wait;
    const at = formatDateTime(wait.at);
    return <span className="txt-sub-content text-default-secondary">{t`Attempt ${attempt} of ${maxAttempts} at ${at}`}</span>;
  }
  return null;
};

export const RunRow: FunctionComponent<{ run: JobRunListItem, unit: RunUnit | null, skewMs: number, references: Array<ResolvedReference> }> = ({
  run,
  unit,
  skewMs,
  references,
}) => {
  const now = useNow(PULSE_TICK_MS, run.status === 'running');
  const percent = runProgressPercent(run.processedTotal, run.expectedTotal);
  const { kind } = run;
  const name = runDisplayName(kind, run);
  const labels = runUnitLabels(unit);
  const running = run.status === 'running';
  const waitingRetry = runRetryWait(run) !== null;
  const showFigures = run.expectedTotal !== null || run.processedTotal > 0;
  const timings = runTimings(run, now - skewMs);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr_auto] items-start gap-x-6 gap-y-4">
        <CardField title={t`Name`}>{name}</CardField>
        <CardField title={t`Status`} className="gap-1">
          <span><Chip severity={RUN_STATUS_SEVERITY[run.status]} label={runStatusLabel(run.status)} /></span>
          <StatusNote run={run} now={now} skewMs={skewMs} />
        </CardField>
        {showFigures && <Figure title={labels.processed} value={run.processedTotal} />}
        {showFigures && <Figure title={labels.expected} value={run.expectedTotal} />}
        <div className="row-start-1 col-start-5">
          <RunErrorsDrawer runId={run.id} runName={name} errorCount={run.errorCount} />
        </div>

        <CardField title={t`Queued at`} className="row-start-2">
          {formatDateTime(run.enqueuedAt)}
        </CardField>
        <TooltipHintProvider>
          <CardField
            className="row-start-2"
            title={(
              <TooltipHint hint={t`The first time a worker claimed this run, not when it was put in the queue.`}>
                <span tabIndex={0} className="decoration-dotted underline-offset-2 cursor-default">{t`Started at`}</span>
              </TooltipHint>
            )}
          >
            {run.startedAt === null ? <EmptyValue /> : formatDateTime(run.startedAt)}
          </CardField>
        </TooltipHintProvider>
        <CardField title={t`Finished at`} className="row-start-2">
          {run.finishedAt === null ? <EmptyValue /> : formatDateTime(run.finishedAt)}
        </CardField>
        <Duration title={t`Waited`} ms={timings.waitedMs} className="row-start-2" />
        <Duration title={t`Ran for`} ms={timings.ranForMs} className="row-start-2" />

        {percent !== null && (
          <CardField title={t`Progress`} className="row-start-3 col-start-3 col-end-6">
            <ProgressBar
              value={percent}
              size="lg"
              tone={RUN_PROGRESS_TONE[run.status]}
              aria-label={t`Progress of ${kind}`}
            />
            <span className="txt-sub-content tabular-nums text-default-secondary">{percent} %</span>
          </CardField>
        )}
        {running && run.currentStep !== null && (
          <CardField title={t`Current step`} className="row-start-4 col-span-full">
            <span className="flex items-center gap-2">
              <Spinner size="sm" />
              <span>{run.currentStep}</span>
            </span>
          </CardField>
        )}
        {waitingRetry && run.lastError !== null && (
          <CardField title={t`Last attempt`} className="row-start-5 col-span-full">
            <span className="text-feedback-error-primary">{run.lastError}</span>
          </CardField>
        )}
      </div>
      {references.length > 0 && (
        <CardField title={t`Related to`}>
          <RunReferenceList references={references} />
        </CardField>
      )}
    </div>
  );
};
