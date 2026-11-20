import { isXtmOneAnswering, lastXtmOneAnswer } from './xtm-one-live-probe';

/**
 * The OpenID Connect client XTM One keeps for this platform, as its last
 * registration answered it (`sign_in_client_id`). In memory, per process:
 * every process that serves the sign-in routes also registers. `null` until
 * an XTM One that supports product sign-in answers one.
 */
let signInClientId: string | null = null;

export const recordSignInClientId = (clientId: string | null): void => {
  signInClientId = clientId;
};

export const getSignInClientId = (): string | null => signInClientId;

/**
 * Whether signing in through XTM can be offered now: a client was answered, and XTM One, at `url`,
 * answers right now (`xtm-one-live-probe`). When it does not, the browser is told XTM One is
 * unavailable instead of being sent to a server that does not respond.
 */
export const isXtmSignInReady = async (url: string): Promise<boolean> => signInClientId !== null && await isXtmOneAnswering(url);

/** The same, from XTM One's last answer, for a status that must not wait on a hung XTM One. */
export const wasXtmSignInReady = async (url: string): Promise<boolean> => signInClientId !== null && await lastXtmOneAnswer(url);
