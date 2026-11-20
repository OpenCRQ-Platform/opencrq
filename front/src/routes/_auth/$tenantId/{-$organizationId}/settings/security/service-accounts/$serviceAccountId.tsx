import { Chip } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { createFileRoute, notFound } from '@tanstack/react-router';
import { Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader } from '../../../../../../../components';
import { ManageServiceAccount, ServiceAccountEffectivePermissions, ServiceAccountTokens } from '../../../../../../../features';
import { useHasManageSecurity } from '../../../../../../../hooks';
import { trpcClient, useTRPC } from '../../../../../../../lib';
import { CardField, DescriptionField, DetailPageLayout, InfoField, SectionCard } from '../../../../../../../components/shared';
import { EmptyValue } from '../../../../../../../components/ui/empty-value';

const ServiceAccountDetails = () => {
  const trpc = useTRPC();
  const { serviceAccount: initial } = Route.useLoaderData();
  const { data: sa, isLoading } = useQuery(trpc.serviceAccounts.getServiceAccount.queryOptions(
    { id: initial.id },
    { initialData: initial },
  ));
  const { data: groups } = useQuery(trpc.serviceAccounts.getServiceAccountGroups.queryOptions({ serviceAccountId: initial.id }));
  const { data: roles } = useQuery(trpc.serviceAccounts.getServiceAccountRoles.queryOptions({ serviceAccountId: initial.id }));
  const hasManageSecurity = useHasManageSecurity();

  if (isLoading) {
    return <Loader />;
  } else if (!sa) {
    return <div>{t`Service account not found`}</div>;
  }

  return (
    <DetailPageLayout
      title={sa.name}
      actions={
        <div className="flex items-center gap-2">
          {sa.active
            ? <Chip severity="low" label={t`Active`} />
            : <Chip label={t`Inactive`} />}
          {hasManageSecurity && <ManageServiceAccount serviceAccountId={sa.id} />}
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-6">
        <SectionCard title={t`Details`}>
          <InfoField title={t`Name`} value={sa.name} />
          <DescriptionField title={t`Description`} value={sa.description} />
          <CardField title={t`Status`}>
            {sa.active
              ? <Chip severity="low" label={t`Active`} />
              : <Chip label={t`Inactive`} />}
          </CardField>
        </SectionCard>

        <SectionCard title={t`Groups & Roles`}>
          <CardField title={t`Groups`}>
            {groups && groups.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {groups.map((g) => (
                  <Chip key={g.group.id} label={g.group.name} />
                ))}
              </div>
            ) : (
              <EmptyValue />
            )}
          </CardField>
          <CardField title={t`Roles`}>
            {roles && roles.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {roles.map((role) => (
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
          <ServiceAccountEffectivePermissions serviceAccountId={sa.id} />
        </Suspense>
      </SectionCard>

      {hasManageSecurity && <ServiceAccountTokens serviceAccountId={sa.id} />}
    </DetailPageLayout>
  );
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/security/service-accounts/$serviceAccountId')({
  loader: async ({ params }) => {
    const serviceAccount = await trpcClient.serviceAccounts.getServiceAccount.query({ id: params.serviceAccountId });
    if (!serviceAccount) {
      throw notFound();
    }
    return { serviceAccount, crumb: serviceAccount.name };
  },
  component: function ServiceAccountComponent() {
    return (
      <Suspense fallback={<Loader />}>
        <ServiceAccountDetails />
      </Suspense>
    );
  },
});
