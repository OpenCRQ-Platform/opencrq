import { Chip } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import type { ConnectorSource, JobStatus, ScheduleCadence } from '@app/module/client';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent, ReactElement } from 'react';
import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import { InfoTooltip } from '../../../components/shared';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { EmptyValue } from '../../../components/ui/empty-value';
import { useTRPC } from '../../../lib';
import { formatRelativeTime } from '../../../utils';
import { formatNextRun, getConnectors, scheduleSummary } from '../../integrations';
import { RUN_STATUS_SEVERITY, runStatusLabel } from '../run-vocabulary';

const STORAGE_KEY = 'settings-jobs-schedules';

interface ScheduleRow {
  id: string,
  kind: string,
  source: ConnectorSource | null,
  cadence: ScheduleCadence,
  atMinute: number | null,
  weekday: number | null,
  timeZone: string | null,
  nextRunAt: string | null,
  lastRun: { status: JobStatus, finishedAt: string | null } | null,
}

const OriginCell: FunctionComponent<{ source: ConnectorSource | null }> = ({ source }) => {
  if (source !== null) {
    return <span>{getConnectors()[source].name}</span>;
  }
  return (
    <span className="inline-flex items-center gap-2 text-default-secondary">
      {t`Platform`}
      <InfoTooltip label={t`About this schedule`}>
        {t`Set in the deployment configuration (recompute.daily_at), so it cannot be changed here. Each tenant starts at its own minute within the hour that follows.`}
      </InfoTooltip>
    </span>
  );
};

const LastRunCell: FunctionComponent<{ lastRun: ScheduleRow['lastRun'] }> = ({ lastRun }) => {
  if (lastRun === null) {
    return <EmptyValue />;
  }
  return (
    <span className="inline-flex items-center gap-2">
      <Chip severity={RUN_STATUS_SEVERITY[lastRun.status]} label={runStatusLabel(lastRun.status)} />
      {lastRun.finishedAt !== null && <span className="text-default-secondary">{formatRelativeTime(lastRun.finishedAt)}</span>}
    </span>
  );
};

/** A platform row opens nothing: its schedule is the deployment's, set nowhere in the app. */
export const SchedulesPage: FunctionComponent = () => {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery(trpc.jobs.listSchedules.queryOptions());
  const rows: Array<ScheduleRow> = (data ?? []).map((entry) => ({ id: entry.kind, ...entry }));

  const columns: Array<ColumnDefWithOptionsHeader<ScheduleRow, unknown>> = [
    {
      id: 'kind',
      accessorKey: 'kind',
      header: t`Job kind`,
      size: 280,
      cell: ({ row }): ReactElement => <span className="font-content-code text-content-code">{row.original.kind}</span>,
    },
    {
      id: 'origin',
      header: t`Origin`,
      size: 220,
      cell: ({ row }): ReactElement => <OriginCell source={row.original.source} />,
    },
    {
      id: 'schedule',
      header: t`Schedule`,
      size: 260,
      cell: ({ row }): ReactElement => <span>{scheduleSummary(row.original)}</span>,
    },
    {
      id: 'nextRun',
      header: t`Next run`,
      size: 260,
      cell: ({ row }): ReactElement => {
        const { nextRunAt } = row.original;
        return nextRunAt === null ? <EmptyValue /> : <span>{formatNextRun(nextRunAt, row.original)}</span>;
      },
    },
    {
      id: 'lastRun',
      header: t`Last run`,
      size: 220,
      cell: ({ row }): ReactElement => <LastRunCell lastRun={row.original.lastRun} />,
    },
  ];

  return (
    <DataPageLayout
      data={rows}
      columns={columns}
      isLoading={isLoading}
      storageKey={STORAGE_KEY}
      search={{ placeholder: t`Search job kinds...`, texts: (schedule) => [schedule.kind] }}
      enableSorting={false}
      onClickRow={(row) => {
        const { source } = row.original;
        if (source !== null) {
          void navigate(getConnectors()[source].linkOption);
        }
      }}
    />
  );
};
