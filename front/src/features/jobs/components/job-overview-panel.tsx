import { Button, ProgressBar } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { CONNECTOR_INVENTORY } from '@app/module/client';
import type { ConnectorSource } from '@app/module/client';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import type { JobKindDetail } from '../job-detail-types';
import { CardField, InfoField, SectionCard } from '../../../components/shared';
import { Loader } from '../../../components';
import { getConnectors } from '../../integrations';
import { connectorSlug } from '../../integrations/connector-route-utils';
import { useTRPC } from '../../../lib';
import { formatDateTime, formatDurationMs, msBetween } from '../../../utils';
import { RUN_PROGRESS_TONE, runStatusLabel } from '../run-vocabulary';
import { runProgressPercent } from '../run-utils';
import { triggeredByLabel } from '../job-vocabulary';

const yesNo = (value: boolean): string => (value ? t`Yes` : t`No`);

const ConnectorField: FunctionComponent<{ source: ConnectorSource }> = ({ source }) => {
  const { name } = getConnectors()[source];
  return (
    <CardField title={t`Connector`} className="col-span-2">
      <div className="flex items-center gap-3">
        <span className="text-default-secondary">
          <Trans>Configuration and triggering happen on {name}'s own page.</Trans>
        </span>
        <Button priority="secondary" size="sm" asChild>
          <Link
            from="/$tenantId/{-$organizationId}"
            to="integrations/connectors/$connectorSlug"
            params={{ connectorSlug: connectorSlug(source) }}
          >
            <Trans>Open the connector</Trans>
          </Link>
        </Button>
      </div>
    </CardField>
  );
};

const CurrentRunPanel: FunctionComponent<{ activeRun: NonNullable<JobKindDetail['activeRun']> }> = ({ activeRun }) => {
  const percent = runProgressPercent(activeRun.processedTotal, activeRun.expectedTotal);
  return (
    <SectionCard title={<Trans>Current run</Trans>} contentClassName="grid grid-cols-2 gap-x-6 gap-y-5">
      <InfoField title={t`Status`} value={runStatusLabel(activeRun.status)} />
      {percent !== null && (
        <CardField title={t`Progress`} className="col-span-2">
          <ProgressBar value={percent} size="lg" tone={RUN_PROGRESS_TONE[activeRun.status]} aria-label={t`Progress`} />
          <span className="txt-sub-content tabular-nums text-default-secondary">{percent} %</span>
        </CardField>
      )}
    </SectionCard>
  );
};

/** The Overview tab's own route panel. Shares the shell's query rather than issuing a second one. */
export const JobOverviewPanel: FunctionComponent<{ kind: string }> = ({ kind }) => {
  const trpc = useTRPC();
  const { data: job } = useQuery(trpc.jobs.getJobKind.queryOptions({ kind }));
  if (!job) {
    return <Loader />;
  }

  const { lastRun, activeRun } = job;
  const lastRunAt = lastRun === null ? null : lastRun.finishedAt ?? lastRun.startedAt;
  const connectorEntry = Object.values(CONNECTOR_INVENTORY).find((entry) => entry.jobKind === job.kind);

  return (
    <div className="flex flex-col gap-6">
      <SectionCard title={<Trans>Details</Trans>} contentClassName="grid grid-cols-2 gap-x-6 gap-y-5">
        <InfoField title={t`Last run`} value={lastRunAt === null ? null : formatDateTime(lastRunAt)} />
        <InfoField title={t`Duration`} value={formatDurationMs(msBetween(lastRun?.startedAt ?? null, lastRun?.finishedAt ?? null))} />
        <InfoField title={t`Status`} value={lastRun === null ? null : runStatusLabel(lastRun.status)} />
        <InfoField title={t`Triggered by`} value={lastRun === null ? null : triggeredByLabel(lastRun.triggeredBy)} />
        <InfoField title={t`Observed`} value={yesNo(job.observed)} />
        <InfoField title={t`Daily`} value={yesNo(job.daily)} />
        {connectorEntry && <ConnectorField source={connectorEntry.source} />}
      </SectionCard>
      {activeRun !== null && <CurrentRunPanel activeRun={activeRun} />}
    </div>
  );
};
