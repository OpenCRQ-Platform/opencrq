import { Chip } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { linkOptions } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent, ReactNode } from 'react';
import type { JobKindDetail } from '../job-detail-types';
import type { RouteTab } from '../../../components/shared';
import { Loader } from '../../../components';
import { RouteTabs, TooltipHint, TooltipHintProvider } from '../../../components/shared';
import { useTRPC } from '../../../lib';
import { JobHealthChip } from './job-health-chip';

const JOB_ROUTE = '/$tenantId/{-$organizationId}/settings/jobs/kinds/$jobKind';

const JobMarkers: FunctionComponent<{ job: JobKindDetail }> = ({ job }) => (
  <div className="flex shrink-0 items-center gap-2">
    {job.observed && (
      <TooltipHint hint={t`Everything this job reads and writes is recorded, so the recompute dispatcher can route on what changed.`}>
        <Chip severity="neutral" label={t`Observed`} />
      </TooltipHint>
    )}
    {job.daily && (
      <TooltipHint hint={t`Also booked once a day, even when nothing changed.`}>
        <Chip severity="neutral" label={t`Daily`} />
      </TooltipHint>
    )}
  </div>
);

export const JobDetailShell: FunctionComponent<{
  kind: string,
  initialJob: JobKindDetail,
  children: ReactNode,
}> = ({ kind, initialJob, children }) => {
  const trpc = useTRPC();
  const { data: job } = useQuery(trpc.jobs.getJobKind.queryOptions(
    { kind },
    { initialData: initialJob },
  ));

  const tabs: Array<RouteTab> = [
    { key: 'overview', label: t`Overview`, linkOption: linkOptions({ from: JOB_ROUTE, to: 'overview' }) },
    { key: 'runs', label: t`Runs`, linkOption: linkOptions({ from: JOB_ROUTE, to: 'runs' }) },
    { key: 'logs', label: t`Logs`, linkOption: linkOptions({ from: JOB_ROUTE, to: 'logs' }) },
  ];

  if (!job) {
    return <Loader />;
  }

  return (
    <TooltipHintProvider>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="min-w-0 truncate font-content-code text-content-code">{job.kind}</h1>
            <JobHealthChip health={job.health} />
          </div>
          <JobMarkers job={job} />
        </div>
        <RouteTabs tabs={tabs} />
        {children}
      </div>
    </TooltipHintProvider>
  );
};
