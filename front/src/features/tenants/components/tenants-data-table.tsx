/*
Copyright (c) 2026 Filigran SAS

This file is part of the OpenCRQ Enterprise Edition ("EE") and is
licensed under the OpenCRQ Enterprise Edition License (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://github.com/OpenCRQ-Platform/opencrq/blob/main/LICENSE

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/

import { includesFolded } from '@app/utils/text-fold';
import { Chip } from '@filigran/design-system';
import { PlatformCapability_CreateTenants } from '@app/module/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { EllipsisVertical } from 'lucide-react';
import type { ColumnDefWithOptionsHeader } from '@filigran/ui';
import type { FunctionComponent, ReactElement } from 'react';
import { useState } from 'react';
import { uuidv7 } from 'uuidv7';
import { msg, plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { CreateNameForm, FormDrawer } from '../../../components';
import { DeleteConfirmDialog } from '../../../components/shared/delete-confirm-dialog';
import { IconActions, IconActionsItem } from '../../../components/shared/icon-actions';
import { DataPageWithCards } from '../../../components/ui/data-page-layout';
import { useConfirmationDialog, useEditSelection, useUrlListFilters } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { isCurrentEntry } from '../../../utils';
import { tenantsListSearchSchema } from '../tenants-list-search';
import { DebouncedSearchField } from '../../../components/shared';
import { TenantCard } from './tenant-card';
import { TenantRenameDrawer } from './tenant-rename-drawer';

interface Tenant {
  id: string,
  name: string,
  memberCount: number,
}

export const TenantsDataTable: FunctionComponent = () => {

  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { tenantId } = useParams({ strict: false });
  const { filters, setFilters } = useUrlListFilters(tenantsListSearchSchema);
  const confirmationDialog = useConfirmationDialog();
  const { confirm, requestConfirmation } = confirmationDialog;
  const [createDrawerOpen, setCreateDrawerOpen] = useState(false);
  const { editId, openEdit, closeEdit } = useEditSelection();

  const { data: tenants, isLoading } = useQuery(trpc.tenants.getTenantsWithMemberCount.queryOptions());

  const refreshTenants = () => {
    // eslint-disable-next-line no-restricted-syntax -- the `tenants` doorbell carries the created, deleted or renamed tenant's own id, which this administrator's stream is not subscribed to.
    void queryClient.invalidateQueries(trpc.tenants.getTenantsWithMemberCount.queryFilter());
    // eslint-disable-next-line no-restricted-syntax -- same doorbell-routing gap as above, for the header's own tenant switcher (scope-slot.tsx).
    void queryClient.invalidateQueries(trpc.tenants.getTenants.queryFilter());
  };

  const { data: canCreateTenantsData } = useQuery(trpc.platformCapabilities.hasPlatformCapability.queryOptions({ capabilityId: PlatformCapability_CreateTenants }));
  const canCreateTenants = canCreateTenantsData === true;
  const createTenant = useMutation(trpc.tenants.createTenantsTransaction.mutationOptions({
    meta: { successMessage: msg`Tenant created successfully.` },
    onSuccess: refreshTenants,
  }));
  const deleteTenants = useMutation(trpc.tenants.deleteTenantsTransaction.mutationOptions({
    meta: { successMessage: msg`Tenant deleted successfully.` },
    onSuccess: refreshTenants,
  }));

  const renamedTenant = editId === undefined ? undefined : tenants?.find((tenant) => tenant.id === editId);

  const handleDeleteConfirm = () => {
    const id = confirm();
    if (id) {
      deleteTenants.mutate([id]);
    }
  };

  const handleNavigate = (id: string) => {
    void navigate({
      to: '/$tenantId/{-$organizationId}',
      params: { tenantId: id, organizationId: undefined },
    });
  };

  const filteredTenants = (() => {
    if (!tenants) {
      return [];
    }
    if (!filters.search) {
      return tenants;
    }
    return tenants.filter((tenant) => includesFolded(tenant.name, filters.search));
  })();

  const columns: Array<ColumnDefWithOptionsHeader<Tenant, unknown>> = [
    {
      id: 'name',
      accessorKey: 'name',
      header: t`Name`,
      size: 300,
      cell: ({ row }): ReactElement => (
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 txt-mini font-semibold text-primary">
            {row.original.name.slice(0, 2).toUpperCase()}
          </div>
          <span className="font-medium">
            {row.original.name}
          </span>
        </div>
      ),
    },
    {
      id: 'members',
      header: t`Members`,
      size: 150,
      cell: ({ row }): ReactElement => {
        const count = row.original.memberCount;
        return <Chip label={t({ message: plural(count, { one: '# member', other: '# members' }) })} />;
      },
    },
    {
      id: 'id',
      accessorKey: 'id',
      header: t`Identifier`,
      size: 320,
      cell: ({ row }): ReactElement => (
        <span className="font-mono txt-sub-content text-muted-foreground">
          {row.original.id}
        </span>
      ),
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
              onClick={() => handleNavigate(row.original.id)}
            >
              {t`Open`}
            </IconActionsItem>
            {canCreateTenants && (
              <IconActionsItem
                onClick={() => openEdit(row.original.id)}
              >
                {t`Rename`}
              </IconActionsItem>
            )}
            {canCreateTenants && (
              <IconActionsItem
                onClick={() => requestConfirmation(row.original.id)}
              >
                {t`Delete`}
              </IconActionsItem>
            )}
          </IconActions>
        </div>
      ),
    },
  ];

  return (
    <>
      <DataPageWithCards
        data={filteredTenants}
        columns={columns}
        isLoading={isLoading}
        storageKey="tenants"
        defaultView="grid"
        onClickRow={(row) => handleNavigate(row.original.id)}
        onCreate={canCreateTenants ? () => setCreateDrawerOpen(true) : undefined}
        onDeleteItems={canCreateTenants ? deleteTenants.mutate : undefined}
        leftHeaderContent={(
          <DebouncedSearchField
            placeholder={t`Search tenants...`}
            value={filters.search}
            onCommit={(search) => setFilters({ search })}
            clearLabel={t`Clear search`}
            className="w-full max-w-sm"
          />
        )}
        renderCard={(tenant) => (
          <TenantCard
            key={tenant.id}
            id={tenant.id}
            name={tenant.name}
            memberCount={tenant.memberCount}
            onDelete={canCreateTenants ? requestConfirmation : undefined}
            onRename={canCreateTenants ? openEdit : undefined}
            onNavigate={handleNavigate}
            isCurrent={isCurrentEntry(tenant.id, tenantId)}
          />
        )}
      />

      <FormDrawer open={createDrawerOpen} onClose={() => setCreateDrawerOpen(false)} title={t`Create a new tenant`}>
        <CreateNameForm
          onSubmit={({ name }) => {
            createTenant.mutate({ id: uuidv7(), name });
            setCreateDrawerOpen(false);
          }}
        />
      </FormDrawer>

      {renamedTenant !== undefined && (
        <TenantRenameDrawer
          open
          onOpenChange={closeEdit}
          tenant={renamedTenant}
          onRenamed={refreshTenants}
        />
      )}

      <DeleteConfirmDialog
        open={confirmationDialog.isOpen}
        onOpenChange={(open) => {
          if (!open) {
            confirmationDialog.cancel();
          }
        }}
        onConfirm={handleDeleteConfirm}
        title={<Trans>Delete tenant</Trans>}
        description={<Trans>This will permanently delete this tenant and all associated data including users, roles, groups, and configurations. This action cannot be undone.</Trans>}
      />
    </>
  );
};
