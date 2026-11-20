import { I18nProvider } from '@lingui/react';
import type { FunctionComponent, ReactNode } from 'react';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import {
  getResolvedTenantId,
  i18n,
  loadCatalog,
  localeSyncStep,
  rememberLocale,
  subscribeToResolvedTenant,
  syncedLocale,
  useTRPC,
} from '../lib';

interface LinguiProviderProps { children: ReactNode }

export const LinguiProvider: FunctionComponent<LinguiProviderProps> = ({ children }) => (
  <I18nProvider i18n={i18n}>{children}</I18nProvider>
);

export const LocaleSyncProvider: FunctionComponent<{ children: ReactNode }> = ({ children }) => {
  const trpc = useTRPC();
  const resolvedTenantId = useSyncExternalStore(subscribeToResolvedTenant, getResolvedTenantId);
  // The segment is whatever the address bar held, and getTenant refuses anything but a uuid with an
  // error toast: an address that cannot name a tenant has no tenant locale to read.
  const tenantId = resolvedTenantId !== null && z.uuid().safeParse(resolvedTenantId).success ? resolvedTenantId : null;
  const isLoggedInQuery = useQuery(trpc.isLoggedIn.queryOptions());
  const isLoggedIn = isLoggedInQuery.isSuccess && isLoggedInQuery.data !== null;
  const localeQuery = useQuery(trpc.users.getUserLocale.queryOptions(undefined, { enabled: isLoggedIn }));
  const tenantQuery = useQuery(trpc.tenants.getTenant.queryOptions({ id: tenantId ?? '' }, {
    enabled: isLoggedIn && tenantId !== null,
  }));
  const target = syncedLocale({
    userLocale: localeQuery.data,
    tenantId,
    tenantLocale: tenantQuery.isSuccess ? (tenantQuery.data?.defaultLocale ?? null) : undefined,
    browserLanguages: navigator.languages,
  });
  const syncedTenantId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (target === null) {
      return;
    }
    const step = localeSyncStep({
      target,
      shown: i18n.locale,
      isFirstSync: syncedTenantId.current === undefined,
      tenantSwitched: syncedTenantId.current !== tenantId,
    });
    syncedTenantId.current = tenantId;
    switch (step) {
      case 'load':
        void loadCatalog(target);
        return;
      case 'keep':
      case 'remember':
        rememberLocale(target);
        return;
      case 'reload':
        rememberLocale(target);
        window.location.reload();
    }
  }, [target, tenantId]);

  return <>{children}</>;
};
