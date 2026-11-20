import { toast } from '@filigran/ui';
import { t } from '@lingui/core/macro';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, notFound, Outlet, redirect, useNavigate } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import { useEffect } from 'react';
import { z } from 'zod';
import { useRefetchTenantsOnEditionChange } from '../../../features/edition';
import { trpcClient, useTRPC } from '../../../lib';
import { TenantProvider } from '../../../providers';

const RouteComponent: FunctionComponent = () => {
  const { tenantId } = Route.useParams();
  const navigate = useNavigate();
  const trpc = useTRPC();
  const { data: tenants } = useQuery(trpc.tenants.getTenants.queryOptions());
  useRefetchTenantsOnEditionChange();

  // A live doorbell (someone else's removal, or the reader's own self-removal) can invalidate
  // this list mid-session, after the loader above already granted access, and so can a downgrade
  // to Community Edition. Route away rather than leave the already-mounted tenant-scoped pages
  // rendering against a tenant the reader can no longer read from.
  useEffect(() => {
    if (tenants && !tenants.some((tenant) => tenant.id === tenantId)) {
      void navigate({ to: '/' });
    }
  }, [tenants, tenantId, navigate]);

  return (
    <TenantProvider tenantId={tenantId}>
      <Outlet />
    </TenantProvider>
  );
};

export const Route = createFileRoute('/_auth/$tenantId')({
  loader: async ({ params, preload }) => {
    // getTenant only accepts a uuid: anything else the address bar held would surface as a query error.
    if (!z.uuid().safeParse(params.tenantId).success) {
      throw notFound();
    }
    const tenant = await trpcClient.tenants.getTenant.query({ id: params.tenantId });
    // A tenant the reader cannot open and one that does not exist answer alike, so that no address
    // tells a signed-in user whether a tenant stands behind an id: both send them where they land.
    if (!tenant) {
      // A hovered link preloads this loader: only a navigation the reader made gets the toast.
      if (!preload) {
        toast({ description: t`This tenant isn't available.`, variant: 'info' });
      }
      throw redirect({ to: '/' });
    }
    return { tenant, crumb: undefined };
  },
  component: RouteComponent,
});
