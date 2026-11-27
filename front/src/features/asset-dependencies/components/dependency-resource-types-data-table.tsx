import { msg, plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useMutation, useQuery } from '@tanstack/react-query';
import { EllipsisVertical, Pencil, Trash2 } from 'lucide-react';
import type { FunctionComponent, ReactElement } from 'react';
import { useState } from 'react';
import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import { DeleteConfirmDialog } from '../../../components/shared/delete-confirm-dialog';
import { IconActions, IconActionsItem } from '../../../components/shared/icon-actions';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { useConfirmationDialog } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { DependencyResourceTypeDrawer } from './dependency-resource-type-drawer';

interface ResourceTypeRow {
  id: string,
  name: string,
  linkCount: number,
}

type DrawerState = { kind: 'create' } | { kind: 'rename', typeId: string };

export const DependencyResourceTypesDataTable: FunctionComponent = () => {
  const trpc = useTRPC();
  const confirmationDialog = useConfirmationDialog();
  const [drawer, setDrawer] = useState<DrawerState | null>(null);

  const { data: types, isLoading } = useQuery(trpc.assetDependencies.listDependencyResourceTypes.queryOptions());
  const deleteType = useMutation(trpc.assetDependencies.deleteDependencyResourceType.mutationOptions({
    meta: { successMessage: msg`Resource type deleted successfully.` },
  }));

  const handleDeleteConfirm = () => {
    const id = confirmationDialog.confirm();
    if (id) {
      deleteType.mutate({ id });
    }
  };

  const pendingDelete = types?.find((type) => type.id === confirmationDialog.pendingId);
  const pendingName = pendingDelete?.name ?? '';
  const pendingLinkCount = pendingDelete?.linkCount ?? 0;
  const edited = drawer?.kind === 'rename' ? types?.find((type) => type.id === drawer.typeId) ?? null : null;

  const columns: Array<ColumnDefWithOptionsHeader<ResourceTypeRow, unknown>> = [
    {
      id: 'name',
      accessorKey: 'name',
      header: t`Name`,
      size: 300,
      cell: ({ row }): ReactElement => <span className="font-medium">{row.original.name}</span>,
    },
    {
      id: 'linkCount',
      accessorKey: 'linkCount',
      header: t`Dependencies`,
      size: 150,
      cell: ({ row }): ReactElement => <span>{row.original.linkCount}</span>,
    },
    {
      id: 'actions',
      header: '',
      size: 50,
      enableHiding: false,
      enableResizing: false,
      cell: ({ row }): ReactElement => (
        <div className="flex items-center justify-end" onClick={(event) => event.stopPropagation()}>
          <IconActions icon={<EllipsisVertical className="h-4 w-4 text-primary" />}>
            <IconActionsItem startIcon={<Pencil className="h-4 w-4" />} onClick={() => setDrawer({ kind: 'rename', typeId: row.original.id })}>
              {t`Rename`}
            </IconActionsItem>
            <IconActionsItem
              className="text-feedback-error-primary"
              startIcon={<Trash2 className="h-4 w-4 text-feedback-error-primary" />}
              onClick={() => confirmationDialog.requestConfirmation(row.original.id)}
            >
              {t`Delete`}
            </IconActionsItem>
          </IconActions>
        </div>
      ),
    },
  ];

  return (
    <>
      <DataPageLayout
        data={types ?? []}
        columns={columns}
        isLoading={isLoading}
        storageKey="dependency-resource-types"
        search={{ placeholder: t`Search resource types...`, texts: (type) => [type.name] }}
        onCreate={() => setDrawer({ kind: 'create' })}
        onClickRow={(row) => setDrawer({ kind: 'rename', typeId: row.original.id })}
      />

      <DependencyResourceTypeDrawer
        open={drawer !== null && (drawer.kind === 'create' || edited !== null)}
        onClose={() => setDrawer(null)}
        edited={edited}
        types={types ?? []}
      />

      <DeleteConfirmDialog
        open={confirmationDialog.isOpen}
        onOpenChange={(open) => {
          if (!open) {
            confirmationDialog.cancel();
          }
        }}
        onConfirm={handleDeleteConfirm}
        title={<Trans>Delete the resource type “{pendingName}”</Trans>}
        description={pendingLinkCount === 0
          ? <Trans>No dependency runs through this type.</Trans>
          : plural(pendingLinkCount, {
            one: 'The dependency running through it stays, with no type.',
            other: 'The # dependencies running through it stay, with no type.',
          })}
      />
    </>
  );
};
