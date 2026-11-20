import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import { t } from '@lingui/core/macro';
import { useParams } from '@tanstack/react-router';
import { Download } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent, ReactElement } from 'react';
import { ActorName } from '../../../components/shared';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { EmptyValue } from '../../../components/ui/empty-value';
import { useTRPC } from '../../../lib';
import { formatBytes, formatDateTime, resolveActor } from '../../../utils';

interface StoredFileRow {
  id: string,
  originalName: string,
  mimeType: string,
  sizeBytes: number,
  createdAt: string,
  createdByEmail: string | null,
  createdByServiceAccountId: string | null,
  createdByServiceAccountName: string | null,
}

export const FileStorageDataTable: FunctionComponent = () => {
  const trpc = useTRPC();
  const { data, isLoading } = useQuery(trpc.fileStorage.list.queryOptions());
  const { data: settings } = useQuery(trpc.fileStorage.getSettings.queryOptions());
  const { tenantId } = useParams({ strict: false });

  // File storage may be disabled deployment-wide (no `file_storage` config) — the list itself
  // is plain DB data and stays fully usable, but there is nothing to download from in that case.
  // Defaults to hidden while `getSettings` is still loading, so a quick click can't hit a
  // download route that may not be mounted.
  const downloadEnabled = settings?.enabled === true;

  const downloadColumn: ColumnDefWithOptionsHeader<StoredFileRow, unknown> = {
    id: 'download',
    header: '',
    size: 60,
    cell: ({ row }): ReactElement => (
      <a
        href={`/api/file-storage/${row.original.id}/download?tenantId=${tenantId ?? ''}`}
        className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={t`Download`}
      >
        <Download className="h-4 w-4" />
      </a>
    ),
  };

  const columns: Array<ColumnDefWithOptionsHeader<StoredFileRow, unknown>> = [
    {
      id: 'originalName',
      accessorKey: 'originalName',
      header: t`Name`,
      cell: ({ row }): ReactElement => <span className="font-medium">{row.original.originalName}</span>,
    },
    {
      id: 'mimeType',
      accessorKey: 'mimeType',
      header: t`Type`,
      size: 180,
      cell: ({ row }): ReactElement => (
        <span className="text-muted-foreground txt-sub-content">{row.original.mimeType}</span>
      ),
    },
    {
      id: 'sizeBytes',
      accessorKey: 'sizeBytes',
      header: t`Size`,
      size: 100,
      cell: ({ row }): ReactElement => <span>{formatBytes(row.original.sizeBytes)}</span>,
    },
    {
      id: 'uploadedBy',
      header: t`Uploaded By`,
      size: 220,
      cell: ({ row }): ReactElement => {
        const { createdByEmail, createdByServiceAccountId, createdByServiceAccountName } = row.original;
        const actor = resolveActor(
          createdByEmail,
          createdByServiceAccountId === null ? null : { id: createdByServiceAccountId, name: createdByServiceAccountName },
        );
        return (
          <span className="text-muted-foreground txt-sub-content">
            {actor === null ? <EmptyValue /> : <ActorName actor={actor} />}
          </span>
        );
      },
    },
    {
      id: 'createdAt',
      accessorKey: 'createdAt',
      header: t`Uploaded At`,
      size: 150,
      cell: ({ row }): ReactElement => (
        <span className="txt-sub-content text-muted-foreground">
          {formatDateTime(row.original.createdAt)}
        </span>
      ),
    },
    ...(downloadEnabled ? [downloadColumn] : []),
  ];

  return (
    <DataPageLayout
      data={data ?? []}
      columns={columns}
      isLoading={isLoading}
      storageKey="fileStorage"
      initialSorting={[{ id: 'createdAt', desc: true }]}
    />
  );
};
