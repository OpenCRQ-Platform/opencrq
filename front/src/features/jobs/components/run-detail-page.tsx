import { Chip, ProgressBar, Spinner } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import type { inferRouterOutputs } from '@trpc/server';
import { Link } from '@tanstack/react-router';
import { Merge } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import type { ResolvedReference } from '../run-references-utils';
import { CardField, DetailPageLayout, InfoField, SectionCard, TooltipHint, TooltipHintProvider } from '../../../components/shared';
import { Loader } from '../../../components';
import { EmptyValue } from '../../../components/ui/empty-value';
import { useNow } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { formatDateTime, formatDurationMs } from '../../../utils';
import { triggeredByLabel } from '../job-vocabulary';
import { runDisplayName, runProgressPercent } from '../run-utils';
import { triggeredByReference } from '../run-references-utils';
import { runTimings } from '../run-timings';
import { useRunReferences } from '../use-run-references';
import { RUN_PROGRESS_TONE, RUN_STATUS_SEVERITY, runStatusLabel } from '../run-vocabulary';
import { CopyButton, RunLogsPanel } from './run-logs-panel';
import { RunErrorsDrawer } from './run-errors-drawer';
import { RunReferenceList } from './run-reference-list';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;
type RunDetail = NonNullable<RouterOutputs['jobs']['getRun']>;

const RUN_ROUTE = '/$tenantId/{-$organizationId}';
/** A running duration is the one figure this page cannot read once and leave: it keeps moving. */
const RAN_FOR_TICK_MS = 1_000;

/** Same markup as the Runs view's status cell: one absorbed-ask marker, one meaning. */
const AbsorbedAskMarker: FunctionComponent = () => (
  <TooltipHint hint={t`Another request for this job arrived while it was running; a follow-up run will answer it.`}>
    <span
      role="img"
      tabIndex={0}
      aria-label={t`Absorbed an ask`}
      className="flex shrink-0 cursor-default text-default-secondary focus-visible:outline-none focus-visible:ring-2 ring-focus"
    >
      <Merge className="h-3 w-3" aria-hidden="true" />
    </span>
  </TooltipHint>
);

const IdentitySection: FunctionComponent<{ run: RunDetail }> = ({ run }) => (
  <SectionCard title={<Trans>Identity</Trans>} contentClassName="grid grid-cols-2 gap-x-6 gap-y-5">
    <CardField title={t`Kind`}>
      <Link
        from={RUN_ROUTE}
        to="settings/jobs/kinds/$jobKind"
        params={{ jobKind: run.kind }}
        className="font-content-code text-content-code underline-offset-2 hover:underline"
      >
        {run.kind}
      </Link>
    </CardField>
    <CardField title={t`Status`}>
      <span className="flex items-center gap-1.5">
        <Chip severity={RUN_STATUS_SEVERITY[run.status]} label={runStatusLabel(run.status)} />
        {run.absorbedAsk && <AbsorbedAskMarker />}
      </span>
    </CardField>
    <InfoField title={t`Attempt`} value={`${run.attempt} / ${run.maxAttempts}`} />
    <InfoField title={t`Priority`} value={String(run.priority)} />
  </SectionCard>
);

const ChronologySection: FunctionComponent<{ run: RunDetail }> = ({ run }) => {
  const running = run.status === 'running';
  const now = useNow(RAN_FOR_TICK_MS, running);
  const timings = runTimings(run, now);
  const percent = runProgressPercent(run.processedTotal, run.expectedTotal);
  return (
    <SectionCard title={<Trans>Chronology</Trans>} contentClassName="grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
      {percent !== null && (
        <CardField title={t`Progress`} className="col-span-full">
          <ProgressBar value={percent} size="lg" tone={RUN_PROGRESS_TONE[run.status]} aria-label={t`Progress`} />
          <span className="txt-sub-content tabular-nums text-default-secondary">{percent} %</span>
        </CardField>
      )}
      {running && run.currentStep !== null && (
        <CardField title={t`Current step`} className="col-span-full">
          <span className="flex items-center gap-2">
            <Spinner size="sm" />
            <span>{run.currentStep}</span>
          </span>
        </CardField>
      )}
      <InfoField title={t`Queued at`} value={formatDateTime(run.enqueuedAt)} />
      <InfoField title={t`Started at`} value={run.startedAt === null ? null : formatDateTime(run.startedAt)} />
      <InfoField title={t`Claimed at`} value={run.claimedAt === null ? null : formatDateTime(run.claimedAt)} />
      <InfoField title={t`Finished at`} value={run.finishedAt === null ? null : formatDateTime(run.finishedAt)} />
      <InfoField title={t`Waited`} value={formatDurationMs(timings.waitedMs)} />
      <InfoField title={t`Ran for`} value={formatDurationMs(timings.ranForMs)} />
      <InfoField title={t`Total`} value={formatDurationMs(timings.totalMs)} />
    </SectionCard>
  );
};

