import { includesFolded } from '@app/utils/text-fold';
import type { ColumnDefWithOptionsHeader } from '@filigran/ui';
import { useNavigate } from '@tanstack/react-router';
import { EllipsisVertical } from 'lucide-react';
import type { FunctionComponent, ReactElement } from 'react';
import { t } from '@lingui/core/macro';
import { useQuery } from '@tanstack/react-query';
import { IconActions, IconActionsItem } from '../../../components/shared/icon-actions';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { BadgeCellList } from '../../../components/ui/badge-cell-list';
import { useUrlListFilters } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { useTenant } from '../../../providers';
import { usersListSearchSchema } from '../users-list-search';
import { getInitials, withSuperAdministratorTag } from '../utils';
import { DebouncedSearchField } from '../../../components/shared';
import { AddMembersDrawer } from '../../members/components/add-members-drawer';

interface ProcessedUser {
  id: string,
  email: string,
  name: string | null,
  title: string | null,
  isSuperAdmin: boolean,
  groups: Array<{ id: string, name: string }>,
  roles: Array<{ id: string, name: string }>,
  hasSignedIn: boolean,
}

export const UsersDataTable: FunctionComponent = () => {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const { tenantId } = useTenant();
  const { filters, setFilters } = useUrlListFilters(usersListSearchSchema);

  const { data: tenantUsers, isLoading } = useQuery(trpc.tenants.listTenantUsers.queryOptions({ tenantId }));

  const users: Array<ProcessedUser> = tenantUsers ?? [];
  const filteredData = users.filter((user) => {
    if (!filters.search) {
      return true;
    }
    return includesFolded(user.name, filters.search) || includesFolded(user.email, filters.search);
  });

  const columns: Array<ColumnDefWithOptionsHeader<ProcessedUser, unknown>> = [
    {
      id: 'user',
      header: t`User`,
      size: 300,
      cell: ({ row }): ReactElement => (
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
            {getInitials(row.original.name, row.original.email)}
          </div>
          <div className="flex flex-col">
            <span className="font-medium">{row.original.name ?? row.original.email}</span>
            {row.original.name && (
              <span className="text-xs text-muted-foreground">{row.original.email}</span>
            )}
          </div>
        </div>
      ),
    },
    {
      id: 'groups',
      header: t`Groups`,
      size: 250,
      cell: ({ row }): ReactElement => <BadgeCellList items={withSuperAdministratorTag(row.original.groups, row.original.isSuperAdmin)} />,
    },
    {
      id: 'roles',
      header: t`Roles`,
      size: 250,
      cell: ({ row }): ReactElement => <BadgeCellList items={row.original.roles} />,
    },
    {
      id: 'status',
      header: t`Status`,
      size: 150,
      accessorFn: (user) => (user.hasSignedIn ? t`Active` : t`Never signed in`),
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
              onClick={() => navigate({
                from: '/$tenantId/{-$organizationId}',
                to: 'settings/security/users/$userId',
                params: { userId: row.original.id },
              })}
            >
              {t`View profile`}
            </IconActionsItem>
          </IconActions>
        </div>
      ),
    },
  ];

  return (
    <DataPageLayout
      data={filteredData}
      columns={columns}
      isLoading={isLoading}
      storageKey="users"
      headerActions={<AddMembersDrawer scope="tenant" />}
      onClickRow={(row) => {
        void navigate({
          from: '/$tenantId/{-$organizationId}',
          to: 'settings/security/users/$userId',
          params: { userId: row.original.id },
        })
      }}
      leftHeaderContent={
        <DebouncedSearchField
          placeholder={t`Search users...`}
          value={filters.search}
          onCommit={(search) => setFilters({ search })}
          clearLabel={t`Clear search`}
          className="w-80"
        />
      }
    />
  );
};
