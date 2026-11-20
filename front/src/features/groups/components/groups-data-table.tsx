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
import { BadgeCellList } from '../../../components/ui/badge-cell-list';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { useConfirmationDialog, useEditSelection } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { EditGroup } from './group-update';

interface ProcessedGroup {
  id: string,
  name: string,
  memberCount: number,
  serviceAccountCount: number,
  roles: Array<{ id: string, name: string }>,
}

const GroupMembersCount: FunctionComponent<{ count: number }> = ({ count }) => (
  <Chip label={t({ message: plural(count, { one: '# member', other: '# members' }) })} />
);

const GroupServiceAccountsCount: FunctionComponent<{ count: number }> = ({ count }) => (
  <Chip label={t({ message: plural(count, { one: '# service account', other: '# service accounts' }) })} />
);

export const GroupsDataTable: FunctionComponent = () => {
  const trpc = useTRPC();

  const { editId, openEdit, closeEdit } = useEditSelection();
  const confirmDialog = useConfirmationDialog();
  const { confirm, requestConfirmation } = confirmDialog;
  const [createDrawerOpen, setCreateDrawerOpen] = useState(false);

  const { data, isLoading } = useQuery(trpc.groups.listGroups.queryOptions());
  const createGroup = useMutation(trpc.groups.createGroup.mutationOptions({
    meta: { successMessage: msg`Group created successfully.` },
  }));
  const deleteGroup = useMutation(trpc.groups.deleteGroup.mutationOptions({
    meta: { successMessage: msg`Group deleted successfully.` },
  }));

  const handleDeleteConfirm = () => {
    const id = confirm();
    if (id) {
      deleteGroup.mutate({ id });
    }
  };

  const columns: Array<ColumnDefWithOptionsHeader<ProcessedGroup, unknown>> = [
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
      id: 'members',
      header: t`Members`,
      size: 150,
      cell: ({ row }): ReactElement => <GroupMembersCount count={row.original.memberCount} />,
    },
    {
      id: 'serviceAccounts',
      header: t`Service accounts`,
      size: 180,
      cell: ({ row }): ReactElement => <GroupServiceAccountsCount count={row.original.serviceAccountCount} />,
    },
    {
      id: 'roles',
      header: t`Roles`,
      size: 250,
      cell: ({ row }): ReactElement => <BadgeCellList items={row.original.roles} />,
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
              {t`Edit`}
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
        storageKey="groups"
        onCreate={() => setCreateDrawerOpen(true)}
        onClickRow={(row) => openEdit(row.original.id)}
      />

      {editId && (
        <EditGroup
          groupId={editId}
          onCloseDrawer={closeEdit}
        />
      )}

      <FormDrawer open={createDrawerOpen} onClose={() => setCreateDrawerOpen(false)} title={t`Create a new group`}>
        <CreateNameForm
          onSubmit={({ name }) => {
            createGroup.mutate({ id: uuidv7(), name });
            setCreateDrawerOpen(false);
          }}
        />
      </FormDrawer>

      <DeleteConfirmDialog
        open={confirmDialog.isOpen}
        onOpenChange={(open) => {
          if (!open) {
            confirmDialog.cancel();
          }
        }}
        onConfirm={handleDeleteConfirm}
        title={<Trans>Delete group</Trans>}
        description={<Trans>This will permanently delete this group and remove all member associations. This action cannot be undone.</Trans>}
      />
    </>
  );
};
