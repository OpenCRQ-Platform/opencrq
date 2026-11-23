import { Button, Chip } from '@filigran/design-system';
import { Separator } from '@filigran/ui';
import type { FunctionComponent } from 'react';
import { Suspense } from 'react';
import { t } from '@lingui/core/macro';
import { useQuery } from '@tanstack/react-query';
import { Loader } from '../../../components';
import { useTRPC } from '../../../lib';
import { getInitials, withSuperAdministratorTag } from '../utils';
import { CardField, SectionCard } from '../../../components/shared';
import { EmptyValue } from '../../../components/ui/empty-value';
import { PlatformEffectivePermissions } from './platform-effective-permissions';
import { EditUser } from './platform-user-update';

export interface PlatformUserDetailsProps {
  userId: string,
  initialUser?: {
    id: string,
    email: string,
    name: string | null,
    title: string | null,
    locale: string | null,
    theme: string | null,
    pastelColours: boolean,
    homeDashboardId: string | null,
    isSuperAdmin: boolean,
  },
}

export const PlatformUserDetails: FunctionComponent<PlatformUserDetailsProps> = ({ userId, initialUser }) => {
  const trpc = useTRPC();

  const { data: user, isLoading } = useQuery(trpc.users.getUser.queryOptions({ id: userId }, {
    initialData: initialUser,
  }));

  const { data: userGroups } = useQuery(trpc.platformGroups.getUserPlatformGroups.queryOptions({ userId }));
  const { data: userRoles } = useQuery(trpc.platformRoles.getUserPlatformRoles.queryOptions({ userId }));

  if (isLoading) {
    return <Loader />;
  } else if (!user) {
    return <div>{t`User not found`}</div>;
  }

  const groups = withSuperAdministratorTag((userGroups ?? []).map(({ group }) => group), user.isSuperAdmin);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-muted text-lg font-semibold">
          {getInitials(user.name, user.email)}
        </div>
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold">{user.name ?? user.email}</h1>
          {user.title && <span className="text-sm text-muted-foreground">{user.title}</span>}
          <span className="text-sm text-muted-foreground">{user.email}</span>
        </div>
        <div className="ml-auto self-start">
          <EditUser
            userId={user.id}
            trigger={<Button>{t`Update`}</Button>}
          />
        </div>
      </div>

      <Separator />

      <SectionCard title={t`Platform Groups & Roles`}>
        <CardField title={t`Groups`}>
          {groups.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {groups.map((group) => (
                <Chip key={group.id} label={group.name} />
              ))}
            </div>
          ) : (
            <EmptyValue />
          )}
        </CardField>
        <CardField title={t`Roles`}>
          {userRoles && userRoles.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {userRoles.map((role) => (
                <Chip key={role.id} label={role.name} />
              ))}
            </div>
          ) : (
            <EmptyValue />
          )}
        </CardField>
      </SectionCard>

      <SectionCard title={t`Effective Permissions`}>
        <Suspense fallback={<Loader />}>
          <PlatformEffectivePermissions userId={userId} />
        </Suspense>
      </SectionCard>
    </div>
  );
};