const TriggerSection: FunctionComponent<{ run: RunDetail, triggeredByRef: ResolvedReference | null }> = ({ run, triggeredByRef }) => {
  // It would only repeat "Service account", which "Triggered by" already reads.
  const hidesServiceAccount = triggeredByRef?.kind === 'serviceAccount' && triggeredByRef.nameHidden === true;
  return (
    <SectionCard title={<Trans>Trigger</Trans>} contentClassName="grid grid-cols-2 gap-x-6 gap-y-5">
      <InfoField title={t`Triggered by`} value={triggeredByLabel(run.triggeredBy)} />
      {triggeredByRef === null && <InfoField title={t`Triggered by id`} value={run.triggeredById} />}
      {triggeredByRef !== null && !hidesServiceAccount && (
        <CardField title={t`Triggered by id`}>
          <RunReferenceList references={[triggeredByRef]} />
        </CardField>
      )}
      <InfoField
        title={t`Waiting`}
        value={run.interactive ? t`Someone is waiting on this run` : t`Background`}
      />
    </SectionCard>
  );
};

const ParametersSection: FunctionComponent<{ run: RunDetail, references: Array<ResolvedReference> }> = ({ run, references }) => (
  <SectionCard title={<Trans>Parameters</Trans>}>
    <CardField title={t`Related to`}>
      <RunReferenceList references={references} />
    </CardField>
    <CardField title={t`Payload`}>
      {run.payload === null
        ? <EmptyValue />
        : (
          <div className="flex items-start gap-2">
            <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words font-content-code text-content-code">{run.payload}</pre>
            <CopyButton text={run.payload} label={t`Copy the payload`} />
          </div>
        )}
    </CardField>
  </SectionCard>
);

/** Points either way an absorbed ask connects two runs: the survivor that absorbed it, and the
 * successor that answers it. */
const AbsorbedAskSection: FunctionComponent<{ run: RunDetail }> = ({ run }) => {
  const answersAbsorbedAsk = run.triggeredBy === 'system' && run.triggeredById !== null;
  if (!run.absorbedAsk && !answersAbsorbedAsk) {
    return null;
  }
  return (
    <SectionCard title={<Trans>Absorbed ask</Trans>} contentClassName="flex flex-col gap-3">
      {run.absorbedAsk && (
        <div className="flex items-center gap-2">
          <span><Trans>Another request arrived while this run was working.</Trans></span>
          {run.answeredById !== null && (
            <Link
              from={RUN_ROUTE}
              to="settings/jobs/runs/$runId"
              params={{ runId: run.answeredById }}
              className="underline-offset-2 hover:underline"
            >
              <Trans>Answered by this run</Trans>
            </Link>
          )}
        </div>
      )}
      {answersAbsorbedAsk && run.triggeredById !== null && (
        <div className="flex items-center gap-2">
          <span><Trans>Answers an ask absorbed by this run.</Trans></span>
          <Link
            from={RUN_ROUTE}
            to="settings/jobs/runs/$runId"
            params={{ runId: run.triggeredById }}
            className="underline-offset-2 hover:underline"
          >
            <Trans>The run it answers</Trans>
          </Link>
        </div>
      )}
    </SectionCard>
  );
};

const ErrorsSection: FunctionComponent<{ run: RunDetail }> = ({ run }) => (
  <SectionCard title={<Trans>Errors</Trans>}>
    <RunErrorsDrawer runId={run.id} runName={runDisplayName(run.kind, run)} errorCount={run.errorCount} />
  </SectionCard>
);

/** Titled like a `SectionCard` without its card: the panel is already one. */
const LogsSection: FunctionComponent<{ runId: string }> = ({ runId }) => {
  const trpc = useTRPC();
  const { data, isPending, error } = useQuery(trpc.jobs.listRunLogs.queryOptions({ id: runId }));
  return (
    <div className="flex flex-col gap-2">
      <p className="txt-sub-content"><Trans>Logs</Trans></p>
      <RunLogsPanel data={data} isPending={isPending} error={error} retention={null} />
    </div>
  );
};

export const RunDetailPage: FunctionComponent<{ initialRun: RunDetail }> = ({ initialRun }) => {
  const trpc = useTRPC();
  const { data: run } = useQuery(trpc.jobs.getRun.queryOptions({ id: initialRun.id }, { initialData: initialRun }));

  const triggeredByRef = run ? triggeredByReference(run.triggeredBy, run.triggeredById) : null;
  const { referencesFor, resolve } = useRunReferences(
    run ? [{ payload: run.payload }] : [],
    triggeredByRef ? [triggeredByRef] : [],
  );

  if (!run) {
    return <Loader />;
  }

  return (
    <TooltipHintProvider>
      <DetailPageLayout title={runDisplayName(run.kind, run)}>
        <div className="flex flex-col gap-6">
          <IdentitySection run={run} />
          <ChronologySection run={run} />
          <TriggerSection run={run} triggeredByRef={triggeredByRef ? resolve(triggeredByRef) : null} />
          <ParametersSection run={run} references={referencesFor(run.payload)} />
          <AbsorbedAskSection run={run} />
          <ErrorsSection run={run} />
          <LogsSection runId={run.id} />
        </div>
      </DetailPageLayout>
    </TooltipHintProvider>
  );
};
