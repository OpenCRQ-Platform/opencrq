import { includesFolded } from '@app/utils/text-fold';
import type { ColumnDefWithOptionsHeader } from '@filigran/ui';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { EllipsisVertical } from 'lucide-react';
import type { FunctionComponent, ReactElement } from 'react';
import { t } from '@lingui/core/macro';
import { useQuery } from '@tanstack/react-query';
import { IconActions, IconActionsItem } from '../../../components/shared/icon-actions';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { BadgeCellList } from '../../../components/ui/badge-cell-list';
import { useUrlListFilters } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { usersListSearchSchema } from '../users-list-search';
import { getInitials, userDetailHref, withSuperAdministratorTag } from '../utils';
import { DebouncedSearchField } from '../../../components/shared';
import { AddMembersDrawer } from '../../members/components/add-members-drawer';

interface ProcessedUser {
  id: string,
  email: string,
  name: string | null,
  title: string | null,
  isSuperAdmin: boolean,
  platformGroups: Array<{ id: string, name: string }>,
  platformRoles: Array<{ id: string, name: string }>,
  tenants: Array<{ id: string, name: string }>,
}

export const PlatformUsersDataTable: FunctionComponent = () => {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const { pathname, searchStr } = useLocation();
  const { filters, setFilters } = useUrlListFilters(usersListSearchSchema);
  const userHref = (userId: string) => userDetailHref(pathname, userId, searchStr);

  const { data, isLoading } = useQuery(trpc.users.listPlatformUsers.queryOptions());

  const users: Array<ProcessedUser> = data ?? [];
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
      header: t`Platform groups`,
      size: 250,
      cell: ({ row }): ReactElement => <BadgeCellList items={withSuperAdministratorTag(row.original.platformGroups, row.original.isSuperAdmin)} />,
    },
    {
      id: 'roles',
      header: t`Roles`,
      size: 250,
      cell: ({ row }): ReactElement => <BadgeCellList items={row.original.platformRoles} />,
    },
    {
      id: 'tenants',
      header: t`Tenants`,
      size: 250,
      cell: ({ row }): ReactElement => (row.original.isSuperAdmin
        ? <span>{t`All tenants`}</span>
        : <BadgeCellList items={row.original.tenants} />),
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
              onClick={() => void navigate({ href: userHref(row.original.id) })}
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
      storageKey="platform-users"
      headerActions={<AddMembersDrawer scope="platform" />}
      onClickRow={(row) => void navigate({ href: userHref(row.original.id) })}
      leftHeaderContent={(
        <DebouncedSearchField
          placeholder={t`Search users...`}
          value={filters.search}
          onCommit={(search) => setFilters({ search })}
          clearLabel={t`Clear search`}
          className="w-full max-w-sm"
        />
      )}
    />
  );
};
