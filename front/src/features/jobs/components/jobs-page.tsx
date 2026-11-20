import { SearchField } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import type { JobHealth } from '@app/module/client';
import { useNavigate, useParams } from '@tanstack/react-router';
import type { FunctionComponent, ReactElement } from 'react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { EmptyValue } from '../../../components/ui/empty-value';
import { scopePath } from '../../../components/layout/scope-path-utils';
import { useTRPC } from '../../../lib';
import { formatDurationMs, formatRelativeTime, msBetween } from '../../../utils';
import { filterJobsBySearch, sortJobsByAttention } from '../job-list-utils';
import { JobHealthChip } from './job-health-chip';

const STORAGE_KEY = 'settings-jobs';

interface JobLastRun {
  startedAt: string | null,
  finishedAt: string | null,
  attempt: number,
  maxAttempts: number,
}

interface JobRow {
  id: string,
  kind: string,
  health: JobHealth,
  lastRun: JobLastRun | null,
}

/** What the "last run" column reads: when the last run finished, or started if it carries no end yet. */
const lastRunAt = (lastRun: JobLastRun | null): string | null => (lastRun === null ? null : lastRun.finishedAt ?? lastRun.startedAt);

export const JobsPage: FunctionComponent = () => {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const { tenantId, organizationId } = useParams({ strict: false });
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery(trpc.jobs.listJobKinds.queryOptions());
  const rows: Array<JobRow> = (data ?? []).map((entry) => ({
    id: entry.kind,
    kind: entry.kind,
    health: entry.health,
    lastRun: entry.lastRun,
  }));
  const visible = sortJobsByAttention(filterJobsBySearch(rows, search));

  const columns: Array<ColumnDefWithOptionsHeader<JobRow, unknown>> = [
    {
      id: 'kind',
      accessorKey: 'kind',
      header: t`Kind`,
      size: 280,
      cell: ({ row }): ReactElement => <span className="font-content-code text-content-code">{row.original.kind}</span>,
    },
    {
      id: 'health',
      header: t`Health`,
      size: 140,
      cell: ({ row }): ReactElement => <JobHealthChip health={row.original.health} />,
    },
    {
      id: 'lastRun',
      header: t`Last run`,
      size: 160,
      cell: ({ row }): ReactElement => {
        const at = lastRunAt(row.original.lastRun);
        return at === null ? <EmptyValue /> : <span>{formatRelativeTime(at)}</span>;
      },
    },
    {
      id: 'duration',
      header: t`Duration`,
      size: 120,
      cell: ({ row }): ReactElement => {
        const lastRun = row.original.lastRun;
        const duration = lastRun === null ? null : formatDurationMs(msBetween(lastRun.startedAt, lastRun.finishedAt));
        return duration === null ? <EmptyValue /> : <span>{duration}</span>;
      },
    },
    {
      id: 'attempts',
      header: t`Attempts`,
      size: 120,
      cell: ({ row }): ReactElement => {
        const lastRun = row.original.lastRun;
        return lastRun === null ? <EmptyValue /> : <span>{`${lastRun.attempt} / ${lastRun.maxAttempts}`}</span>;
      },
    },
  ];

  return (
    <DataPageLayout
      data={visible}
      columns={columns}
      isLoading={isLoading}
      storageKey={STORAGE_KEY}
      enableSorting={false}
      onClickRow={(row) => {
        void navigate({ href: scopePath(tenantId ?? '', organizationId, `settings/jobs/kinds/${row.original.kind}`) });
      }}
      leftHeaderContent={(
        <SearchField
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onClear={() => setSearch('')}
          placeholder={t`Search jobs...`}
          clearLabel={t`Clear search`}
          aria-label={t`Search jobs`}
          className="w-full max-w-sm"
        />
      )}
    />
  );
};
