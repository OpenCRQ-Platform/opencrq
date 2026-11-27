const XTM_SIGN_IN_PATH = '/api/auth/xtm/login';

/** The backend route that sends the browser to XTM One, carrying where to land afterwards. */
export const xtmSignInHref = (redirect?: string): string => (
  redirect ? `${XTM_SIGN_IN_PATH}?${new URLSearchParams({ redirect }).toString()}` : XTM_SIGN_IN_PATH
);

export type SignInPage = 'redirect' | 'sign-in' | 'unavailable' | 'refused';

/**
 * What a browser with no session sees: why the last attempt did not go through; XTM One at once when
 * a session of this browser ended, since its XTM One session renews it with no click; else the
 * button to sign in with XTM One. Never XTM One on its own after a sign-out or on a first visit:
 * XTM One's session outlives OpenCRQ's, and would sign a person who just signed out straight back in.
 */
export const signInPage = (
  { available, error, sessionEnded }: { available: boolean, error?: string, sessionEnded: boolean },
): SignInPage => {
  if (error === 'unavailable') {
    return 'unavailable';
  }
  if (error) {
    return 'refused';
  }
  if (!available) {
    return 'unavailable';
  }
  return sessionEnded ? 'redirect' : 'sign-in';
};

/** How long before its end a session is renewed on a navigation. */
export const SESSION_RENEWAL_WINDOW_MS = 10 * 60_000;

/**
 * Whether a navigation renews the session through XTM One now: a session XTM One renews, ending
 * within the renewal window. Renewing on a navigation, before the end, never loses a form being
 * edited, which a redirect once the session has ended would.
 */
export const renewsSessionNow = (
  { sessionExpiresAt, renewsThroughXtmOne }: { sessionExpiresAt: string | null, renewsThroughXtmOne: boolean },
  now: number,
): boolean => renewsThroughXtmOne
  && sessionExpiresAt !== null
  && new Date(sessionExpiresAt).getTime() - now < SESSION_RENEWAL_WINDOW_MS;
