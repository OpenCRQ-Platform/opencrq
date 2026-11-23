import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import { Chip } from '@filigran/design-system';
import { msg, plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { EllipsisVertical } from 'lucide-react';
import type { FunctionComponent, ReactElement } from 'react';
import { useState } from 'react';
import { uuidv7 } from 'uuidv7';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CreateNameForm, FormDrawer } from '../../../components';
import { DeleteConfirmDialog } from '../../../components/shared/delete-confirm-dialog';
import { IconActions, IconActionsItem } from '../../../components/shared/icon-actions';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { BadgeCellList } from '../../../components/ui/badge-cell-list';
import { useConfirmationDialog, useEditSelection } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { EditPlatformGroup } from './platform-group-update';

interface ProcessedPlatformGroup {
  id: string,
  name: string,
  memberCount: number,
  roles: Array<{ id: string, name: string }>,
}

const PlatformGroupMembersCount: FunctionComponent<{ count: number }> = ({ count }) => (
  <Chip label={t({ message: plural(count, { one: '# member', other: '# members' }) })} />
);

export const PlatformGroupsDataTable: FunctionComponent = () => {
  const trpc = useTRPC();

  const { editId, openEdit, closeEdit } = useEditSelection();
  const confirmationDialog = useConfirmationDialog();
  const { confirm, requestConfirmation } = confirmationDialog;
  const [createDrawerOpen, setCreateDrawerOpen] = useState(false);

  const { data, isLoading } = useQuery(trpc.platformGroups.listPlatformGroups.queryOptions());
  const createPlatformGroup = useMutation(trpc.platformGroups.createPlatformGroup.mutationOptions({
    meta: { successMessage: msg`Platform group created successfully.` },
  }));
  const deletePlatformGroup = useMutation(trpc.platformGroups.deletePlatformGroup.mutationOptions({
    meta: { successMessage: msg`Platform group deleted successfully.` },
  }));

  const handleDeleteConfirm = () => {
    const id = confirm();
    if (id) {
      deletePlatformGroup.mutate({ id });
    }
  };

  const columns: Array<ColumnDefWithOptionsHeader<ProcessedPlatformGroup, unknown>> = [
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
      cell: ({ row }): ReactElement => <PlatformGroupMembersCount count={row.original.memberCount} />,
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
        storageKey="platform-groups"
        search={{ placeholder: t`Search groups...`, texts: (group) => [group.name] }}
        onCreate={() => setCreateDrawerOpen(true)}
        onClickRow={(row) => openEdit(row.original.id)}
      />

      {editId && (
        <EditPlatformGroup
          platformGroupId={editId}
          onCloseDrawer={closeEdit}
        />
      )}

      <FormDrawer open={createDrawerOpen} onClose={() => setCreateDrawerOpen(false)} title={t`Create a new platform group`}>
        <CreateNameForm
          onSubmit={({ name }) => {
            createPlatformGroup.mutate({ id: uuidv7(), name });
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
        title={<Trans>Delete platform group</Trans>}
        description={<Trans>This will permanently delete this platform group and remove all member associations. This action cannot be undone.</Trans>}
      />
    </>
  );
};
