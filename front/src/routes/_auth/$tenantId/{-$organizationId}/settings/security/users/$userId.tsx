import { Button, Chip } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { createFileRoute, notFound, useNavigate } from '@tanstack/react-router';
import { Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import { Loader } from '../../../../../../../components';
import { EffectivePermissions, PlatformUserDetails, UserManageDrawer } from '../../../../../../../features';
import { withSuperAdministratorTag } from '../../../../../../../features/users/utils';
import { trpcClient, useTRPC } from '../../../../../../../lib';
import { CardField, DetailPageLayout, InfoField, SectionCard } from '../../../../../../../components/shared';
import { securityScopeHref } from '../../../../../../../components/layout/settings-layout/security-scope-utils';
import { EmptyValue } from '../../../../../../../components/ui/empty-value';

type TenantUserLoaderData = Extract<ReturnType<typeof Route.useLoaderData>, { scope: 'tenant' }>;

interface TenantUserDetailsProps {
  initial: TenantUserLoaderData['user'],
  initialTenantProfile: TenantUserLoaderData['tenantProfile'],
}

const TenantUserDetails: FunctionComponent<TenantUserDetailsProps> = ({ initial, initialTenantProfile }) => {
  const trpc = useTRPC();
  const { tenantId, organizationId } = Route.useParams();
  const navigate = useNavigate();

  const { data: user, isLoading } = useQuery(trpc.users.getUser.queryOptions({ id: initial.id }, {
    initialData: initial,
  }));

  // A doorbell refetch can race a self-removal from this very tenant: the $tenantId layout
  // redirects away as soon as it sees the tenant drop out of the reader's list, so a 403 here is
  // moot by the time it would show — never a signal worth a toast.
  const { data: tenantProfile } = useQuery(trpc.tenants.getTenantUserProfile.queryOptions(
    { tenantId, userId: initial.id },
    { initialData: initialTenantProfile, meta: { skipErrorToast: true } },
  ));

  const { data: userGroups } = useQuery(trpc.groups.getUserGroups.queryOptions({ userId: initial.id }));
  const { data: userRoles } = useQuery(trpc.roles.getUserRoles.queryOptions({ userId: initial.id }));

  if (isLoading) {
    return <div>{t`Loading`}</div>;
  } else if (!user) {
    return <div>{t`User not found`}</div>;
  }

  const effectiveName = tenantProfile?.name ?? user.name;
  const effectiveTitle = tenantProfile?.title ?? user.title;
  const groups = withSuperAdministratorTag((userGroups ?? []).map(({ group }) => group), user.isSuperAdmin);

  return (
    <DetailPageLayout
      title={effectiveName ?? user.email}
      // XTM One grants a super administrator every right as a member of no tenant: nothing to manage here.
      actions={user.isSuperAdmin ? undefined : (
        <UserManageDrawer
          userId={user.id}
          tenantId={tenantId}
          onRemovedFromTenant={() => void navigate({ href: securityScopeHref(tenantId, organizationId, 'tenant', 'users') })}
          trigger={<Button>{t`Manage`}</Button>}
        />
      )}
    >
      <div className="grid grid-cols-2 gap-6">
        <SectionCard title={t`Profile`}>
          <InfoField title={t`Name`} value={effectiveName} />
          <InfoField title={t`Title`} value={effectiveTitle} />
          <InfoField title={t`Email`} value={user.email} />
        </SectionCard>

        <SectionCard title={t`Groups & Roles`}>
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
      </div>

      <SectionCard title={t`Effective Permissions`}>
        <Suspense fallback={<Loader />}>
          <EffectivePermissions userId={initial.id} />
        </Suspense>
      </SectionCard>
    </DetailPageLayout>
  );
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/security/users/$userId')({
  loader: async ({ params, context }) => {
    // Runs in the pending-navigation window, so this always carries the tenant header
    // (tenant-accessor.ts): a platform-scope user sharing no tenant with the reader comes back
    // empty here even though PlatformUserDetails' own post-commit query can see them.
    const user = await trpcClient.users.getUser.query({ id: params.userId });
    if (context.securityScope === 'platform') {
      return { scope: 'platform' as const, user: user ?? undefined, crumb: user ? (user.name ?? user.email) : t`User` };
    }
    if (!user) {
      throw notFound();
    }
    const tenantProfile = await trpcClient.tenants.getTenantUserProfile.query({ tenantId: params.tenantId, userId: params.userId });
    const effectiveName = tenantProfile?.name ?? user.name;
    return { scope: 'tenant' as const, user, tenantProfile, crumb: effectiveName ?? user.email };
  },
  component: function UserComponent() {
    const data = Route.useLoaderData();
    const { userId } = Route.useParams();
    return data.scope === 'platform'
      ? <PlatformUserDetails userId={userId} initialUser={data.user} />
      : <TenantUserDetails initial={data.user} initialTenantProfile={data.tenantProfile} />;
  },
});
