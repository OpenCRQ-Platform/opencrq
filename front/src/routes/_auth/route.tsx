import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import { prefetchHeaderData } from '../../components/layout/header-prefetch';
import { RoutePendingComponent } from '../../components/layout/route-pending';
import { HealthCheck } from '../../components/shared/health-check';
import { renewsSessionNow, xtmSignInHref } from '../../features/auth/xtm-sign-in-utils';
import { isRenewalDeferred } from '../../features/auth/session-renewal';
import { EventStreamProvider } from '../../providers/event-stream-provider';
import { LoggedUserProvider } from '../../providers/logged-user-provider';

const AuthRouteComponent: FunctionComponent = () => {
  const ctx = Route.useRouteContext();
  return (
    <LoggedUserProvider userId={ctx.auth.user.id}>
      <HealthCheck />
      <EventStreamProvider>
        <Outlet />
      </EventStreamProvider>
    </LoggedUserProvider>
  );
};

export const Route = createFileRoute('/_auth')({
  beforeLoad: ({ context, location }) => {
    if (context.auth.status === 'logged-out') {
      throw redirect({
        to: '/login',
        search: { redirect: location.href },
      });
    } else if (context.auth.status === 'logged-in' && !isRenewalDeferred() && renewsSessionNow(context.auth.session, Date.now())) {
      throw redirect({ href: xtmSignInHref(location.href), reloadDocument: true });
    }
    return { ...context, auth: context.auth };
  },
  loader: ({ context }) => prefetchHeaderData(context.queryClient, context.trpc),
  // Not router-wide: a layout route's new match, on a scope or tenant change, would draw it in place of the header and the sidebar.
  pendingComponent: RoutePendingComponent,
  component: () => <AuthRouteComponent />,
});
