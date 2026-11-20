import { Chip } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import type { RunSortKey } from '@app/module/client';
import type { inferRouterOutputs } from '@trpc/server';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { Merge } from 'lucide-react';
import type { FunctionComponent, ReactElement } from 'react';
import { useState } from 'react';
import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import { scopePath } from '../../../components/layout/scope-path-utils';
import { DateFormInput, DebouncedSearchField, MultiSelectField, TooltipHint, TooltipHintProvider } from '../../../components/shared';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { EmptyValue } from '../../../components/ui/empty-value';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { usePersistedPageSize, usePersistedSorting, useUrlListFilters } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { formatDateTime, formatDurationMs, formatUrlList } from '../../../utils';
import { triggeredByLabel } from '../job-vocabulary';
import {
  isRunDateField,
  RUN_STATUSES,
  RUN_TRIGGERED_BY,
  runQueryParamsFromFilters,
  runsUrlFiltersEqual,
  toRunFilters,
} from '../run-filter-utils';
import { runTimings } from '../run-timings';
import { useRunReferences } from '../use-run-references';
import { RUN_STATUS_SEVERITY, runStatusLabel } from '../run-vocabulary';
import { runsListSearchSchema } from '../runs-list-search';
import { RunReferenceList } from './run-reference-list';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;
type RunRow = RouterOutputs['jobs']['listAllRuns']['items'][number];

const TABLE_ID = 'settings-jobs-runs';
const PAGE_LIMIT = 25;
const DEFAULT_SORTING = [{ id: 'enqueuedAt', desc: true }];

/** Only the columns the server can order on: `jobs.listAllRuns` has no sort key for a payload or
 * for the waited duration, so both stay `enableSorting: false` below. */
const SORT_KEY_BY_COLUMN: Record<string, RunSortKey | undefined> = {
  kind: 'kind',
  status: 'status',
  triggeredBy: 'triggeredBy',
  enqueuedAt: 'enqueuedAt',
  startedAt: 'startedAt',
  finishedAt: 'finishedAt',
  ranFor: 'duration',
  attempt: 'attempt',
};

const toSortKey = (columnId: string | undefined): RunSortKey | undefined =>
  (columnId === undefined ? undefined : SORT_KEY_BY_COLUMN[columnId]);

const dateFieldLabel = (field: 'enqueuedAt' | 'startedAt' | 'finishedAt'): string => {
  switch (field) {
    case 'enqueuedAt': return t`Queued at`;
    case 'startedAt': return t`Started at`;
    case 'finishedAt': return t`Finished at`;
  }
};

