import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import { Toaster } from '@filigran/ui';
import { useEffect, useRef } from 'react';
import type { RouterContext } from '../lib';
import { useAuth } from '../features';
import { router } from '../lib';
import { navStore } from '../stores';

const RootComponent = () => {
  const auth = useAuth();
  const authStatus = useRef(auth.status);

  useEffect(() => {
    if (authStatus.current !== auth.status) {
      router.invalidate();
      authStatus.current = auth.status;
    }
  }, [auth.status]);

  useEffect(() => {
    const unsubscribers = [
      router.subscribe('onBeforeNavigate', navStore.addRouterEvent),
      router.subscribe('onBeforeLoad', navStore.addRouterEvent),
      router.subscribe('onLoad', navStore.addRouterEvent),
      router.subscribe('onBeforeRouteMount', navStore.addRouterEvent),
      router.subscribe('onRendered', navStore.addRouterEvent),
    ];

    return () => {
      unsubscribers.forEach((unsub) => unsub());
    };
  }, []);

  return (
    <>
      <Outlet />
      <Toaster />
    </>
  );
};

export const Route = createRootRouteWithContext<RouterContext>()({
  component: () => (<RootComponent />),
});
