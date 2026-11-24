import { Chip } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import type { inferRouterOutputs } from '@trpc/server';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import type { FunctionComponent, ReactElement } from 'react';
import { useId, useState } from 'react';
import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import type { RunReferencesLookup } from '../use-run-references';
import { scopePath } from '../../../components/layout/scope-path-utils';
import { TooltipHint, TooltipHintProvider } from '../../../components/shared';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { EmptyValue } from '../../../components/ui/empty-value';
import { usePersistedPageSize } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { formatDateTime } from '../../../utils';
import { useRunReferences } from '../use-run-references';
import { CLAIMABILITY_SEVERITY, claimabilityHint, claimabilityLabel, RUN_STATUS_SEVERITY, runStatusLabel } from '../run-vocabulary';
import { RunReferenceList } from './run-reference-list';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;
type QueueSections = RouterOutputs['jobs']['listQueue'];
type QueueRunRow = QueueSections['running']['items'][number];
type QueuePendingRow = QueueSections['pending']['items'][number];

const QUEUE_PAGE_SIZE = 10;

const PENDING_TABLE_ID = 'settings-jobs-queue-pending';
const RUNNING_TABLE_ID = 'settings-jobs-queue-running';
const FAILED_TABLE_ID = 'settings-jobs-queue-failed';
const SUCCEEDED_TABLE_ID = 'settings-jobs-queue-succeeded';

type QueueTableId = typeof PENDING_TABLE_ID | typeof RUNNING_TABLE_ID | typeof FAILED_TABLE_ID | typeof SUCCEEDED_TABLE_ID;

const kindCell = ({ row }: { row: { original: { kind: string } } }): ReactElement => (
  <span className="font-content-code text-content-code">{row.original.kind}</span>
);

const parametersCell = ({ row }: { row: { original: { payload: string | null } } }): ReactElement => {
  const { payload } = row.original;
  return payload === null
    ? <EmptyValue />
    : <span className="block max-w-[220px] truncate font-content-code text-content-code" title={payload}>{payload}</span>;
};

// The title gives the full time back when a narrow viewport cuts the cell.
const instantCell = (value: string | null): ReactElement => {
  if (value === null) {
    return <EmptyValue />;
  }
  const formatted = formatDateTime(value);
  return <span title={formatted}>{formatted}</span>;
};

const relatedToColumn = <T extends { payload: string | null }>(referencesFor: RunReferencesLookup['referencesFor']) => ({
  id: 'relatedTo',
  header: t`Related to`,
  size: 150,
  cell: ({ row }: { row: { original: T } }): ReactElement => <RunReferenceList references={referencesFor(row.original.payload)} />,
});

interface QueueTableProps<T extends { id: string }> {
  title: string,
  description?: string,
  rows: Array<T>,
  total: number | undefined,
  columns: Array<ColumnDefWithOptionsHeader<T, unknown>>,
  isLoading: boolean,
  isPlaceholderData: boolean,
  isFetching: boolean,
  storageKey: string,
  page: number,
  onPageChange: (page: number) => void,
  onClickRow: (id: string) => void,
}

const QueueTable = <T extends { id: string }>({ title, description, rows, total, columns, isLoading, isPlaceholderData, isFetching, storageKey, page, onPageChange, onClickRow }: QueueTableProps<T>): ReactElement => {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId}>
      <DataPageLayout
        data={rows}
        total={total}
        columns={columns}
        isLoading={isLoading}
        isPlaceholderData={isPlaceholderData}
        isFetching={isFetching}
        storageKey={storageKey}
        initialPageSize={QUEUE_PAGE_SIZE}
        enableSorting={false}
        leftHeaderContent={(
          <div className="flex items-baseline gap-3">
            <h2 id={titleId}>{title}</h2>
            {description !== undefined && <p className="txt-sub-content text-default-secondary">{description}</p>}
          </div>
        )}
        pageIndex={page - 1}
        onServerPageChange={(pagination) => onPageChange(pagination.pageIndex + 1)}
        onClickRow={(row) => onClickRow(row.original.id)}
      />
    </section>
  );
};

