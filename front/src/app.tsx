import { useQueryClient } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import { useLingui } from '@lingui/react';
import { AuthProvider, useAuth } from './features';
import { router, useTRPC } from './lib';
import { ErrorBoundary, LinguiProvider, LocaleSyncProvider, ThemeProvider, TrpcProvider } from './providers';

const Router: FunctionComponent = () => {
  const { i18n } = useLingui();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const trpc = useTRPC();
  return <RouterProvider key={i18n.locale} router={router} context={{ auth, queryClient, trpc }} />;
};

export const App: FunctionComponent = () => (
  <ErrorBoundary>
    <LinguiProvider>
      <TrpcProvider>
        <LocaleSyncProvider>
          <ThemeProvider>
            <AuthProvider>
              <Router />
            </AuthProvider>
          </ThemeProvider>
        </LocaleSyncProvider>
      </TrpcProvider>
    </LinguiProvider>
  </ErrorBoundary>
);
