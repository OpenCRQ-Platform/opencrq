import { createFileRoute, notFound, Outlet } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import { z } from 'zod';
import { useQuery } from '@tanstack/react-query';
import { MainLayout, OrganizationNotFound, RouteNotFoundComponent } from '../../../../components';
import { trpcClient, useTRPC } from '../../../../lib';

/** Tells the two errors this boundary catches apart: a scope that does not resolve, versus a surface that does not exist. */
const ORGANIZATION_NOT_FOUND = 'organization-not-found';

const RouteComponent: FunctionComponent = () => {
  const trpc = useTRPC();
  const { tenantId, organizationId } = Route.useParams();
  const { organization } = Route.useLoaderData();

  // The loader answers once, and a route loader does not re-run when the event stream invalidates the
  // cache, so an organization deleted elsewhere would otherwise stay named in the breadcrumb for the
  // rest of the session while its own surfaces answered with nothing.
  const { data: live } = useQuery(trpc.organizations.getOrganization.queryOptions(
    { id: organizationId ?? '' },
    { initialData: organization, enabled: organizationId !== undefined },
  ));

  if (organizationId !== undefined && live === null) {
    throw notFound({ data: ORGANIZATION_NOT_FOUND });
  }

  return (
    <MainLayout key={tenantId}>
      <Outlet />
    </MainLayout>
  );
};

const ScopeNotFound: FunctionComponent<{ data?: unknown }> = ({ data }) => (
  data === ORGANIZATION_NOT_FOUND ? <OrganizationNotFound /> : <RouteNotFoundComponent />
);

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}')({
  loader: async ({ params }) => {
    if (params.organizationId === undefined) {
      return { organization: undefined, crumb: undefined };
    }
    // The segment is whatever the address bar held, and getOrganization only accepts a uuid, so an
    // unparseable one has to be answered here or it surfaces as a query error instead of the scope page.
    if (!z.uuid().safeParse(params.organizationId).success) {
      throw notFound({ data: ORGANIZATION_NOT_FOUND });
    }
    const organization = await trpcClient.organizations.getOrganization.query({ id: params.organizationId });
    if (!organization) {
      throw notFound({ data: ORGANIZATION_NOT_FOUND });
    }
    return { organization, crumb: organization.name };
  },
  component: RouteComponent,
  notFoundComponent: ScopeNotFound,
});
