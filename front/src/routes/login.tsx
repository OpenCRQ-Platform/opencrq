import { Button } from '@filigran/design-system';
import { useEffect } from 'react';
import { t } from '@lingui/core/macro';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { Loader } from '../components';
import { AuthNotice } from '../features/auth/components/auth-notice';
import { signInRefusalMessage, useXtmSignIn } from '../features/auth/hooks/use-xtm-sign-in';
import { loginListSearchSchema } from '../features/auth/login-list-search';
import { deferRenewal } from '../features/auth/session-renewal';
import { forgetSession } from '../stores';

const LoginComponent = () => {
  const search = Route.useSearch();
  const { page, href } = useXtmSignIn(search.redirect, search.xtm_sign_in_error);
  useEffect(() => {
    if (page === 'redirect') {
      // Once: a sign-in that comes back without a session shows the page instead of going round again.
      forgetSession();
      // No history entry: Back from XTM One does not land here again.
      window.location.replace(href);
    }
  }, [page, href]);

  const signInWithXtmOne = (
    <Button asChild>
      <a href={href}>{t`Sign in with XTM One`}</a>
    </Button>
  );

  switch (page) {
    case null:
    case 'redirect':
      return <Loader />;
    case 'sign-in':
      return <AuthNotice action={signInWithXtmOne} />;
    case 'unavailable': {
      // Back to this page without the reason, which asks the backend about XTM One again.
      const retry = search.redirect ? `/login?${new URLSearchParams({ redirect: search.redirect }).toString()}` : '/login';
      return (
        <AuthNotice
          title={t`XTM One is unavailable`}
          description={t`Try again in a few minutes. If the problem persists, contact your administrator.`}
          action={<Button onClick={() => window.location.assign(retry)}>{t`Try again`}</Button>}
        />
      );
    }
    case 'refused': {
      const reason = search.xtm_sign_in_error === undefined || search.xtm_sign_in_error === 'unavailable' ? 'failed' : search.xtm_sign_in_error;
      return <AuthNotice title={t`You are not signed in`} description={signInRefusalMessage(reason)} action={signInWithXtmOne} />;
    }
  }
};

/** A browser with no session signs in through XTM One from here, or is told why it cannot. */
export const Route = createFileRoute('/login')({
  validateSearch: loginListSearchSchema,
  beforeLoad: ({ context: { auth }, search }) => {
    if (auth.status === 'logged-in') {
      // A renewal that did not go through: the session still runs, so back to the page, renewing no more.
      if (search.xtm_sign_in_error) {
        deferRenewal();
      }
      throw redirect({ to: search.redirect || '/' });
    }
    return auth;
  },
  component: LoginComponent,
});
