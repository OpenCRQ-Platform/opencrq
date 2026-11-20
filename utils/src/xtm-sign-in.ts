/**
 * Why a sign-in through XTM One did not go through, as the backend callback
 * sends the browser back to the login page (`/login?xtm_sign_in_error=`), shared
 * by `back` and `front` so a reason renamed on one side is a compile error on
 * the other.
 */
export const XTM_SIGN_IN_ERRORS = ['unavailable', 'expired', 'denied', 'failed', 'conflict'] as const;

export type XtmSignInError = typeof XTM_SIGN_IN_ERRORS[number];