export const QueuePage: FunctionComponent = () => {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const { tenantId, organizationId } = useParams({ strict: false });
  const toRunDetail = (id: string) => {
    void navigate({ href: scopePath(tenantId ?? '', organizationId, `settings/jobs/runs/${id}`) });
  };

  const [pendingPage, setPendingPage] = useState(1);
  const [runningPage, setRunningPage] = useState(1);
  const [failedPage, setFailedPage] = useState(1);
  const [succeededPage, setSucceededPage] = useState(1);
  // One query feeds the four tables, so its placeholder rows stand for a load of the table last paged only.
  const [pagedTableId, setPagedTableId] = useState<QueueTableId>();
  const pageTable = (tableId: QueueTableId, setPage: (page: number) => void) => (page: number) => {
    setPagedTableId(tableId);
    setPage(page);
  };

  const { pageSize: pendingPageSize } = usePersistedPageSize(PENDING_TABLE_ID, QUEUE_PAGE_SIZE);
  const { pageSize: runningPageSize } = usePersistedPageSize(RUNNING_TABLE_ID, QUEUE_PAGE_SIZE);
  const { pageSize: failedPageSize } = usePersistedPageSize(FAILED_TABLE_ID, QUEUE_PAGE_SIZE);
  const { pageSize: succeededPageSize } = usePersistedPageSize(SUCCEEDED_TABLE_ID, QUEUE_PAGE_SIZE);

  const { data, isLoading, isPlaceholderData, isFetching } = useQuery(trpc.jobs.listQueue.queryOptions({
    pending: { page: pendingPage, limit: pendingPageSize },
    running: { page: runningPage, limit: runningPageSize },
    failed: { page: failedPage, limit: failedPageSize },
    succeeded: { page: succeededPage, limit: succeededPageSize },
  }, { placeholderData: keepPreviousData }));

  const pending: Array<QueuePendingRow> = data?.pending.items ?? [];
  const running: Array<QueueRunRow> = data?.running.items ?? [];
  const failed: Array<QueueRunRow> = data?.failed.items ?? [];
  const succeeded: Array<QueueRunRow> = data?.succeeded.items ?? [];

  const { referencesFor } = useRunReferences([...pending, ...running, ...failed, ...succeeded]);

  const pendingColumns: Array<ColumnDefWithOptionsHeader<QueuePendingRow, unknown>> = [
    { id: 'kind', accessorKey: 'kind', header: t`Kind`, size: 110, cell: kindCell },
    relatedToColumn<QueuePendingRow>(referencesFor),
    { id: 'payload', header: t`Parameters`, size: 70, cell: parametersCell },
    { id: 'runAfter', accessorKey: 'runAfter', header: t`Run after`, size: 90, cell: ({ row }): ReactElement => instantCell(row.original.runAfter) },
    {
      id: 'claimability',
      accessorKey: 'claimability',
      header: t`Claimability`,
      // Wide enough for "Waiting for schedule": an overflowing chip crops mid-pill, with no "…"
      // the cell's own text-ellipsis truncation would give plain text.
      size: 200,
      cell: ({ row }): ReactElement => (
        <TooltipHintProvider>
          <TooltipHint hint={claimabilityHint(row.original.claimability)}>
            <span tabIndex={0} className="cursor-default">
              <Chip severity={CLAIMABILITY_SEVERITY[row.original.claimability]} label={claimabilityLabel(row.original.claimability)} />
            </span>
          </TooltipHint>
        </TooltipHintProvider>
      ),
    },
  ];

  const runningColumns: Array<ColumnDefWithOptionsHeader<QueueRunRow, unknown>> = [
    { id: 'kind', accessorKey: 'kind', header: t`Kind`, size: 110, cell: kindCell },
    relatedToColumn<QueueRunRow>(referencesFor),
    { id: 'payload', header: t`Parameters`, size: 70, cell: parametersCell },
    { id: 'claimedAt', accessorKey: 'claimedAt', header: t`Claimed at`, size: 90, cell: ({ row }): ReactElement => instantCell(row.original.claimedAt) },
  ];

  const finishedColumns: Array<ColumnDefWithOptionsHeader<QueueRunRow, unknown>> = [
    { id: 'kind', accessorKey: 'kind', header: t`Kind`, size: 110, cell: kindCell },
    relatedToColumn<QueueRunRow>(referencesFor),
    { id: 'payload', header: t`Parameters`, size: 70, cell: parametersCell },
    { id: 'finishedAt', accessorKey: 'finishedAt', header: t`Finished at`, size: 90, cell: ({ row }): ReactElement => instantCell(row.original.finishedAt) },
  ];

  // The section lists partial segments with the runs that succeeded (#157): each row says which it is,
  // with the chip the Runs tab shows, so a partial segment never reads as a success. Status sits right
  // after Kind, as on the Runs tab, sized to its chip so "Finished at" keeps the full time at 1080.
  const succeededColumns: Array<ColumnDefWithOptionsHeader<QueueRunRow, unknown>> = [
    { id: 'kind', accessorKey: 'kind', header: t`Kind`, size: 110, cell: kindCell },
    {
      id: 'status',
      accessorKey: 'status',
      header: t`Status`,
      size: 60,
      cell: ({ row }): ReactElement => (
        <Chip severity={RUN_STATUS_SEVERITY[row.original.status]} label={runStatusLabel(row.original.status)} />
      ),
    },
    relatedToColumn<QueueRunRow>(referencesFor),
    { id: 'payload', header: t`Parameters`, size: 70, cell: parametersCell },
    { id: 'finishedAt', accessorKey: 'finishedAt', header: t`Finished at`, size: 150, cell: ({ row }): ReactElement => instantCell(row.original.finishedAt) },
  ];

  return (
    <div className="flex flex-col gap-8">
      <QueueTable
        title={t`Pending`}
        description={t`This order is specific to this tenant: several workers pull from the same queue.`}
        rows={pending}
        total={data?.pending.total}
        columns={pendingColumns}
        isLoading={isLoading}
        isPlaceholderData={isPlaceholderData && pagedTableId === PENDING_TABLE_ID}
        isFetching={isFetching}
        storageKey={PENDING_TABLE_ID}
        page={pendingPage}
        onPageChange={pageTable(PENDING_TABLE_ID, setPendingPage)}
        onClickRow={toRunDetail}
      />
      <QueueTable
        title={t`Running`}
        rows={running}
        total={data?.running.total}
        columns={runningColumns}
        isLoading={isLoading}
        isPlaceholderData={isPlaceholderData && pagedTableId === RUNNING_TABLE_ID}
        isFetching={isFetching}
        storageKey={RUNNING_TABLE_ID}
        page={runningPage}
        onPageChange={pageTable(RUNNING_TABLE_ID, setRunningPage)}
        onClickRow={toRunDetail}
      />
      <QueueTable
        title={t`Failed`}
        rows={failed}
        total={data?.failed.total}
        columns={finishedColumns}
        isLoading={isLoading}
        isPlaceholderData={isPlaceholderData && pagedTableId === FAILED_TABLE_ID}
        isFetching={isFetching}
        storageKey={FAILED_TABLE_ID}
        page={failedPage}
        onPageChange={pageTable(FAILED_TABLE_ID, setFailedPage)}
        onClickRow={toRunDetail}
      />
      <QueueTable
        title={t`Succeeded`}
        rows={succeeded}
        total={data?.succeeded.total}
        columns={succeededColumns}
        isLoading={isLoading}
        isPlaceholderData={isPlaceholderData && pagedTableId === SUCCEEDED_TABLE_ID}
        isFetching={isFetching}
        storageKey={SUCCEEDED_TABLE_ID}
        page={succeededPage}
        onPageChange={pageTable(SUCCEEDED_TABLE_ID, setSucceededPage)}
        onClickRow={toRunDetail}
      />
    </div>
  );
};