export const RunsPage: FunctionComponent = () => {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const { tenantId, organizationId } = useParams({ strict: false });

  const { filters: urlFilters, setFilters: setUrlFilters } = useUrlListFilters(runsListSearchSchema);
  const filters = toRunFilters(urlFilters);

  const [page, setPage] = useState(1);
  const [seenUrlFilters, setSeenUrlFilters] = useState(urlFilters);
  if (!runsUrlFiltersEqual(urlFilters, seenUrlFilters)) {
    setSeenUrlFilters(urlFilters);
    setPage(1);
  }

  const { pageSize } = usePersistedPageSize(TABLE_ID, PAGE_LIMIT);
  const { sorting } = usePersistedSorting(TABLE_ID, DEFAULT_SORTING);
  const [activeSort] = sorting;
  const sortBy = toSortKey(activeSort?.id) ?? 'enqueuedAt';
  const sortDesc = activeSort?.desc ?? true;

  const queryParams = runQueryParamsFromFilters(filters, { sortBy, sortDesc }, { pageIndex: page - 1, pageSize });
  const { data, isLoading, isPlaceholderData, isFetching } = useQuery(trpc.jobs.listAllRuns.queryOptions(queryParams, { placeholderData: keepPreviousData }));
  const { data: jobKinds } = useQuery(trpc.jobs.listJobKinds.queryOptions());

  const rows: Array<RunRow> = data?.items ?? [];
  const total = data?.total ?? 0;
  const { referencesFor } = useRunReferences(rows);

  const statusOptions = RUN_STATUSES.map((status) => ({ value: status, label: runStatusLabel(status) }));
  const kindOptions = (jobKinds ?? []).map((entry) => ({ value: entry.kind, label: entry.kind }));
  const triggeredByOptions = RUN_TRIGGERED_BY.map((triggeredBy) => ({ value: triggeredBy, label: triggeredByLabel(triggeredBy) }));

  const columns: Array<ColumnDefWithOptionsHeader<RunRow, unknown>> = [
    {
      id: 'kind',
      accessorKey: 'kind',
      header: t`Kind`,
      size: 340,
      cell: ({ row }): ReactElement => <span className="font-content-code text-content-code">{row.original.kind}</span>,
    },
    {
      id: 'status',
      accessorKey: 'status',
      header: t`Status`,
      size: 120,
      cell: ({ row }): ReactElement => (
        <span className="flex items-center gap-1.5">
          <Chip severity={RUN_STATUS_SEVERITY[row.original.status]} label={runStatusLabel(row.original.status)} />
          {row.original.absorbedAsk && (
            <TooltipHintProvider>
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
            </TooltipHintProvider>
          )}
        </span>
      ),
    },
    {
      id: 'triggeredBy',
      accessorKey: 'triggeredBy',
      header: t`Triggered by`,
      size: 140,
      cell: ({ row }): ReactElement => <span>{triggeredByLabel(row.original.triggeredBy)}</span>,
    },
    {
      id: 'relatedTo',
      header: t`Related to`,
      enableSorting: false,
      size: 200,
      cell: ({ row }): ReactElement => <RunReferenceList references={referencesFor(row.original.payload)} />,
    },
    {
      id: 'payload',
      header: t`Parameters`,
      enableSorting: false,
      size: 220,
      cell: ({ row }): ReactElement => {
        const { payload } = row.original;
        return payload === null
          ? <EmptyValue />
          : <span className="block max-w-[220px] truncate font-content-code text-content-code" title={payload}>{payload}</span>;
      },
    },
    {
      id: 'enqueuedAt',
      accessorKey: 'enqueuedAt',
      header: t`Queued at`,
      size: 160,
      cell: ({ row }): ReactElement => <span>{formatDateTime(row.original.enqueuedAt)}</span>,
    },
    {
      id: 'startedAt',
      accessorKey: 'startedAt',
      header: t`Started at`,
      size: 160,
      cell: ({ row }): ReactElement => (
        row.original.startedAt === null ? <EmptyValue /> : <span>{formatDateTime(row.original.startedAt)}</span>
      ),
    },
    {
      id: 'finishedAt',
      accessorKey: 'finishedAt',
      header: t`Finished at`,
      size: 160,
      cell: ({ row }): ReactElement => (
        row.original.finishedAt === null ? <EmptyValue /> : <span>{formatDateTime(row.original.finishedAt)}</span>
      ),
    },
    {
      id: 'waited',
      header: t`Waited`,
      enableSorting: false,
      size: 100,
      cell: ({ row }): ReactElement => {
        const duration = formatDurationMs(runTimings(row.original, Date.now()).waitedMs);
        return duration === null ? <EmptyValue /> : <span>{duration}</span>;
      },
    },
    {
      id: 'ranFor',
      // No single field of its own — `sortingFn`/`getSortedRowModel` never run under `manualSorting`,
      // so this accessor exists only to make `column.getCanSort()` true for a server-sorted column.
      accessorFn: (row) => runTimings(row, Date.now()).ranForMs,
      header: t`Ran for`,
      size: 100,
      cell: ({ row }): ReactElement => {
        const duration = formatDurationMs(runTimings(row.original, Date.now()).ranForMs);
        return duration === null ? <EmptyValue /> : <span>{duration}</span>;
      },
    },
    {
      id: 'attempt',
      accessorKey: 'attempt',
      header: t`Attempts`,
      size: 100,
      cell: ({ row }): ReactElement => <span>{`${row.original.attempt} / ${row.original.maxAttempts}`}</span>,
    },
  ];

  return (
    <DataPageLayout
      data={rows}
      total={total}
      columns={columns}
      isLoading={isLoading}
      isPlaceholderData={isPlaceholderData}
      isFetching={isFetching}
      storageKey={TABLE_ID}
      initialPageSize={PAGE_LIMIT}
      initialSorting={DEFAULT_SORTING}
      initialColumnVisibility={{ startedAt: false, waited: false, ranFor: false }}
      pageIndex={page - 1}
      serverSorted
      onServerPageChange={(pagination) => setPage(pagination.pageIndex + 1)}
      onClickRow={(row) => {
        void navigate({ href: scopePath(tenantId ?? '', organizationId, `settings/jobs/runs/${row.original.id}`) });
      }}
      leftHeaderContent={(
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-48">
            <MultiSelectField
              hideLabel
              label={t`Status`}
              placeholder={t`Status`}
              options={statusOptions}
              value={filters.statuses}
              onChange={(values) => setUrlFilters({ statuses: formatUrlList(values) })}
            />
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={filters.dateField}
              onValueChange={(value) => {
                if (isRunDateField(value)) {
                  setUrlFilters({ dateField: value });
                }
              }}
            >
              <SelectTrigger className="w-36" aria-label={t`Which instant the date window filters on`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="enqueuedAt">{dateFieldLabel('enqueuedAt')}</SelectItem>
                <SelectItem value="startedAt">{dateFieldLabel('startedAt')}</SelectItem>
                <SelectItem value="finishedAt">{dateFieldLabel('finishedAt')}</SelectItem>
              </SelectContent>
            </Select>
            <div className="w-44">
              <DateFormInput
                hideLabel
                label={t`Start of the date window`}
                value={filters.dateFrom}
                onChange={(date) => setUrlFilters({ dateFrom: date ?? '' })}
              />
            </div>
            <span className="txt-sub-content text-default-secondary">{t`to`}</span>
            <div className="w-44">
              <DateFormInput
                hideLabel
                label={t`End of the date window`}
                value={filters.dateTo}
                onChange={(date) => setUrlFilters({ dateTo: date ?? '' })}
              />
            </div>
          </div>
          <div className="w-48">
            <MultiSelectField
              hideLabel
              label={t`Kind`}
              placeholder={t`Kind`}
              options={kindOptions}
              value={filters.kinds}
              onChange={(values) => setUrlFilters({ kinds: formatUrlList(values) })}
            />
          </div>
          <div className="w-48">
            <MultiSelectField
              hideLabel
              label={t`Triggered by`}
              placeholder={t`Triggered by`}
              options={triggeredByOptions}
              value={filters.triggeredBy}
              onChange={(values) => setUrlFilters({ triggeredBy: formatUrlList(values) })}
            />
          </div>
          <DebouncedSearchField
            placeholder={t`Search runs...`}
            value={urlFilters.search}
            onCommit={(search) => setUrlFilters({ search })}
            clearLabel={t`Clear search`}
            className="w-64"
          />
        </div>
      )}
    />
  );
};
