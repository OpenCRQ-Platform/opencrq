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
import { EditRole } from './role-update';

interface ProcessedRole {
  id: string,
  name: string,
  capabilityCount: number,
}

const RoleCapabilitiesCount: FunctionComponent<{ count: number }> = ({ count }) => (
  <Chip label={t({ message: plural(count, { one: '# capability', other: '# capabilities' }) })} />
);

export const RolesDataTable: FunctionComponent = () => {
  const trpc = useTRPC();

  const { editId, openEdit, closeEdit } = useEditSelection();
  const confirmationDialog = useConfirmationDialog();
  const { confirm, requestConfirmation } = confirmationDialog;
  const [createDrawerOpen, setCreateDrawerOpen] = useState(false);

  const { data, isLoading } = useQuery(trpc.roles.listRoles.queryOptions());
  const createRole = useMutation(trpc.roles.createRole.mutationOptions({
    meta: { successMessage: msg`Role created successfully.` },
  }));
  const deleteRole = useMutation(trpc.roles.deleteRole.mutationOptions({
    meta: { successMessage: msg`Role deleted successfully.` },
  }));

  const handleDeleteConfirm = () => {
    const id = confirm();
    if (id) {
      deleteRole.mutate({ id });
    }
  };

  const columns: Array<ColumnDefWithOptionsHeader<ProcessedRole, unknown>> = [
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
      cell: ({ row }): ReactElement => <RoleCapabilitiesCount count={row.original.capabilityCount} />,
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
        storageKey="roles"
        search={{ placeholder: t`Search roles...`, texts: (role) => [role.name] }}
        onCreate={() => setCreateDrawerOpen(true)}
        onClickRow={(row) => openEdit(row.original.id)}
      />

      {editId && (
        <EditRole
          roleId={editId}
          onCloseDrawer={closeEdit}
        />
      )}

      <FormDrawer open={createDrawerOpen} onClose={() => setCreateDrawerOpen(false)} title={t`Create a new role`}>
        <CreateNameForm
          onSubmit={({ name }) => {
            createRole.mutate({ id: uuidv7(), name });
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
        title={<Trans>Delete role</Trans>}
        description={<Trans>This will permanently delete this role and remove it from all groups. This action cannot be undone.</Trans>}
      />
    </>
  );
};
