import { Chip } from '@filigran/design-system';
import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import { EllipsisVertical } from 'lucide-react';
import type { FunctionComponent, ReactElement } from 'react';
import { useState } from 'react';
import { uuidv7 } from 'uuidv7';
import { msg, plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CreateNameForm, FormDrawer } from '../../../components';
import { DeleteConfirmDialog } from '../../../components/shared/delete-confirm-dialog';
import { IconActions, IconActionsItem } from '../../../components/shared/icon-actions';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { useConfirmationDialog, useEditSelection } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { EditPlatformRole } from './platform-role-update';

interface ProcessedPlatformRole {
  id: string,
  name: string,
  capabilityCount: number,
}

const PlatformRoleCapabilitiesCount: FunctionComponent<{ count: number }> = ({ count }) => (
  <Chip label={t({ message: plural(count, { one: '# capability', other: '# capabilities' }) })} />
);

export const PlatformRolesDataTable: FunctionComponent = () => {
  const trpc = useTRPC();

  const { editId, openEdit, closeEdit } = useEditSelection();
  const confirmationDialog = useConfirmationDialog();
  const { confirm, requestConfirmation } = confirmationDialog;
  const [createDrawerOpen, setCreateDrawerOpen] = useState(false);

  const { data, isLoading } = useQuery(trpc.platformRoles.listPlatformRoles.queryOptions());
  const createPlatformRole = useMutation(trpc.platformRoles.createPlatformRole.mutationOptions({
    meta: { successMessage: msg`Platform role created successfully.` },
  }));
  const deletePlatformRole = useMutation(trpc.platformRoles.deletePlatformRole.mutationOptions({
    meta: { successMessage: msg`Platform role deleted successfully.` },
  }));

  const handleDeleteConfirm = () => {
    const id = confirm();
    if (id) {
      deletePlatformRole.mutate({ id });
    }
  };

  const columns: Array<ColumnDefWithOptionsHeader<ProcessedPlatformRole, unknown>> = [
    {
      id: 'name',
      accessorKey: 'name',
      header: t`Name`,
      size: 250,
      cell: ({ row }): ReactElement => (
        <span className="font-medium">
          {row.original.name}
        </span>
      ),
    },
    {
      id: 'capabilities',
      header: t`Capabilities`,
      size: 200,
      cell: ({ row }): ReactElement => <PlatformRoleCapabilitiesCount count={row.original.capabilityCount} />,
    },
    {
      id: 'actions',
      header: '',
      size: 50,
      enableHiding: false,
      enableResizing: false,
      cell: ({ row }): ReactElement => (
        <div
          className="flex items-center justify-end"
          onClick={(e) => e.stopPropagation()}
        >
          <IconActions icon={<EllipsisVertical className="h-4 w-4 text-primary" />}>
            <IconActionsItem
              onClick={() => openEdit(row.original.id)}
            >
              {t`Edit capabilities`}
            </IconActionsItem>
            <IconActionsItem
              onClick={() => requestConfirmation(row.original.id)}
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
        data={data ?? []}
        columns={columns}
        isLoading={isLoading}
        storageKey="platform-roles"
        onCreate={() => setCreateDrawerOpen(true)}
        onClickRow={(row) => openEdit(row.original.id)}
      />

      {editId && (
        <EditPlatformRole
          platformRoleId={editId}
          onCloseDrawer={closeEdit}
        />
      )}

      <FormDrawer open={createDrawerOpen} onClose={() => setCreateDrawerOpen(false)} title={t`Create a new platform role`}>
        <CreateNameForm
          onSubmit={({ name }) => {
            createPlatformRole.mutate({ id: uuidv7(), name });
            setCreateDrawerOpen(false);
          }}
        />
      </FormDrawer>

      <DeleteConfirmDialog
        open={confirmationDialog.isOpen}
        onOpenChange={(open) => {
          if (!open) {
            confirmationDialog.cancel();
          }
        }}
        onConfirm={handleDeleteConfirm}
        title={<Trans>Delete platform role</Trans>}
        description={<Trans>This will permanently delete this platform role and remove it from all groups. This action cannot be undone.</Trans>}
      />
    </>
  );
};
