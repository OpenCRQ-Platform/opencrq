import { t } from '@lingui/core/macro';
import { useQuery } from '@tanstack/react-query';
import type { XtmSignInError } from '@app/utils/xtm-sign-in';
import type { SignInPage } from '../xtm-sign-in-utils';
import { useTRPC } from '../../../lib';
import { hadSession } from '../../../stores';
import { signInPage, xtmSignInHref } from '../xtm-sign-in-utils';

export const signInRefusalMessage = (reason: Exclude<XtmSignInError, 'unavailable'>): string => {
  switch (reason) {
    case 'expired':
      return t`The sign-in through XTM One took too long or was interrupted. Please try again.`;
    case 'denied':
      return t`The sign-in was cancelled in XTM One.`;
    case 'conflict':
      return t`Your XTM One account cannot be matched to an account here. Ask an administrator.`;
    case 'failed':
      return t`XTM One could not sign you in. Please try again.`;
  }
};

interface XtmSignIn {
  /** `null` while the backend has not said yet whether XTM One answers. */
  page: SignInPage | null,
  /** The backend route sending the browser to XTM One, then back to the page asked for. */
  href: string,
}

/**
 * Where a browser with no session goes, as the backend sees XTM One (public `authStatus`, known
 * before sign-in) and as the last attempt ended (`?xtm_sign_in_error=`, set by the callback).
 */
export const useXtmSignIn = (redirect?: string, error?: XtmSignInError): XtmSignIn => {
  const trpc = useTRPC();
  const { data } = useQuery(trpc.authStatus.queryOptions());
  return {
    page: data ? signInPage({ available: data.xtmSignIn, error, sessionEnded: hadSession() }) : null,
    href: xtmSignInHref(redirect),
  };
};
