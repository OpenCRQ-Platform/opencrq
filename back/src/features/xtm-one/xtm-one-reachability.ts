import { REGISTRATION_INTERVAL_MS } from './xtm-one-registration';

// No config or logger import: those parse the process configuration at import time.

export const XTM_ONE_REACHABILITY = ['pending', 'ok', 'unreachable', 'refused', 'unreadable'] as const;
export type XtmOneReachability = typeof XTM_ONE_REACHABILITY[number];
export type XtmOneRegistrationFailure = Exclude<XtmOneReachability, 'pending' | 'ok'>;

export const classifyRegistrationStatus = (status: number): XtmOneRegistrationFailure => (
  (status === 401 || status === 403) ? 'refused' : 'unreachable'
);

/** How long lost heartbeats are tolerated before a registration failure is reported. */
export const XTM_ONE_REACHABILITY_GRACE_MS = 2 * REGISTRATION_INTERVAL_MS;

export const XTM_ONE_REGISTRATION_OUTCOMES = ['ok', 'unreachable', 'refused', 'unreadable'] as const;
export type XtmOneRegistrationOutcome = typeof XTM_ONE_REGISTRATION_OUTCOMES[number];

let lastSuccessAt: number | undefined;
let lastFailureCause: XtmOneRegistrationFailure | undefined;
let failureCauseSince: number | undefined;
let attemptCount = 0;
let lastAttemptOutcome: XtmOneRegistrationOutcome | undefined;

export const recordRegistrationSuccess = (now: number = Date.now()): void => {
  lastSuccessAt = now;
  lastFailureCause = undefined;
  failureCauseSince = undefined;
  attemptCount += 1;
  lastAttemptOutcome = 'ok';
};

export const recordRegistrationFailure = (cause: XtmOneRegistrationFailure, now: number = Date.now()): void => {
  if (cause !== lastFailureCause) {
    failureCauseSince = now;
  }
  lastFailureCause = cause;
  attemptCount += 1;
  lastAttemptOutcome = cause;
};

export interface XtmOneRegistrationAttempt {
  /** How many attempts were recorded up to this one, so a caller can tell a new attempt from the previous one. */
  sequence: number,
  outcome: XtmOneRegistrationOutcome,
  /** Since when a failed outcome holds, its cause's first attempt since the last success; `null` for `ok`. */
  failingSince: number | null,
}

/**
 * The last attempt's own outcome, unlike `getXtmOneReachability`, which keeps reporting `ok` through
 * the grace: an administrator who asked for the attempt is owed its answer.
 */
export const getLastRegistrationAttempt = (): XtmOneRegistrationAttempt | null => {
  if (lastAttemptOutcome === undefined) {
    return null;
  }
  return {
    sequence: attemptCount,
    outcome: lastAttemptOutcome,
    failingSince: lastAttemptOutcome === 'ok' ? null : failureCauseSince ?? null,
  };
};

/** When XTM One last gave a readable registration answer, epoch milliseconds; `null` before the first. */
export const getXtmOneLastAnswerAt = (): number | null => lastSuccessAt ?? null;

/**
 * `now - lastSuccessAt < XTM_ONE_REACHABILITY_GRACE_MS` keeps reporting `ok`
 * through a failure that follows a recent success, so a single lost
 * heartbeat does not flap the toast. Only a recorded failure is reported: a
 * success that ages with no attempt since says nothing about XTM One.
 */
export const getXtmOneReachability = (now: number = Date.now()): XtmOneReachability => {
  if (lastSuccessAt === undefined) {
    return lastFailureCause ?? 'pending';
  }
  if (now - lastSuccessAt < XTM_ONE_REACHABILITY_GRACE_MS) {
    return 'ok';
  }
  return lastFailureCause ?? 'ok';
};

/**
 * Since when the reported failure holds: its cause's first attempt since the
 * last success. `null` while nothing is reported, the grace included.
 */
export const getXtmOneFailingSince = (now: number = Date.now()): number | null => {
  const reachability = getXtmOneReachability(now);
  if (reachability === 'pending' || reachability === 'ok') {
    return null;
  }
  return failureCauseSince ?? null;
};

/** Test-only reset: back to the pending default. */
export const resetXtmOneReachability = (): void => {
  lastSuccessAt = undefined;
  lastFailureCause = undefined;
  failureCauseSince = undefined;
  attemptCount = 0;
  lastAttemptOutcome = undefined;
};
