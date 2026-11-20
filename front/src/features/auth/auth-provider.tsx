import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { FunctionComponent, ReactNode } from 'react';
import { Trans } from '@lingui/react/macro';
import type { AuthContextType } from './auth-context';
import { ErrorPage, Loader } from '../../components';
import { useTRPC } from '../../lib';
import { forgetSession, rememberSession } from '../../stores';
import { AuthContext } from './auth-context';

interface AuthProviderProps {
  children: ReactNode,
}

export const AuthProvider: FunctionComponent<AuthProviderProps> = ({ children }) => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const onSignedOut = async () => {
    // eslint-disable-next-line no-restricted-syntax -- logout writes only `sessions`, which carries no trigger, and the SSE subscription is `skipToken` while logged out, so no doorbell can ring for this transition.
    await queryClient.invalidateQueries(trpc.isLoggedIn.queryFilter());
  };

  const logoutMutation = useMutation(trpc.signOut.mutationOptions({ meta: { skipSuccessToast: true }, onSuccess: onSignedOut }));
  const logout = async () => {
    forgetSession();
    await logoutMutation.mutateAsync();
  };

  const authStatusQuery = useQuery(trpc.authStatus.queryOptions());

  const isLoggedInQuery = useQuery(trpc.isLoggedIn.queryOptions(undefined, {
    refetchInterval: 60_000,
  }));

  const loggedIn = Boolean(isLoggedInQuery.data);
  useEffect(() => {
    if (loggedIn) {
      rememberSession();
    }
  }, [loggedIn]);

  if (authStatusQuery.isPending || isLoggedInQuery.isPending) {
    return <Loader />;
  } else if (authStatusQuery.isError || isLoggedInQuery.isError) {
    return (
      <div className="flex flex-col w-full h-screen">
        <ErrorPage>
          <p className="text-center">
            <Trans>We're sorry, something went wrong</Trans>
            <br />
            <Trans>We're currently troubleshooting the issue. Please try again in a
              few minutes.</Trans>
          </p>
        </ErrorPage>
      </div>
    );
  }

  let authContext: AuthContextType;
  if (isLoggedInQuery.isError || !isLoggedInQuery.data) {
    authContext = { status: 'logged-out' };
  } else {
    const { sessionExpiresInMs, renewsThroughXtmOne, ...user } = isLoggedInQuery.data;
    // On this browser's clock, from when the server answered.
    const sessionExpiresAt = sessionExpiresInMs === null ? null : new Date(isLoggedInQuery.dataUpdatedAt + sessionExpiresInMs).toISOString();
    // Not while XTM One cannot sign anyone in: the session left is better than a sign-in page.
    const renewable = renewsThroughXtmOne && authStatusQuery.data.xtmSignIn;
    authContext = { status: 'logged-in', logout, user, session: { sessionExpiresAt, renewsThroughXtmOne: renewable } };
  }

  return (
    <AuthContext.Provider value={authContext}>
      {children}
    </AuthContext.Provider>
  );
};
